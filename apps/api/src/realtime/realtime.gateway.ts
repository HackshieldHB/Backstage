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
import { CLIENT_EVENTS, ClientTypingPayload, SOCKET_EVENTS } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeService,
  roomForChannel,
  roomForConversation,
  roomForUser,
  roomForWorkspace,
} from './realtime.service';
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
      await this.presence.disconnected(socket.data.userId);
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
