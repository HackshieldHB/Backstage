import { Injectable } from '@nestjs/common';

/**
 * In-memory registry of who is currently in each huddle. A huddle is identified
 * by an opaque key — its socket-room name, so it works for both channels
 * ("channel:X") and DM/group conversations ("conversation:Y"). A user counts as
 * present while they have at least one connected socket in the huddle, so
 * multiple tabs and clean disconnect handling both work.
 *
 * NOTE: single-instance state. Horizontal scaling would move this into Redis;
 * the socket relay itself already fans out via the Redis adapter.
 */
@Injectable()
export class HuddleService {
  /** key -> (userId -> set of socketIds) */
  private readonly rooms = new Map<string, Map<string, Set<string>>>();

  join(key: string, userId: string, socketId: string): void {
    let room = this.rooms.get(key);
    if (!room) {
      room = new Map();
      this.rooms.set(key, room);
    }
    let sockets = room.get(userId);
    if (!sockets) {
      sockets = new Set();
      room.set(userId, sockets);
    }
    sockets.add(socketId);
  }

  /** Removes one socket; returns true if the user fully left the huddle. */
  leave(key: string, userId: string, socketId: string): boolean {
    const room = this.rooms.get(key);
    const sockets = room?.get(userId);
    if (!sockets) return false;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      room!.delete(userId);
      if (room!.size === 0) this.rooms.delete(key);
      return true;
    }
    return false;
  }

  /** Removes a socket from every huddle it was in; returns keys the user fully left. */
  removeSocket(userId: string, socketId: string): string[] {
    const affected: string[] = [];
    // Snapshot keys first — leave() may delete rooms as they empty.
    for (const key of [...this.rooms.keys()]) {
      const sockets = this.rooms.get(key)?.get(userId);
      if (sockets?.has(socketId) && this.leave(key, userId, socketId)) {
        affected.push(key);
      }
    }
    return affected;
  }

  userIds(key: string): string[] {
    return [...(this.rooms.get(key)?.keys() ?? [])];
  }
}
