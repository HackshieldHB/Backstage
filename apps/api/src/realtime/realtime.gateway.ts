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
  ClientHuddleStatePayload,
  ClientHuddleChatPayload,
  ClientHuddleReactionPayload,
  ClientHuddleAnnotationPayload,
  ClientHuddleLaserPayload,
  ClientHuddleControlPayload,
  ClientHuddlePollPayload,
  ClientHuddleNotesPayload,
  ClientHuddleModerationPayload,
  ClientTypingPayload,
  SOCKET_EVENTS,
  type SocketEventName,
} from '@backstages/shared';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeService,
  roomForChannel,
  roomForConversation,
  roomForUser,
  roomForWorkspace,
} from './realtime.service';
import { HuddleService } from './huddle.service';
import { HuddleSessionService } from '../timesheet/huddle-session.service';
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
    private readonly huddleSession: HuddleSessionService,
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
        await this.huddleSession.leave(key, socket.data.userId);
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
    await this.huddleSession.join(key, socket.data.userId);
    await this.broadcastHuddle(key);
  }

  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_LEAVE)
  async onHuddleLeave(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddlePayload) {
    const key = this.huddleKey(body);
    if (!key) return;
    // Only persist the "left" when the user has no other socket still in the huddle.
    const fullyLeft = this.huddle.leave(key, socket.data.userId, socket.id);
    if (fullyLeft) await this.huddleSession.leave(key, socket.data.userId);
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
    const participants = users.map((u) => {
      const st = this.huddle.stateOf(key, u.id);
      return {
        userId: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        audioEnabled: st?.audioEnabled ?? true,
        videoEnabled: st?.videoEnabled ?? false,
        screenSharing: st?.screenSharing ?? false,
        handRaised: st?.handRaised ?? false,
        role: st?.role ?? 'participant',
        canAnnotate: st?.canAnnotate ?? true,
        cameraStreamId: st?.cameraStreamId ?? null,
        screenStreamId: st?.screenStreamId ?? null,
      };
    });
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_PARTICIPANTS, (idField) => ({ ...idField, participants }));
  }

  /** Route a huddle event to every socket in the huddle's channel/DM room,
   *  echoing whichever id field (channelId/conversationId) identifies it. */
  private emitToKey(
    key: string,
    event: SocketEventName,
    build: (idField: { channelId?: string; conversationId?: string }) => Record<string, unknown>,
  ) {
    if (key.startsWith('channel:')) {
      const channelId = key.slice('channel:'.length);
      this.realtime.emitToChannel(channelId, event, build({ channelId }));
    } else {
      const conversationId = key.slice('conversation:'.length);
      this.realtime.emitToConversation(conversationId, event, build({ conversationId }));
    }
  }

  /** A huddle-scoped action is valid only from a socket that is a room member
   *  AND actually present in the huddle. Returns the key or null. */
  private huddleGuard(socket: AuthedSocket, body: { channelId?: string; conversationId?: string }): string | null {
    const key = this.huddleKey(body);
    if (!key || !socket.rooms.has(key) || !this.huddle.isPresent(key, socket.data.userId)) return null;
    return key;
  }

  private async userInfo(socket: AuthedSocket): Promise<{ displayName: string; avatarUrl: string | null }> {
    if (!socket.data.displayName) {
      const u = await this.prisma.user.findUnique({
        where: { id: socket.data.userId },
        select: { displayName: true, avatarUrl: true },
      });
      socket.data.displayName = u?.displayName ?? 'Someone';
      (socket.data as { avatarUrl?: string | null }).avatarUrl = u?.avatarUrl ?? null;
    }
    return {
      displayName: socket.data.displayName!,
      avatarUrl: (socket.data as { avatarUrl?: string | null }).avatarUrl ?? null,
    };
  }

  // ---------- huddle: media/hand state ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_STATE)
  async onHuddleState(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleStatePayload) {
    const key = this.huddleGuard(socket, body);
    if (!key) return;
    this.huddle.setState(key, socket.data.userId, {
      audioEnabled: body.audioEnabled,
      videoEnabled: body.videoEnabled,
      screenSharing: body.screenSharing,
      handRaised: body.handRaised,
      cameraStreamId: body.cameraStreamId,
      screenStreamId: body.screenStreamId,
    });
    await this.broadcastHuddle(key);
  }

  // ---------- huddle: chat ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_CHAT)
  async onHuddleChat(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleChatPayload) {
    const key = this.huddleGuard(socket, body);
    const text = (body.text ?? '').trim();
    if (!key || !text) return;
    const { displayName, avatarUrl } = await this.userInfo(socket);
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_CHAT, (idField) => ({
      ...idField,
      id: randomUUID(),
      userId: socket.data.userId,
      displayName,
      avatarUrl,
      text: text.slice(0, 2000),
      replyTo: body.replyTo ?? null,
      createdAt: new Date().toISOString(),
    }));
  }

  // ---------- huddle: reactions ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_REACTION)
  async onHuddleReaction(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleReactionPayload) {
    const key = this.huddleGuard(socket, body);
    if (!key || !body.emoji) return;
    const { displayName } = await this.userInfo(socket);
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_REACTION, (idField) => ({
      ...idField,
      userId: socket.data.userId,
      displayName,
      emoji: String(body.emoji).slice(0, 8),
      id: randomUUID(),
    }));
  }

  // ---------- huddle: annotation ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_ANNOTATION)
  onHuddleAnnotation(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleAnnotationPayload) {
    const key = this.huddleGuard(socket, body);
    if (!key) return;
    const op = body.op;
    // 'clear' requires moderator; create/update/delete require annotate permission.
    if (op.kind === 'clear') {
      if (!this.huddle.isModerator(key, socket.data.userId)) return;
    } else if (!this.huddle.canAnnotate(key, socket.data.userId)) {
      return;
    }
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_ANNOTATION, (idField) => ({
      ...idField,
      userId: socket.data.userId,
      op,
    }));
  }

  // ---------- huddle: laser pointer ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_LASER)
  async onHuddleLaser(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleLaserPayload) {
    const key = this.huddleGuard(socket, body);
    if (!key) return;
    const { displayName } = await this.userInfo(socket);
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_LASER, (idField) => ({
      ...idField,
      userId: socket.data.userId,
      displayName,
      point: body.point ?? null,
    }));
  }

  // ---------- huddle: remote-control permission handshake ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_CONTROL)
  async onHuddleControl(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleControlPayload) {
    const key = this.huddleGuard(socket, body);
    if (!key || !body.targetUserId) return;
    const me = socket.data.userId;
    const { displayName } = await this.userInfo(socket);
    // request/cancel: requester (me) targets a presenter. grant/deny/revoke:
    // presenter (me) responds about a requester. All are validated server-side.
    if (body.action === 'grant') {
      this.huddle.grantControl(key, body.targetUserId, me);
      // Browser-scoped control = the controller may annotate/point on the shared
      // screen (a browser cannot drive the presenter's OS). Grant that capability
      // so control is actually functional, then re-broadcast the participant list.
      this.huddle.setCanAnnotate(key, body.targetUserId, true);
      await this.broadcastHuddle(key);
    } else if (body.action === 'revoke' || body.action === 'deny') {
      const session = this.huddle.getControl(key);
      if (session && session.presenterId === me) this.huddle.revokeControl(key);
    }
    const presenterId = body.action === 'request' || body.action === 'cancel' ? body.targetUserId : me;
    const requesterId = body.action === 'request' || body.action === 'cancel' ? me : body.targetUserId;
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_CONTROL, (idField) => ({
      ...idField,
      action: body.action,
      requesterId,
      requesterName: body.action === 'request' || body.action === 'cancel' ? displayName : '',
      presenterId,
    }));
  }

  // ---------- huddle: polls ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_POLL)
  onHuddlePoll(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddlePollPayload) {
    const key = this.huddleGuard(socket, body);
    if (!key) return;
    const me = socket.data.userId;
    if (body.action === 'create') {
      // Only a moderator may open a poll; one active poll per huddle.
      if (!this.huddle.isModerator(key, me)) return;
      const options = (body.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 8);
      const question = (body.question ?? '').trim();
      if (!question || options.length < 2) return;
      this.huddle.createPoll(key, { id: randomUUID(), question, options, votes: {}, createdBy: me, closed: false });
    } else if (body.action === 'vote' && body.pollId && body.optionIndex !== undefined) {
      this.huddle.votePoll(key, body.pollId, me, body.optionIndex);
    } else if (body.action === 'close' && body.pollId) {
      if (!this.huddle.isModerator(key, me)) return;
      this.huddle.closePoll(key, body.pollId);
    }
    const poll = this.huddle.getPoll(key);
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_POLL, (idField) => ({ ...idField, poll }));
  }

  // ---------- huddle: collaborative notes ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_NOTES)
  onHuddleNotes(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: ClientHuddleNotesPayload) {
    const key = this.huddleGuard(socket, body);
    if (!key) return;
    this.huddle.setNotes(key, body.content ?? '');
    this.emitToKey(key, SOCKET_EVENTS.HUDDLE_NOTES, (idField) => ({
      ...idField,
      content: this.huddle.getNotes(key),
      updatedBy: socket.data.userId,
    }));
  }

  // ---------- huddle: moderation (host/co-host only) ----------
  @SubscribeMessage(CLIENT_EVENTS.HUDDLE_MODERATION)
  async onHuddleModeration(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: ClientHuddleModerationPayload,
  ) {
    const key = this.huddleGuard(socket, body);
    if (!key || !this.huddle.isModerator(key, socket.data.userId) || !body.targetUserId) return;
    const me = socket.data.userId;
    if (body.action === 'lower-hand') {
      this.huddle.lowerHand(key, body.targetUserId);
      await this.broadcastHuddle(key);
    } else if (body.action === 'set-role' && body.role) {
      // Only a host may hand out roles; never demote the host implicitly.
      if (this.huddle.roleOf(key, me) !== 'host') return;
      this.huddle.setRole(key, body.targetUserId, body.role);
      await this.broadcastHuddle(key);
    }
    // 'mute-request' and 'remove' are directives the target's client acts on
    // (a browser can't force-stop someone's mic, and removal is cooperative);
    // relay them to the target with the moderator's identity for the UI.
    this.realtime.emitToUser(body.targetUserId, SOCKET_EVENTS.HUDDLE_MODERATION, {
      ...(body.channelId ? { channelId: body.channelId } : { conversationId: body.conversationId }),
      action: body.action,
      targetUserId: body.targetUserId,
      role: body.role,
      by: me,
    });
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
