import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  JiraMyIssue,
  MyDayDto,
  MyDayItemDto,
  MyDayMeetingDto,
  MyDayPlanDto,
  TaskDto,
  WorkflowRequestDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { TasksService } from '../tasks/tasks.service';
import { WorkflowRunsService } from '../workflows/workflow-runs.service';
import { ScheduledHuddlesService } from '../scheduled-huddles/scheduled-huddles.service';
import { CalendarService } from '../calendar/calendar.service';
import { AvailabilityService } from '../availability/availability.service';
import { AtlassianService } from '../atlassian/atlassian.service';
import { JiraActionsService } from '../atlassian/jira-actions.service';
import { AiService } from '../ai/ai.service';

const DAY_MS = 86_400_000;
const MAX_FOCUS = 30;
const HIGH_PRIORITY = new Set(['highest', 'high', 'blocker', 'critical', 'urgent']);

/** Start/end (UTC instants) and calendar date of the local day containing `now`. */
export function localDay(now: Date, tzOffsetMin: number): { start: Date; end: Date; date: string } {
  const offsetMs = tzOffsetMin * 60_000;
  const localMidnight = Math.floor((now.getTime() + offsetMs) / DAY_MS) * DAY_MS;
  return {
    start: new Date(localMidnight - offsetMs),
    end: new Date(localMidnight - offsetMs + DAY_MS),
    date: new Date(localMidnight).toISOString().slice(0, 10),
  };
}

/**
 * The standard "what to do first" order. Pure, so it can be tested:
 * requests people are waiting on → overdue → due today → high-priority Jira →
 * due soon → other Jira → later → undated.
 */
export function buildFocus(input: {
  tasks: TaskDto[];
  requests: WorkflowRequestDto[];
  jira: JiraMyIssue[];
  now: Date;
  dayEnd: Date;
  today: string;
}): MyDayItemDto[] {
  const { now, dayEnd, today } = input;
  const ranked: Array<{ rank: number; sort: number; item: MyDayItemDto }> = [];
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  for (const r of input.requests) {
    ranked.push({
      rank: 0,
      sort: new Date(r.createdAt).getTime(),
      item: {
        id: `request:${r.runId}`,
        kind: 'request',
        title: r.prompt.slice(0, 200),
        detail: r.workflowName,
        reason:
          r.kind === 'request_approval'
            ? 'Someone is waiting on your approval'
            : 'Someone is waiting on your answers',
        overdue: false,
        due: r.expiresAt,
        url: null,
      },
    });
  }

  for (const t of input.tasks) {
    const due = t.dueAt ? new Date(t.dueAt) : null;
    let rank: number;
    let reason: string;
    if (!due) {
      rank = 9;
      reason = 'No due date';
    } else if (due < now) {
      rank = 1;
      reason = 'Overdue';
    } else if (due < dayEnd) {
      rank = 3;
      reason = 'Due today';
    } else if (due.getTime() < dayEnd.getTime() + 2 * DAY_MS) {
      rank = 6;
      reason = 'Due soon';
    } else {
      rank = 8;
      reason = `Due ${shortDate(due.toISOString())}`;
    }
    ranked.push({
      rank,
      sort: due ? due.getTime() : new Date(t.createdAt).getTime(),
      item: {
        id: `task:${t.id}`,
        kind: 'task',
        title: t.title,
        detail:
          t.createdBy && t.assignee && t.createdBy.id !== t.assignee.id
            ? `From ${t.createdBy.displayName}`
            : null,
        reason,
        overdue: rank === 1,
        due: t.dueAt,
        url: null,
      },
    });
  }

  for (const j of input.jira) {
    const high = !!j.priority && HIGH_PRIORITY.has(j.priority.toLowerCase());
    const overdue = !!j.dueDate && j.dueDate < today;
    const dueToday = j.dueDate === today;
    const rank = overdue ? 2 : dueToday ? 4 : high ? 5 : 7;
    const reason = overdue
      ? 'Overdue in Jira'
      : dueToday
        ? 'Due today in Jira'
        : high
          ? `${j.priority} priority in Jira`
          : 'Assigned to you in Jira';
    ranked.push({
      rank,
      sort: j.dueDate ? Date.parse(`${j.dueDate}T00:00:00Z`) : Number.MAX_SAFE_INTEGER,
      item: {
        id: `jira:${j.key}`,
        kind: 'jira',
        title: `${j.key} · ${j.summary}`,
        detail: [j.status, j.priority].filter(Boolean).join(' · ') || null,
        reason,
        overdue,
        due: j.dueDate,
        url: j.url,
      },
    });
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || a.sort - b.sort)
    .slice(0, MAX_FOCUS)
    .map((r) => r.item);
}

/**
 * Re-order `focus` by an AI suggestion: known ids in the suggested order (with
 * the AI's reasons), then anything the model skipped in the standard order.
 */
export function applySuggestedOrder(
  focus: MyDayItemDto[],
  suggestion: Array<{ id: string; reason: string }>,
): MyDayItemDto[] {
  const byId = new Map(focus.map((i) => [i.id, i]));
  const out: MyDayItemDto[] = [];
  const used = new Set<string>();
  for (const s of suggestion) {
    const item = byId.get(s.id);
    if (!item || used.has(s.id)) continue;
    used.add(s.id);
    out.push({ ...item, reason: s.reason.trim() || item.reason });
  }
  for (const item of focus) if (!used.has(item.id)) out.push(item);
  return out;
}

/** "My day": today's meetings and work for the caller, in a suggested order. */
@Injectable()
export class MyDayService {
  private readonly logger = new Logger(MyDayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly tasks: TasksService,
    private readonly runs: WorkflowRunsService,
    private readonly huddles: ScheduledHuddlesService,
    private readonly calendar: CalendarService,
    private readonly availability: AvailabilityService,
    private readonly atlassian: AtlassianService,
    private readonly jiraActions: JiraActionsService,
    private readonly ai: AiService,
  ) {}

  async get(
    userId: string,
    workspaceId: string,
    tzOffsetParam?: string,
    now = new Date(),
  ): Promise<MyDayDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const avail = await this.availability.getMine(userId, workspaceId);
    const tzOffsetMin = parseOffset(tzOffsetParam) ?? avail.tzOffsetMin ?? 0;
    const day = localDay(now, tzOffsetMin);

    const [allTasks, requests, huddles, cal, jira] = await Promise.all([
      this.tasks.list(userId, workspaceId),
      this.runs.listRequests(userId, workspaceId),
      this.huddles.listForWorkspace(userId, workspaceId),
      this.calendar.eventsBetween(userId, day.start, day.end),
      this.jiraIssues(userId, workspaceId),
    ]);

    // Open tasks that are mine: assigned to me, or unassigned ones I created.
    const tasks = allTasks.filter(
      (t) =>
        t.status === 'OPEN' && (t.assignee ? t.assignee.id === userId : t.createdBy.id === userId),
    );
    const focus = buildFocus({
      tasks,
      requests,
      jira: jira.issues,
      now,
      dayEnd: day.end,
      today: day.date,
    });

    const meetings: MyDayMeetingDto[] = [
      ...huddles
        .filter((h) => {
          const at = new Date(h.scheduledFor).getTime();
          return at >= day.start.getTime() && at < day.end.getTime();
        })
        .map((h) => ({
          id: `huddle:${h.id}`,
          title: h.title,
          start: h.scheduledFor,
          end: h.durationMins
            ? new Date(new Date(h.scheduledFor).getTime() + h.durationMins * 60_000).toISOString()
            : null,
          source: 'huddle' as const,
          channelId: h.channelId,
          conversationId: h.conversationId,
        })),
      ...cal.events.map((e, i) => ({
        id: `calendar:${e.start}:${i}`,
        title: e.title || 'Busy',
        start: new Date(e.start).toISOString(),
        end: new Date(e.end).toISOString(),
        source: 'calendar' as const,
        channelId: null,
        conversationId: null,
      })),
    ].sort((a, b) => a.start.localeCompare(b.start));

    const ooo = avail.oooUntil && new Date(avail.oooUntil) > now ? avail.oooUntil : null;
    return {
      date: day.date,
      tzOffsetMin,
      workHours:
        avail.workStartMin != null && avail.workEndMin != null
          ? { startMin: avail.workStartMin, endMin: avail.workEndMin }
          : null,
      outOfOffice: ooo ? { until: ooo, message: avail.oooMessage } : null,
      meetings,
      focus,
      counts: {
        overdue: focus.filter((f) => f.overdue).length,
        dueToday: focus.filter((f) => f.reason === 'Due today' || f.reason === 'Due today in Jira')
          .length,
        requests: requests.length,
        jira: jira.issues.length,
        meetings: meetings.length,
      },
      jira: { state: jira.state },
      calendar: { state: cal.state },
    };
  }

  /** Ask the AI for an order; falls back to the standard order when unavailable. */
  async plan(userId: string, workspaceId: string, tzOffsetParam?: string): Promise<MyDayPlanDto> {
    const day = await this.get(userId, workspaceId, tzOffsetParam);
    if (!this.ai.enabled || day.focus.length < 2) return { focus: day.focus, aiUsed: false };

    const fmt = (iso: string) => {
      const d = new Date(new Date(iso).getTime() + day.tzOffsetMin * 60_000);
      return d.toISOString().slice(11, 16);
    };
    const hours = day.workHours
      ? `${String(Math.floor(day.workHours.startMin / 60)).padStart(2, '0')}:${String(day.workHours.startMin % 60).padStart(2, '0')}–${String(Math.floor(day.workHours.endMin / 60)).padStart(2, '0')}:${String(day.workHours.endMin % 60).padStart(2, '0')}`
      : 'not set';
    const context = [
      `Today: ${day.date}. Working hours: ${hours}.`,
      `Meetings: ${day.meetings.length ? day.meetings.map((m) => `${fmt(m.start)}${m.end ? `–${fmt(m.end)}` : ''} ${m.title}`).join('; ') : 'none'}.`,
      'Work items (id | kind | title | context | current reason):',
      ...day.focus.map(
        (f) => `${f.id} | ${f.kind} | ${f.title.slice(0, 160)} | ${f.detail ?? '-'} | ${f.reason}`,
      ),
    ].join('\n');

    try {
      const suggestion = await this.ai.planDay(context);
      if (!suggestion || suggestion.length === 0) return { focus: day.focus, aiUsed: false };
      const known = new Set(day.focus.map((f) => f.id));
      if (!suggestion.some((s) => known.has(s.id))) return { focus: day.focus, aiUsed: false };
      return { focus: applySuggestedOrder(day.focus, suggestion), aiUsed: true };
    } catch (err) {
      this.logger.warn(`AI day plan failed: ${err instanceof Error ? err.message : err}`);
      return { focus: day.focus, aiUsed: false };
    }
  }

  private async jiraIssues(
    userId: string,
    workspaceId: string,
  ): Promise<{ state: MyDayDto['jira']['state']; issues: JiraMyIssue[] }> {
    const connection = await this.prisma.atlassianConnection.findUnique({ where: { workspaceId } });
    if (!connection) return { state: 'not_connected', issues: [] };
    if (!(await this.atlassian.userAccessTokenFor(userId)))
      return { state: 'not_linked', issues: [] };
    try {
      return { state: 'ok', issues: await this.jiraActions.myIssues(userId, workspaceId) };
    } catch (err) {
      this.logger.warn(`My day Jira fetch failed: ${err instanceof Error ? err.message : err}`);
      return { state: 'error', issues: [] };
    }
  }
}

/** Minutes east of UTC from a query string; null when absent; 400 when malformed. */
function parseOffset(raw?: string): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < -840 || n > 840) {
    throw new BadRequestException('tz must be minutes east of UTC, between -840 and 840');
  }
  return n;
}
