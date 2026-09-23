import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma, ScheduledHuddle } from '@prisma/client';
import type { ScheduleHuddleInput, ScheduledHuddleDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { NotificationsService } from '../notifications/notifications.service';

type ScheduledHuddleRow = ScheduledHuddle & { createdBy: { displayName: string } };

/** How long a scheduled huddle keeps showing in the "upcoming" list after its
 *  start time (so people arriving a little late still see it), and after which a
 *  fired row is pruned. */
const GRACE_MS = 60 * 60 * 1000; // 1 hour
const PRUNE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Plans huddles for a future time in a channel or DM and, via the queue, fires a
 * "starting now" reminder to every member when the time arrives. The row is kept
 * briefly afterwards so it still appears in the upcoming list, then pruned.
 */
@Injectable()
export class ScheduledHuddlesService {
  private readonly logger = new Logger(ScheduledHuddlesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- scheduling ----------

  async scheduleForChannel(
    userId: string,
    channelId: string,
    input: ScheduleHuddleInput,
  ): Promise<ScheduledHuddleDto> {
    const { channel } = await this.policy.requireChannelMember(userId, channelId);
    return this.create(userId, channel.workspaceId, { channelId }, input);
  }

  async scheduleForConversation(
    userId: string,
    conversationId: string,
    input: ScheduleHuddleInput,
  ): Promise<ScheduledHuddleDto> {
    const { conversation } = await this.policy.requireConversationMember(userId, conversationId);
    return this.create(userId, conversation.workspaceId, { conversationId }, input);
  }

  private async create(
    userId: string,
    workspaceId: string,
    target: { channelId?: string; conversationId?: string },
    input: ScheduleHuddleInput,
  ): Promise<ScheduledHuddleDto> {
    const when = new Date(input.scheduledFor);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Invalid scheduledFor');
    if (when.getTime() <= Date.now()) throw new BadRequestException('scheduledFor must be in the future');
    const row = await this.prisma.scheduledHuddle.create({
      data: {
        workspaceId,
        channelId: target.channelId ?? null,
        conversationId: target.conversationId ?? null,
        createdById: userId,
        title: input.title.trim(),
        scheduledFor: when,
        durationMins: input.durationMins ?? null,
      },
      include: { createdBy: { select: { displayName: true } } },
    });
    return this.toDto(row);
  }

  // ---------- listing ----------

  async listForChannel(userId: string, channelId: string): Promise<ScheduledHuddleDto[]> {
    await this.policy.requireChannelMember(userId, channelId);
    return this.list({ channelId });
  }

  async listForConversation(userId: string, conversationId: string): Promise<ScheduledHuddleDto[]> {
    await this.policy.requireConversationMember(userId, conversationId);
    return this.list({ conversationId });
  }

  async listForWorkspace(userId: string, workspaceId: string): Promise<ScheduledHuddleDto[]> {
    const { channelIds, conversationIds } = await this.policy.accessibleContainers(userId, workspaceId);
    return this.list({
      workspaceId,
      OR: [{ channelId: { in: channelIds } }, { conversationId: { in: conversationIds } }],
    });
  }

  /** Upcoming (and recently-started, within the grace window) huddles for a scope. */
  private async list(where: Prisma.ScheduledHuddleWhereInput): Promise<ScheduledHuddleDto[]> {
    const rows = await this.prisma.scheduledHuddle.findMany({
      where: { ...where, scheduledFor: { gte: new Date(Date.now() - GRACE_MS) } },
      orderBy: { scheduledFor: 'asc' },
      include: { createdBy: { select: { displayName: true } } },
      take: 100,
    });
    return rows.map((r) => this.toDto(r));
  }

  async cancel(userId: string, id: string): Promise<{ ok: boolean }> {
    // Scoped to the creator: a non-owner or unknown id is a silent no-op.
    const { count } = await this.prisma.scheduledHuddle.deleteMany({ where: { id, createdById: userId } });
    return { ok: count > 0 };
  }

  // ---------- delivery (called by the worker) ----------

  /** Fires reminders for everything due, prunes stale rows; returns count fired. */
  async fireDue(now = new Date()): Promise<number> {
    // Prune rows whose start is well in the past so the table stays small.
    await this.prisma.scheduledHuddle
      .deleteMany({ where: { scheduledFor: { lt: new Date(now.getTime() - PRUNE_MS) } } })
      .catch(() => undefined);

    const due = await this.prisma.scheduledHuddle.findMany({
      where: { notifiedAt: null, scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      include: { createdBy: { select: { displayName: true } } },
      take: 200,
    });

    let fired = 0;
    for (const h of due) {
      try {
        const memberIds = await this.memberIds(h);
        await Promise.all(
          memberIds.map((uid) =>
            this.notifications.notify({
              userId: uid,
              type: 'SYSTEM',
              actorId: h.createdById,
              channelId: h.channelId,
              conversationId: h.conversationId,
              payload: {
                source: 'scheduled-huddle',
                scheduledHuddleId: h.id,
                title: h.title,
                startedBy: h.createdBy.displayName,
              },
            }),
          ),
        );
        fired++;
      } catch (err) {
        this.logger.warn(`Scheduled huddle ${h.id} reminder failed: ${String(err)}`);
      }
      // Mark fired regardless, so a failing reminder isn't retried every minute.
      await this.prisma.scheduledHuddle
        .update({ where: { id: h.id }, data: { notifiedAt: now } })
        .catch(() => undefined);
    }
    return fired;
  }

  private async memberIds(h: ScheduledHuddle): Promise<string[]> {
    if (h.channelId) {
      const rows = await this.prisma.channelMember.findMany({
        where: { channelId: h.channelId },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    }
    if (h.conversationId) {
      const rows = await this.prisma.conversationMember.findMany({
        where: { conversationId: h.conversationId },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    }
    return [];
  }

  private toDto(row: ScheduledHuddleRow): ScheduledHuddleDto {
    return {
      id: row.id,
      channelId: row.channelId,
      conversationId: row.conversationId,
      title: row.title,
      scheduledFor: row.scheduledFor.toISOString(),
      durationMins: row.durationMins,
      createdById: row.createdById,
      createdByName: row.createdBy.displayName,
      notified: row.notifiedAt !== null,
    };
  }
}
