import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ActivityKind, type ActivitySource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface OpenParams {
  workspaceId: string;
  userId: string;
  kind: ActivityKind;
  source: ActivitySource;
  refId?: string | null;
  meta?: Record<string, unknown>;
  at?: Date;
}

interface CloseParams {
  userId: string;
  source: ActivitySource;
  kind?: ActivityKind;
  refId?: string | null;
  at?: Date;
}

interface RecordParams {
  workspaceId: string;
  userId: string;
  kind: ActivityKind;
  source: ActivitySource;
  refId?: string | null;
  startedAt: Date;
  durationSec: number;
  meta?: Record<string, unknown>;
}

/**
 * The single writer of ActivitySegment rows. Every method is best-effort: it
 * catches and logs its own failures so the signal hooks that call it (huddle
 * join/leave, presence, Jira/Confluence events, message posts) can never break
 * their primary flow. Correctness of the timeline is secondary to never taking
 * down chat or a webhook.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Opens an ongoing segment, first closing any existing open one of the same
   * (source, kind[, refId]) for this user so segments never leak. */
  async open(params: OpenParams): Promise<void> {
    const at = params.at ?? new Date();
    try {
      await this.closeMatching(params.userId, params.source, params.kind, params.refId ?? undefined, at);
      await this.prisma.activitySegment.create({
        data: {
          workspaceId: params.workspaceId,
          userId: params.userId,
          kind: params.kind,
          source: params.source,
          refId: params.refId ?? null,
          startedAt: at,
          meta: (params.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`activity.open failed: ${(err as Error).message}`);
    }
  }

  /** Closes the matching open segment(s), stamping endedAt + durationSec. */
  async close(params: CloseParams): Promise<void> {
    const at = params.at ?? new Date();
    try {
      await this.closeMatching(params.userId, params.source, params.kind, params.refId ?? undefined, at);
    } catch (err) {
      this.logger.warn(`activity.close failed: ${(err as Error).message}`);
    }
  }

  /** Writes a completed, fixed-duration segment (e.g. a logged worklog). */
  async record(params: RecordParams): Promise<void> {
    try {
      const durationSec = Math.max(0, Math.round(params.durationSec));
      await this.prisma.activitySegment.create({
        data: {
          workspaceId: params.workspaceId,
          userId: params.userId,
          kind: params.kind,
          source: params.source,
          refId: params.refId ?? null,
          startedAt: params.startedAt,
          endedAt: new Date(params.startedAt.getTime() + durationSec * 1000),
          durationSec,
          meta: (params.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`activity.record failed: ${(err as Error).message}`);
    }
  }

  /**
   * Records a rolling activity window for bursty, instantaneous signals like
   * chat messages and page edits. Each call implies `windowSec` of activity; if
   * the most recent block of this (source, kind) ended within a window of now,
   * it is extended instead of spawning a new row — so a burst of messages
   * coalesces into one growing block rather than hundreds of tiny ones.
   */
  async touch(params: OpenParams & { windowSec: number }): Promise<void> {
    const at = params.at ?? new Date();
    const windowMs = params.windowSec * 1000;
    try {
      const recent = await this.prisma.activitySegment.findFirst({
        where: {
          userId: params.userId,
          source: params.source,
          kind: params.kind,
          startedAt: { gte: new Date(at.getTime() - 24 * 3600 * 1000) },
        },
        orderBy: { startedAt: 'desc' },
      });
      // Extend the last block if this touch lands within a window of its end.
      if (recent?.endedAt && at.getTime() - recent.endedAt.getTime() <= windowMs) {
        const end = new Date(at.getTime() + windowMs);
        if (end > recent.endedAt) {
          await this.prisma.activitySegment.update({
            where: { id: recent.id },
            data: { endedAt: end, durationSec: Math.round((end.getTime() - recent.startedAt.getTime()) / 1000) },
          });
        }
        return;
      }
      await this.prisma.activitySegment.create({
        data: {
          workspaceId: params.workspaceId,
          userId: params.userId,
          kind: params.kind,
          source: params.source,
          refId: params.refId ?? null,
          startedAt: at,
          endedAt: new Date(at.getTime() + windowMs),
          durationSec: params.windowSec,
          meta: (params.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`activity.touch failed: ${(err as Error).message}`);
    }
  }

  private async closeMatching(
    userId: string,
    source: ActivitySource,
    kind: ActivityKind | undefined,
    refId: string | undefined,
    at: Date,
  ): Promise<void> {
    const open = await this.prisma.activitySegment.findMany({
      where: {
        userId,
        source,
        endedAt: null,
        ...(kind ? { kind } : {}),
        ...(refId !== undefined ? { refId } : {}),
      },
    });
    for (const seg of open) {
      // Guard against clock skew producing a negative duration.
      const end = at.getTime() > seg.startedAt.getTime() ? at : seg.startedAt;
      await this.prisma.activitySegment.update({
        where: { id: seg.id },
        data: { endedAt: end, durationSec: Math.round((end.getTime() - seg.startedAt.getTime()) / 1000) },
      });
    }
  }
}
