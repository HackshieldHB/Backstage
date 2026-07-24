import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import {
  CLIENT_EVENTS,
  ClientHuddlePayload,
  ClientHuddleSignalPayload,
  ClientTypingPayload,
  SOCKET_EVENTS,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeService,
  roomForChannel,
  roomForConversation,
  roomForUser,
  roomForWorkspace,
} from './realtime.service';
import { HuddleService } from './huddle.service';
import { PresenceService } from '../presence/presence.service';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard';

interface AuthedSocket extends Socket {
  data: { userId: string; displayName?: string };
}

@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private redisClients: Redis[] = [];

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly huddle: HuddleService,
  ) {}

  afterInit(server: Server) {
    // Handshake auth: reject sockets without a valid access token.
    server.use((socket, next) => {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.headers.authorization === 'string' &&
        socket.handshake.headers.authorization.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);
      if (!token) return next(new Error('Missing access token'));
      try {
        const payload = this.jwtService.verify<AccessTokenPayload>(token);
        (socket as AuthedSocket).data.userId = payload.sub;
        return next();
      } catch {
        return next(new Error('Invalid or expired access token'));
      }
    });

    // Horizontal scaling: fan events out across API instances via Redis.
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const pubClient = new Redis(redisUrl);
    const subClient = pubClient.duplicate();
    this.redisClients = [pubClient, subClient];
    server.adapter(createAdapter(pubClient, subClient));

    // Only now is it safe for feature services to emit.
    this.realtime.bindServer(server);
    this.logger.log('Gateway initialized (redis adapter attached)');
  }

  async onApplicationShutdown() {
    await Promise.all(this.redisClients.map((c) => c.quit().catch(() => undefined)));
  }

  async handleConnection(socket: AuthedSocket) {
    const userId = socket.data.userId;
    await socket.join(roomForUser(userId));

    // Join every container the user can currently read, plus workspace rooms
    // (used for presence and workspace-level broadcasts).
    const [channels, conversations, workspaces] = await Promise.all([
      this.prisma.channelMember.findMany({ where: { userId }, select: { channelId: true } }),
      this.prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true } }),
      this.prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
    ]);
    await socket.join(channels.map((c) => roomForChannel(c.channelId)));
    await socket.join(conversations.map((c) => roomForConversation(c.conversationId)));
    await socket.join(workspaces.map((w) => roomForWorkspace(w.workspaceId)));

    await this.presence.connected(userId);

    // Room setup is complete — only now may the client trust broadcasts.
    socket.emit(SOCKET_EVENTS.READY);
  }

  async handleDisconnect(socket: AuthedSocket) {
    if (socket.data.userId) {
      // Drop the socket from any huddles and refresh those rooms.
      for (const key of this.huddle.removeSocket(socket.data.userId, socket.id)) {
        await this.broadcastHuddle(key);
      }
      await this.presence.disconnected(socket.data.userId);
    }
  }

  // ---------- huddles (voice) ----------

  /**
   * A huddle runs in a channel OR a DM/group conversation. Both are identified
   * by their socket-room name ("channel:X" / "conversation:Y"), which is also
   * the membership gate — a socket is only in that room if it's a member.
   */
  private huddleKey(body: { channelId?: string; conversationId?: string }): string | null {
    if (body.channelId) return roomForChannel(body.channelId);
    if (body.conversationId) return roomForConversation(body.conversationId);
    return null;
  }

  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_JOIN)
  async onHuddleJoin(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddlePayload) {
    const key = this.huddleKey(body);
    // Only members of the channel/DM (who are in its room) may join its huddle.
    if (!key || !socket.rooms.has(key)) return;
    this.huddle.join(key, socket.data.userId, socket.id);
    await this.broadcastHuddle(key);
  }

  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_LEAVE)
  async onHuddleLeave(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddlePayload) {
    const key = this.huddleKey(body);
    if (!key) return;
    this.huddle.leave(key, socket.data.userId, socket.id);
    await this.broadcastHuddle(key);
  }

  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_SIGNAL)
  onHuddleSignal(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleSignalPayload) {
    if ((!body?.channelId && !body?.conversationId) || !body.toUserId) return;
    // Relay the SDP/ICE payload straight to the target peer, echoing which
    // channel/DM it belongs to so the client can route it to the right huddle.
    this.realtime.emitToUser(body.toUserId, SOCKET_EVENTS.HUDDLE_SIGNAL, {
      ...(body.channelId ? { channelId: body.channelId } : { conversationId: body.conversationId }),
      fromUserId: socket.data.userId,
      data: body.data,
    });
  }

  /** Pushes the current participant list (with names/avatars) to the huddle's room. */
  private async broadcastHuddle(key: string) {
    const userIds = this.huddle.userIds(key);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true, avatarUrl: true },
        })
      : [];
    const participants = users.map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
    }));
    const event = SOCKET_EVENTS.HUDDLE_PARTICIPANTS;
    if (key.startsWith('channel:')) {
      const channelId = key.slice('channel:'.length);
      this.realtime.emitToChannel(channelId, event, { channelId, participants });
    } else {
      const conversationId = key.slice('conversation:'.length);
      this.realtime.emitToConversation(conversationId, event, { conversationId, participants });
    }
  }

  @SubscribeMessage('presence:heartbeat')
  async onHeartbeat(@ConnectedSocket() socket: AuthedSocket) {
    await this.presence.heartbeat(socket.data.userId);
  }

  @SubscribeMessage(CLIENT_EVENTS.TYPING_START)
  async onTypingStart(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientTypingPayload) {
    await this.broadcastTyping(socket, body, SOCKET_EVENTS.TYPING_START);
  }

  @SubscribeMessage(CLIENT_EVENTS.TYPING_STOP)
  async onTypingStop(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientTypingPayload) {
    await this.broadcastTyping(socket, body, SOCKET_EVENTS.TYPING_STOP);
  }

  private async broadcastTyping(
    socket: AuthedSocket,
    body: ClientTypingPayload,
    event: typeof SOCKET_EVENTS.TYPING_START | typeof SOCKET_EVENTS.TYPING_STOP,
  ) {
    const userId = socket.data.userId;
    // Membership is enforced by room subscription: a socket only broadcasts
    // typing into rooms it has joined.
    const room = body.channelId
      ? roomForChannel(body.channelId)
      : body.conversationId
        ? roomForConversation(body.conversationId)
        : null;
    if (!room || !socket.rooms.has(room)) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true },
    });
    if (!user) return;
    socket.to(room).emit(event, {
      channelId: body.channelId ?? null,
      conversationId: body.conversationId ?? null,
      user,
    });
  }
}
