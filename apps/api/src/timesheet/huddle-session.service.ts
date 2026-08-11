import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from './activity.service';

/**
 * Persists huddle sessions so meeting time outlives the in-memory HuddleService
 * and feeds the timeline as MEETING activity. Driven by the realtime gateway:
 * join() on first join, leave() when a user has fully left the huddle. Every
 * method is best-effort — a failure here must never break the huddle itself.
 */
@Injectable()
export class HuddleSessionService {
  private readonly logger = new Logger(HuddleSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** roomKey is "channel:X" / "conversation:Y" — resolve its workspace. */
  private async workspaceForRoom(roomKey: string): Promise<string | null> {
    const [kind, id] = roomKey.split(':');
    if (!id) return null;
    if (kind === 'channel') {
      const ch = await this.prisma.channel.findUnique({ where: { id }, select: { workspaceId: true } });
      return ch?.workspaceId ?? null;
    }
    if (kind === 'conversation') {
      const c = await this.prisma.conversation.findUnique({ where: { id }, select: { workspaceId: true } });
      return c?.workspaceId ?? null;
    }
    return null;
  }

  async join(roomKey: string, userId: string): Promise<void> {
    try {
      const workspaceId = await this.workspaceForRoom(roomKey);
      if (!workspaceId) return;

      let session = await this.prisma.huddleSession.findFirst({
        where: { roomKey, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!session) {
        session = await this.prisma.huddleSession.create({ data: { workspaceId, roomKey } });
      }

      const already = await this.prisma.huddleParticipant.findFirst({
        where: { sessionId: session.id, userId, leftAt: null },
      });
      if (already) return; // idempotent across multiple tabs/sockets

      await this.prisma.huddleParticipant.create({ data: { sessionId: session.id, userId } });
      await this.activity.open({
        workspaceId,
        userId,
        kind: 'MEETING',
        source: 'HUDDLE',
        refId: roomKey,
      });
    } catch (err) {
      this.logger.warn(`huddle join persist failed: ${(err as Error).message}`);
    }
  }

  async leave(roomKey: string, userId: string): Promise<void> {
    try {
      const session = await this.prisma.huddleSession.findFirst({
        where: { roomKey, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!session) return;

      await this.prisma.huddleParticipant.updateMany({
        where: { sessionId: session.id, userId, leftAt: null },
        data: { leftAt: new Date() },
      });
      await this.activity.close({ userId, source: 'HUDDLE', kind: 'MEETING', refId: roomKey });

      // Close the session once everyone has gone.
      const remaining = await this.prisma.huddleParticipant.count({
        where: { sessionId: session.id, leftAt: null },
      });
      if (remaining === 0) {
        await this.prisma.huddleSession.update({
          where: { id: session.id },
          data: { endedAt: new Date() },
        });
      }
    } catch (err) {
      this.logger.warn(`huddle leave persist failed: ${(err as Error).message}`);
    }
  }
}
