import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { SocketEventName } from '@backstages/shared';

export const roomForUser = (userId: string) => `user:${userId}`;
export const roomForChannel = (channelId: string) => `channel:${channelId}`;
export const roomForConversation = (conversationId: string) => `conversation:${conversationId}`;
export const roomForWorkspace = (workspaceId: string) => `workspace:${workspaceId}`;

/**
 * The only way feature services emit socket events. The Server reference is
 * bound by the gateway in afterInit() — never at construction time — so any
 * emit before initialization fails loudly instead of silently vanishing.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  bindServer(server: Server) {
    this.server = server;
    this.logger.log('Socket.IO server bound');
  }

  private io(): Server {
    if (!this.server) {
      throw new Error('Socket.IO server not initialized yet (afterInit has not run)');
    }
    return this.server;
  }

  emitToUser(userId: string, event: SocketEventName, payload: unknown) {
    this.io().to(roomForUser(userId)).emit(event, payload);
  }

  emitToChannel(channelId: string, event: SocketEventName, payload: unknown) {
    this.io().to(roomForChannel(channelId)).emit(event, payload);
  }

  emitToConversation(conversationId: string, event: SocketEventName, payload: unknown) {
    this.io().to(roomForConversation(conversationId)).emit(event, payload);
  }

  emitToWorkspace(workspaceId: string, event: SocketEventName, payload: unknown) {
    this.io().to(roomForWorkspace(workspaceId)).emit(event, payload);
  }

  emitToContainer(
    container: { channelId: string | null; conversationId: string | null },
    event: SocketEventName,
    payload: unknown,
  ) {
    if (container.channelId) this.emitToChannel(container.channelId, event, payload);
    else if (container.conversationId) this.emitToConversation(container.conversationId, event, payload);
  }

  /** Subscribes every open socket of a user to a room (e.g. after joining a channel). */
  async subscribeUserToRoom(userId: string, room: string) {
    await this.io().in(roomForUser(userId)).socketsJoin(room);
  }

  /** Removes every open socket of a user from a room (e.g. after leaving a channel). */
  async unsubscribeUserFromRoom(userId: string, room: string) {
    await this.io().in(roomForUser(userId)).socketsLeave(room);
  }
}
