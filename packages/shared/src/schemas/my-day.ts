/** "My day": one planning view of today's meetings and work, in a suggested order. */

export interface MyDayMeetingDto {
  id: string;
  title: string;
  start: string;
  end: string | null;
  source: 'huddle' | 'calendar';
  channelId: string | null;
  conversationId: string | null;
}

export type MyDayItemKind = 'request' | 'task' | 'jira';

/** One piece of work to do today, with why it's placed where it is. */
export interface MyDayItemDto {
  /** Stable id: "task:<id>", "jira:<KEY>" or "request:<runId>". */
  id: string;
  kind: MyDayItemKind;
  title: string;
  /** Short context: due date, priority, who's waiting… */
  detail: string | null;
  reason: string;
  overdue: boolean;
  /** Due instant (tasks) or date (Jira), if any. */
  due: string | null;
  url: string | null;
}

export interface MyDayDto {
  /** Local calendar date the view is for (YYYY-MM-DD). */
  date: string;
  tzOffsetMin: number;
  workHours: { startMin: number; endMin: number } | null;
  outOfOffice: { until: string; message: string | null } | null;
  meetings: MyDayMeetingDto[];
  /** Work in the suggested order (requests, overdue, due today, Jira, the rest). */
  focus: MyDayItemDto[];
  counts: { overdue: number; dueToday: number; requests: number; jira: number; meetings: number };
  jira: { state: 'ok' | 'not_connected' | 'not_linked' | 'error' };
  calendar: { state: 'ok' | 'none' | 'error' };
}

/** The AI-suggested order (or the standard order when AI is unavailable). */
export interface MyDayPlanDto {
  focus: MyDayItemDto[];
  aiUsed: boolean;
}
