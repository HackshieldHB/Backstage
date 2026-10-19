import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  CalendarSharingDto,
  CalendarVisibility,
  PersonCalendarDto,
  SharedCalendarEventDto,
  SharedCalendarPersonDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { CalendarService, type IcsEvent } from '../calendar/calendar.service';
import { ScheduledHuddlesService } from '../scheduled-huddles/scheduled-huddles.service';

const MAX_PEOPLE = 10;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_MINS = 30;
/** External feeds are fetched live; keep a short cache so a team view doesn't
 *  refetch every person's feed on each navigation. */
const FEED_CACHE_MS = 2 * 60 * 1000;

/**
 * Lets teammates look at each other's calendars — opt-in, per workspace.
 *
 * What a viewer can learn is decided per event, never per request:
 *  - PRIVATE (default): nothing.
 *  - FREE_BUSY: only when the person is busy. No titles, no links.
 *  - DETAILS: titles of Backstages meetings *the viewer could open anyway*
 *    (they're in the same channel/DM) and titles from the person's external
 *    calendar. A meeting in a private channel or DM the viewer isn't part of
 *    still shows only as "Busy" — sharing a calendar never leaks a conversation.
 * The external feed's secret URL is never exposed. Declined meetings don't count.
 */
@Injectable()
export class CalendarSharingService {
  private readonly feedCache = new Map<string, { at: number; from: number; to: number; state: string; events: IcsEvent[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly calendar: CalendarService,
    private readonly meetings: ScheduledHuddlesService,
  ) {}

  async getMine(userId: string, workspaceId: string): Promise<CalendarSharingDto> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    return { visibility: member.calendarVisibility };
  }

  async setMine(userId: string, workspaceId: string, visibility: CalendarVisibility): Promise<CalendarSharingDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const row = await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { calendarVisibility: visibility },
    });
    return { visibility: row.calendarVisibility };
  }

  /** Active teammates (not you, not bots) who share their calendar. */
  async sharedPeople(userId: string, workspaceId: string): Promise<SharedCalendarPersonDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        deactivatedAt: null,
        userId: { not: userId },
        calendarVisibility: { not: 'PRIVATE' },
        user: { isBot: false },
      },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    return rows
      .map((r) => ({
        userId: r.user.id,
        displayName: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
        visibility: r.calendarVisibility as Exclude<CalendarVisibility, 'PRIVATE'>,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /** Several people's calendars over [from, to), as this viewer may see them. */
  async calendars(
    viewerId: string,
    workspaceId: string,
    userIds: string[],
    range: { from?: string; to?: string },
  ): Promise<PersonCalendarDto[]> {
    const ids = [...new Set(userIds.map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0) return [];
    if (ids.length > MAX_PEOPLE) throw new BadRequestException(`At most ${MAX_PEOPLE} people at a time`);
    const from = new Date(range.from ?? '');
    const to = new Date(range.to ?? '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new BadRequestException('Invalid range');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException('Range too long (max 31 days)');

    const access = await this.policy.accessibleContainers(viewerId, workspaceId);
    const viewerChannels = new Set(access.channelIds);
    const viewerConversations = new Set(access.conversationIds);

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: ids }, deactivatedAt: null, user: { isBot: false } },
      select: { userId: true, calendarVisibility: true },
    });
    const visibilityOf = new Map(members.map((m) => [m.userId, m.calendarVisibility as CalendarVisibility]));

    return Promise.all(
      // Unknown, deactivated or foreign users look exactly like private ones.
      ids.map(async (userId): Promise<PersonCalendarDto> => {
        const visibility: CalendarVisibility = userId === viewerId ? 'DETAILS' : (visibilityOf.get(userId) ?? 'PRIVATE');
        if (visibility === 'PRIVATE') return { userId, visibility, events: [], externalUnavailable: false };
        const details = visibility === 'DETAILS';

        const [meetings, feed] = await Promise.all([
          this.meetings.listForWorkspace(userId, workspaceId, { from: from.toISOString(), to: to.toISOString() }),
          this.feed(userId, from, to),
        ]);

        const events: SharedCalendarEventDto[] = [];
        for (const m of meetings) {
          if (m.myResponse === 'DECLINED') continue; // `myResponse` is the owner's answer here
          const start = new Date(m.scheduledFor);
          const end = new Date(start.getTime() + (m.durationMins ?? DEFAULT_MINS) * 60_000);
          const viewerCanOpen =
            (m.channelId !== null && viewerChannels.has(m.channelId)) ||
            (m.conversationId !== null && viewerConversations.has(m.conversationId));
          const reveal = details && viewerCanOpen;
          events.push({
            start: start.toISOString(),
            end: end.toISOString(),
            title: reveal ? m.title : null,
            source: 'meeting',
            meetingId: reveal ? m.sourceId : null,
            tentative: m.myResponse === 'TENTATIVE',
          });
        }
        for (const e of feed.events) {
          events.push({
            start: new Date(e.start).toISOString(),
            end: new Date(e.end).toISOString(),
            title: details && e.title ? e.title.slice(0, 200) : null,
            source: 'external',
            meetingId: null,
            tentative: false,
          });
        }
        events.sort((a, b) => a.start.localeCompare(b.start));
        return { userId, visibility, events, externalUnavailable: feed.state === 'error' };
      }),
    );
  }

  private async feed(userId: string, from: Date, to: Date): Promise<{ state: string; events: IcsEvent[] }> {
    const hit = this.feedCache.get(userId);
    if (hit && Date.now() - hit.at < FEED_CACHE_MS && hit.from <= from.getTime() && hit.to >= to.getTime()) {
      return { state: hit.state, events: hit.events.filter((e) => e.start < to.getTime() && e.end > from.getTime()) };
    }
    const res = await this.calendar.eventsBetween(userId, from, to);
    this.feedCache.set(userId, { at: Date.now(), from: from.getTime(), to: to.getTime(), ...res });
    if (this.feedCache.size > 500) this.feedCache.delete(this.feedCache.keys().next().value!);
    return res;
  }
}
