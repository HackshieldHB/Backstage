import { Injectable } from '@nestjs/common';

/**
 * In-memory registry of who is currently in each channel's huddle. A user counts
 * as present while they have at least one connected socket in the huddle, so
 * multiple tabs and clean disconnect handling both work.
 *
 * NOTE: single-instance state. Horizontal scaling would move this into Redis;
 * the socket relay itself already fans out via the Redis adapter.
 */
@Injectable()
export class HuddleService {
  /** channelId -> (userId -> set of socketIds) */
  private readonly rooms = new Map<string, Map<string, Set<string>>>();

  join(channelId: string, userId: string, socketId: string): void {
    let room = this.rooms.get(channelId);
    if (!room) {
      room = new Map();
      this.rooms.set(channelId, room);
    }
    let sockets = room.get(userId);
    if (!sockets) {
      sockets = new Set();
      room.set(userId, sockets);
    }
    sockets.add(socketId);
  }

  /** Removes one socket; returns true if the user fully left the huddle. */
  leave(channelId: string, userId: string, socketId: string): boolean {
    const room = this.rooms.get(channelId);
    const sockets = room?.get(userId);
    if (!sockets) return false;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      room!.delete(userId);
      if (room!.size === 0) this.rooms.delete(channelId);
      return true;
    }
    return false;
  }

  /** Removes a socket from every huddle it was in; returns channelIds the user fully left. */
  removeSocket(userId: string, socketId: string): string[] {
    const affected: string[] = [];
    // Snapshot keys first — leave() may delete rooms as they empty.
    for (const channelId of [...this.rooms.keys()]) {
      const sockets = this.rooms.get(channelId)?.get(userId);
      if (sockets?.has(socketId) && this.leave(channelId, userId, socketId)) {
        affected.push(channelId);
      }
    }
    return affected;
  }

  userIds(channelId: string): string[] {
    return [...(this.rooms.get(channelId)?.keys() ?? [])];
  }
}
