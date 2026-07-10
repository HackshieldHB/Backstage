import { Injectable } from '@nestjs/common';
import type { PresenceState } from '@backstages/shared';
import { SOCKET_EVENTS } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisClient } from '../redis/redis.module';
import { RealtimeService } from '../realtime/realtime.service';
import { PolicyService } from '../authz/policy.service';

/** Sockets heartbeat every ~30s; a user with no beat for this long is offline. */
const ONLINE_TTL_SECONDS = 75;

const onlineKey = (userId: string) => `presence:online:${userId}`;
const manualKey = (userId: string) => `presence:manual:${userId}`;

@Injectable()
export class PresenceService {
  constructor(
    private readonly redis: RedisClient,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly policy: PolicyService,
  ) {}

  /** Called on socket connect. Returns true when the user just came online. */
  async connected(userId: string): Promise<void> {
    const count = await this.redis.incr(onlineKey(userId));
    await this.redis.expire(onlineKey(userId), ONLINE_TTL_SECONDS);
    if (count === 1) await this.broadcast(userId);
  }

  /** Called on socket disconnect. */
  async disconnected(userId: string): Promise<void> {
    const count = await this.redis.decr(onlineKey(userId));
    if (count <= 0) {
      await this.redis.del(onlineKey(userId));
      await this.broadcast(userId);
    }
  }

  /** Heartbeat keeps the online key alive while any socket is open. */
  async heartbeat(userId: string): Promise<void> {
    const exists = await this.redis.exists(onlineKey(userId));
    if (exists) {
      await this.redis.expire(onlineKey(userId), ONLINE_TTL_SECONDS);
    } else {
      // TTL lapsed (e.g. laptop slept) — coming back counts as a transition.
      await this.redis.set(onlineKey(userId), '1', 'EX', ONLINE_TTL_SECONDS);
      await this.broadcast(userId);
    }
  }

  /** Manual override: AWAY / DND stick until cleared by setting ACTIVE. */
  async setManualState(userId: string, state: 'ACTIVE' | 'AWAY' | 'DND'): Promise<PresenceState> {
    if (state === 'ACTIVE') await this.redis.del(manualKey(userId));
    else await this.redis.set(manualKey(userId), state);
    await this.broadcast(userId);
    return this.effectiveState(userId);
  }

  async effectiveState(userId: string): Promise<PresenceState> {
    const [manual, online] = await Promise.all([
      this.redis.get(manualKey(userId)),
      this.redis.exists(onlineKey(userId)),
    ]);
    if (manual === 'DND') return 'DND';
    if (manual === 'AWAY') return 'AWAY';
    return online ? 'ACTIVE' : 'OFFLINE';
  }

  /** Presence map for every member of a workspace (member-only). */
  async workspacePresence(callerId: string, workspaceId: string): Promise<Record<string, PresenceState>> {
    await this.policy.requireWorkspaceMember(callerId, workspaceId);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true },
    });
    const entries = await Promise.all(
      members.map(async (m) => [m.userId, await this.effectiveState(m.userId)] as const),
    );
    return Object.fromEntries(entries);
  }

  /** Fan a presence change out to every workspace the user belongs to. */
  private async broadcast(userId: string): Promise<void> {
    const state = await this.effectiveState(userId);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    for (const m of memberships) {
      this.realtime.emitToWorkspace(m.workspaceId, SOCKET_EVENTS.PRESENCE_CHANGED, { userId, state });
    }
  }
}
