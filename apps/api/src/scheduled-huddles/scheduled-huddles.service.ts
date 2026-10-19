import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MeetingResponse as DbMeetingResponse, Prisma, ScheduledHuddle } from '@prisma/client';
import {
  DEFAULT_MEETING_REMINDER_MINS,
  type MeetingGuestDto,
  type MeetingResponse,
  type ScheduleHuddleInput,
  type ScheduledHuddleDetailDto,
  type ScheduledHuddleDto,
  type UpdateScheduledHuddleInput,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextOccurrence, nextOccurrenceAfter, projectOccurrences, validTimeZone } from './recurrence';

/** How long a scheduled huddle keeps showing in a channel's "upcoming" banner
 *  after its start time (so people arriving a little late still see it). */
const GRACE_MS = 60 * 60 * 1000; // 1 hour
/** Past meetings stay on the calendar this long, then are pruned. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Longest early reminder offered (MEETING_REMINDER_OPTIONS), bounds the scan. */
const MAX_REMINDER_MS = 60 * 60 * 1000;
/** Longest meeting (ScheduleHuddleSchema.durationMins max), bounds overlap scans. */
const MAX_DURATION_MS = 600 * 60 * 1000;
/** Longest calendar range one request may ask for. */
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

/** What a reminder/invite notification is about. */
type MeetingNoticeKind = 'invite' | 'reminder' | 'starting' | 'updated' | 'cancelled' | 'response';

/** The relations every DTO needs, with the viewer's own RSVP only. */
function dtoInclude(viewerId: string) {
  return {
    createdBy: { select: { displayName: true } },
    channel: { select: { name: true } },
    conversation: {
      select: { members: { select: { user: { select: { id: true, displayName: true } } } } },
    },
    responses: { where: { userId: viewerId }, select: { response: true } },
  } satisfies Prisma.ScheduledHuddleInclude;
}

type DtoRow = Prisma.ScheduledHuddleGetPayload<{ include: ReturnType<typeof dtoInclude> }>;

/**
 * Meetings planned for later in a channel or DM — a lightweight calendar.
 *
 * Guests are the members of the meeting's channel/DM. They're notified when a
 * meeting is created, changed or cancelled; the queue then reminds them
 * `reminderMins` before the start and again when it starts. Guests who declined
 * get no reminders. A recurring meeting is stored one occurrence at a time: when
 * an occurrence starts, the next one is created.
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
    const when = this.futureDate(input.scheduledFor);
    const recurrence = input.recurrence ?? 'NONE';
    const created = await this.prisma.scheduledHuddle.create({
      data: {
        workspaceId,
        channelId: target.channelId ?? null,
        conversationId: target.conversationId ?? null,
        createdById: userId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        scheduledFor: when,
        durationMins: input.durationMins ?? null,
        reminderMins: input.reminderMins ?? DEFAULT_MEETING_REMINDER_MINS,
        recurrence,
        timeZone: validTimeZone(input.timeZone),
      },
    });
    // A recurring meeting's series is named after its first occurrence.
    const row =
      recurrence === 'NONE'
        ? created
        : await this.prisma.scheduledHuddle.update({ where: { id: created.id }, data: { seriesId: created.id } });

    await this.noticeGuests(row, 'invite', { exclude: [userId] });
    return this.dtoById(row.id, userId);
  }

  async update(userId: string, id: string, input: UpdateScheduledHuddleInput): Promise<ScheduledHuddleDto> {
    const existing = await this.prisma.scheduledHuddle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Meeting not found');
    await this.requireGuest(userId, existing);
    if (existing.createdById !== userId) throw new ForbiddenException('Only the organiser can edit this meeting');
    if (existing.notifiedAt) throw new BadRequestException('This meeting has already started');

    const data: Prisma.ScheduledHuddleUpdateInput = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.description !== undefined) data.description = input.description.trim() || null;
    if (input.durationMins !== undefined) data.durationMins = input.durationMins;
    if (input.timeZone !== undefined) data.timeZone = validTimeZone(input.timeZone);
    if (input.recurrence !== undefined) {
      data.recurrence = input.recurrence;
      if (input.recurrence !== 'NONE' && !existing.seriesId) data.seriesId = existing.id;
    }
    const timeChanged =
      input.scheduledFor !== undefined &&
      new Date(input.scheduledFor).getTime() !== existing.scheduledFor.getTime();
    if (timeChanged) {
      data.scheduledFor = this.futureDate(input.scheduledFor!);
      // A new time means fresh reminders — and guests should answer again.
      data.reminderSentAt = null;
    }
    if (input.reminderMins !== undefined) {
      data.reminderMins = input.reminderMins;
      // Changing the lead time re-arms the early reminder (if it's still ahead).
      data.reminderSentAt = null;
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (timeChanged) await tx.scheduledHuddleResponse.deleteMany({ where: { scheduledHuddleId: id } });
      return tx.scheduledHuddle.update({ where: { id }, data });
    });

    const worthTelling = timeChanged || input.title !== undefined || input.recurrence !== undefined;
    if (worthTelling) await this.noticeGuests(row, 'updated', { exclude: [userId], extra: { timeChanged } });
    return this.dtoById(row.id, userId);
  }

  /**
   * Cancel a meeting (organiser only). For a recurring meeting, `occurrence`
   * skips just the next occurrence (the series moves on to the one after);
   * `series` ends it. A non-organiser or unknown id is a silent no-op.
   */
  async cancel(userId: string, id: string, scope: 'series' | 'occurrence' = 'series'): Promise<{ ok: boolean }> {
    const row = await this.prisma.scheduledHuddle.findFirst({ where: { id, createdById: userId } });
    if (!row) return { ok: false };

    const next =
      scope === 'occurrence' && !row.notifiedAt
        ? nextOccurrenceAfter(row.scheduledFor, row.recurrence, row.timeZone, new Date())
        : null;

    if (next) {
      // Guard on the time we read, so a concurrent fire/edit isn't overwritten.
      const moved = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.scheduledHuddle.updateMany({
          where: { id, scheduledFor: row.scheduledFor, notifiedAt: null },
          data: { scheduledFor: next, reminderSentAt: null },
        });
        if (count) await tx.scheduledHuddleResponse.deleteMany({ where: { scheduledHuddleId: id } });
        return count > 0;
      });
      if (!moved) return { ok: false };
      await this.noticeGuests(row, 'cancelled', { exclude: [userId], extra: { scope: 'occurrence' } });
      return { ok: true };
    }

    // Notify before deleting: the guest list is derived from the row.
    await this.noticeGuests(row, 'cancelled', { exclude: [userId], extra: { scope: 'series' } });
    // Ending a series also removes its upcoming occurrence, even when the row
    // picked was an earlier (already started) one. Past occurrences stay.
    const { count } = await this.prisma.scheduledHuddle.deleteMany({
      where: {
        createdById: userId,
        OR: [
          { id },
          ...(scope === 'series' && row.seriesId ? [{ seriesId: row.seriesId, notifiedAt: null }] : []),
        ],
      },
    });
    return { ok: count > 0 };
  }

  async respond(userId: string, id: string, response: MeetingResponse): Promise<ScheduledHuddleDto> {
    const row = await this.prisma.scheduledHuddle.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Meeting not found');
    await this.requireGuest(userId, row);
    const previous = await this.prisma.scheduledHuddleResponse.findUnique({
      where: { scheduledHuddleId_userId: { scheduledHuddleId: id, userId } },
    });
    await this.prisma.scheduledHuddleResponse.upsert({
      where: { scheduledHuddleId_userId: { scheduledHuddleId: id, userId } },
      create: { scheduledHuddleId: id, userId, response },
      update: { response },
    });
    if (row.createdById !== userId && previous?.response !== response) {
      await this.notice(row, row.createdById, 'response', { actorId: userId, extra: { response } });
    }
    return this.dtoById(id, userId);
  }

  // ---------- reading ----------

  async listForChannel(userId: string, channelId: string): Promise<ScheduledHuddleDto[]> {
    await this.policy.requireChannelMember(userId, channelId);
    return this.listUpcoming(userId, { channelId });
  }

  async listForConversation(userId: string, conversationId: string): Promise<ScheduledHuddleDto[]> {
    await this.policy.requireConversationMember(userId, conversationId);
    return this.listUpcoming(userId, { conversationId });
  }

  /**
   * Without a range: upcoming (and just-started) meetings everywhere the user can
   * read. With `from`/`to`: every meeting overlapping that window, including
   * projected future occurrences of recurring meetings — the calendar view.
   */
  async listForWorkspace(
    userId: string,
    workspaceId: string,
    range?: { from?: string; to?: string },
  ): Promise<ScheduledHuddleDto[]> {
    const { channelIds, conversationIds } = await this.policy.accessibleContainers(userId, workspaceId);
    const scope: Prisma.ScheduledHuddleWhereInput = {
      workspaceId,
      OR: [{ channelId: { in: channelIds } }, { conversationId: { in: conversationIds } }],
    };
    if (!range?.from && !range?.to) return this.listUpcoming(userId, scope);
    return this.listRange(userId, scope, range);
  }

  async detail(userId: string, id: string): Promise<ScheduledHuddleDetailDto> {
    const row = await this.prisma.scheduledHuddle.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Meeting not found');
    await this.requireGuest(userId, row);
    const [dto, memberIds, responses] = await Promise.all([
      this.dtoById(id, userId),
      this.memberIds(row),
      this.prisma.scheduledHuddleResponse.findMany({ where: { scheduledHuddleId: id } }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, displayName: true, avatarUrl: true },
    });
    const byUser = new Map(responses.map((r) => [r.userId, r.response as MeetingResponse]));
    const guests: MeetingGuestDto[] = users
      .map((u) => ({
        userId: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        response: byUser.get(u.id) ?? null,
        isOrganizer: u.id === row.createdById,
      }))
      .sort((a, b) => Number(b.isOrganizer) - Number(a.isOrganizer) || a.displayName.localeCompare(b.displayName));
    return { ...dto, guests };
  }

  /** Upcoming (and recently-started, within the grace window) meetings for a scope. */
  private async listUpcoming(userId: string, where: Prisma.ScheduledHuddleWhereInput): Promise<ScheduledHuddleDto[]> {
    const rows = await this.prisma.scheduledHuddle.findMany({
      where: { ...where, scheduledFor: { gte: new Date(Date.now() - GRACE_MS) } },
      orderBy: { scheduledFor: 'asc' },
      include: dtoInclude(userId),
      take: 100,
    });
    return rows.map((r) => this.toDto(r, userId));
  }

  private async listRange(
    userId: string,
    scope: Prisma.ScheduledHuddleWhereInput,
    range: { from?: string; to?: string },
  ): Promise<ScheduledHuddleDto[]> {
    const from = new Date(range.from ?? Date.now());
    const to = range.to ? new Date(range.to) : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new BadRequestException('Invalid range');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException('Range too long');

    const [stored, heads] = await Promise.all([
      // Anything that could overlap the window (a meeting can start before it).
      this.prisma.scheduledHuddle.findMany({
        where: { ...scope, scheduledFor: { gte: new Date(from.getTime() - MAX_DURATION_MS), lt: to } },
        orderBy: { scheduledFor: 'asc' },
        include: dtoInclude(userId),
        take: 500,
      }),
      // The not-yet-started occurrence of each recurring series: later ones are
      // projected from it.
      this.prisma.scheduledHuddle.findMany({
        where: { ...scope, recurrence: { not: 'NONE' }, notifiedAt: null, scheduledFor: { lt: to } },
        include: dtoInclude(userId),
        take: 200,
      }),
    ]);

    const overlaps = (start: number, mins: number | null) =>
      start < to.getTime() && start + (mins ?? 30) * 60_000 > from.getTime();

    const out = stored.filter((r) => overlaps(r.scheduledFor.getTime(), r.durationMins)).map((r) => this.toDto(r, userId));
    for (const head of heads) {
      const base = this.toDto(head, userId);
      for (const at of projectOccurrences(head.scheduledFor, head.recurrence, head.timeZone, to)) {
        if (!overlaps(at.getTime(), head.durationMins)) continue;
        out.push({
          ...base,
          id: `${head.id}@${at.toISOString()}`,
          virtual: true,
          scheduledFor: at.toISOString(),
          notified: false,
          myResponse: null,
        });
      }
    }
    return out.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  // ---------- delivery (called by the worker) ----------

  /** Sends due early reminders and start notices, rolls recurring meetings on,
   *  and prunes old rows. Returns the number of notices sent (meetings, not people). */
  async fireDue(now = new Date()): Promise<number> {
    await this.prisma.scheduledHuddle
      .deleteMany({ where: { scheduledFor: { lt: new Date(now.getTime() - RETENTION_MS) } } })
      .catch(() => undefined);

    let fired = 0;

    // 1) "Starting soon" — reminderMins before the start.
    const soon = await this.prisma.scheduledHuddle.findMany({
      where: {
        reminderSentAt: null,
        notifiedAt: null,
        reminderMins: { gt: 0 },
        scheduledFor: { gt: now, lte: new Date(now.getTime() + MAX_REMINDER_MS) },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    });
    for (const h of soon) {
      if (h.scheduledFor.getTime() - h.reminderMins * 60_000 > now.getTime()) continue;
      // Claim first so two workers (or a slow previous tick) can't both send it.
      const { count } = await this.prisma.scheduledHuddle.updateMany({
        where: { id: h.id, reminderSentAt: null, notifiedAt: null, scheduledFor: h.scheduledFor },
        data: { reminderSentAt: now },
      });
      if (!count) continue;
      // Round up: the worker ticks every minute, so "10 min before" lands at ~9.5 min.
      const minutes = Math.max(1, Math.ceil((h.scheduledFor.getTime() - now.getTime()) / 60_000));
      if (await this.safely(h.id, () => this.noticeGuests(h, 'reminder', { skipDeclined: true, extra: { minutes } }))) {
        fired++;
      }
    }

    // 2) "Starting now" — and roll a recurring meeting on to its next occurrence.
    const due = await this.prisma.scheduledHuddle.findMany({
      where: { notifiedAt: null, scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    });
    for (const h of due) {
      const { count } = await this.prisma.scheduledHuddle.updateMany({
        where: { id: h.id, notifiedAt: null, scheduledFor: h.scheduledFor },
        data: { notifiedAt: now, reminderSentAt: h.reminderSentAt ?? now },
      });
      if (!count) continue;

      // If the server was down well past the meeting, a "starting now" would be a lie.
      const lateMs = now.getTime() - h.scheduledFor.getTime();
      const stillOn = lateMs <= Math.max(15, h.durationMins ?? 60) * 60_000;
      if (stillOn && (await this.safely(h.id, () => this.noticeGuests(h, 'starting', { skipDeclined: true })))) {
        fired++;
      }
      await this.safely(h.id, () => this.rollForward(h, now));
    }
    return fired;
  }

  /** Create the next occurrence of a recurring meeting (after `now`). */
  private async rollForward(h: ScheduledHuddle, now: Date): Promise<void> {
    if (h.recurrence === 'NONE') return;
    const first = nextOccurrence(h.scheduledFor, h.recurrence, h.timeZone);
    const next =
      first && first.getTime() > now.getTime()
        ? first
        : nextOccurrenceAfter(h.scheduledFor, h.recurrence, h.timeZone, now);
    if (!next) return;
    await this.prisma.scheduledHuddle.create({
      data: {
        workspaceId: h.workspaceId,
        channelId: h.channelId,
        conversationId: h.conversationId,
        createdById: h.createdById,
        title: h.title,
        description: h.description,
        scheduledFor: next,
        durationMins: h.durationMins,
        reminderMins: h.reminderMins,
        recurrence: h.recurrence,
        timeZone: h.timeZone,
        seriesId: h.seriesId ?? h.id,
      },
    });
  }

  private async safely(id: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      this.logger.warn(`Scheduled meeting ${id}: ${String(err)}`);
      return false;
    }
  }

  // ---------- helpers ----------

  private futureDate(iso: string): Date {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Invalid scheduledFor');
    if (when.getTime() <= Date.now()) throw new BadRequestException('scheduledFor must be in the future');
    return when;
  }

  /** The caller must be able to read the meeting's channel/DM. */
  private async requireGuest(userId: string, row: ScheduledHuddle): Promise<void> {
    if (row.channelId) await this.policy.requireChannelMember(userId, row.channelId);
    else if (row.conversationId) await this.policy.requireConversationMember(userId, row.conversationId);
    else throw new NotFoundException('Meeting not found');
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

  /** Notify every guest (optionally minus some, or minus those who declined). */
  private async noticeGuests(
    h: ScheduledHuddle,
    kind: MeetingNoticeKind,
    opts: { exclude?: string[]; skipDeclined?: boolean; extra?: Record<string, Prisma.InputJsonValue> } = {},
  ): Promise<void> {
    let ids = await this.memberIds(h);
    if (opts.exclude?.length) ids = ids.filter((id) => !opts.exclude!.includes(id));
    if (opts.skipDeclined && ids.length) {
      const declined = await this.prisma.scheduledHuddleResponse.findMany({
        where: { scheduledHuddleId: h.id, response: 'DECLINED' satisfies DbMeetingResponse },
        select: { userId: true },
      });
      const out = new Set(declined.map((d) => d.userId));
      ids = ids.filter((id) => !out.has(id));
    }
    if (!ids.length) return;
    const organizerName = await this.organizerName(h);
    await Promise.all(ids.map((uid) => this.notice(h, uid, kind, { extra: opts.extra, organizerName })));
  }

  private async organizerName(h: ScheduledHuddle): Promise<string> {
    const organizer = await this.prisma.user.findUnique({
      where: { id: h.createdById },
      select: { displayName: true },
    });
    return organizer?.displayName ?? 'Someone';
  }

  private async notice(
    h: ScheduledHuddle,
    userId: string,
    kind: MeetingNoticeKind,
    opts: { actorId?: string; extra?: Record<string, Prisma.InputJsonValue>; organizerName?: string } = {},
  ): Promise<void> {
    const organizerName = opts.organizerName ?? (await this.organizerName(h));
    await this.notifications.notify({
      userId,
      type: 'SYSTEM',
      actorId: opts.actorId ?? h.createdById,
      channelId: h.channelId,
      conversationId: h.conversationId,
      payload: {
        source: 'scheduled-huddle',
        kind,
        scheduledHuddleId: h.id,
        title: h.title,
        scheduledFor: h.scheduledFor.toISOString(),
        durationMins: h.durationMins,
        // Kept under its original name for older clients.
        startedBy: organizerName,
        ...(opts.extra ?? {}),
      },
    });
  }

  private async dtoById(id: string, viewerId: string): Promise<ScheduledHuddleDto> {
    const row = await this.prisma.scheduledHuddle.findUniqueOrThrow({ where: { id }, include: dtoInclude(viewerId) });
    return this.toDto(row, viewerId);
  }

  private toDto(row: DtoRow, viewerId: string): ScheduledHuddleDto {
    let locationName = row.channel?.name ?? '';
    if (row.conversation) {
      const others = row.conversation.members.map((m) => m.user).filter((u) => u.id !== viewerId);
      locationName = others.length ? others.map((u) => u.displayName).join(', ') : 'Just you';
    }
    return {
      id: row.id,
      sourceId: row.id,
      virtual: false,
      workspaceId: row.workspaceId,
      channelId: row.channelId,
      conversationId: row.conversationId,
      locationName,
      title: row.title,
      description: row.description,
      scheduledFor: row.scheduledFor.toISOString(),
      durationMins: row.durationMins,
      reminderMins: row.reminderMins,
      recurrence: row.recurrence,
      timeZone: row.timeZone,
      seriesId: row.seriesId,
      createdById: row.createdById,
      createdByName: row.createdBy.displayName,
      notified: row.notifiedAt !== null,
      myResponse: (row.responses[0]?.response as MeetingResponse | undefined) ?? null,
    };
  }
}
