import { z } from 'zod';

/** Aggregated Jira + Confluence overview for a connected workspace. */

export interface JiraDashboardIssue {
  key: string;
  summary: string;
  status: string | null;
  priority: string | null;
  url: string;
  updated: string | null;
}

export interface JiraDashboardStats {
  todo: number;
  inProgress: number;
  resolvedLast7d: number;
  createdLast7d: number;
  overdue: number;
  dueThisWeek: number;
  unassigned: number;
}

/** The drill-down buckets a stat tile can expand into. */
export const JIRA_BUCKETS = [
  'todo',
  'inProgress',
  'overdue',
  'dueThisWeek',
  'unassigned',
  'createdLast7d',
  'resolvedLast7d',
] as const;
export type JiraBucket = (typeof JIRA_BUCKETS)[number];

/** A user-saved JQL query rendered as a live count on the dashboard. */
export interface JiraWidgetDto {
  id: string;
  label: string;
  jql: string;
  count: number;
  /** True when the JQL failed to run (invalid query, etc.). */
  failed: boolean;
}

export const CreateJiraWidgetSchema = z.object({
  label: z.string().min(1).max(60),
  jql: z.string().min(1).max(500),
});
export type CreateJiraWidgetInput = z.infer<typeof CreateJiraWidgetSchema>;

export interface JiraDashboardDto {
  siteUrl: string | null;
  projectCount: number;
  stats: JiraDashboardStats;
  /** Priority distribution across the recent open-issue sample (not an exact site total). */
  priorityMix: { label: string; count: number }[];
  recent: JiraDashboardIssue[];
  widgets: JiraWidgetDto[];
}

export interface ConfluenceDashboardPage {
  id: string;
  title: string;
  url: string;
  updatedAt: string | null;
}

export interface ConfluenceDashboardDto {
  /** False when the connection lacks Confluence (granular) scopes. */
  ready: boolean;
  spaceCount: number;
  recentPages: ConfluenceDashboardPage[];
}

export interface WorkDashboardDto {
  /** Whether the workspace has any Atlassian connection at all. */
  connected: boolean;
  /** Which scope the numbers reflect. */
  scope: 'all' | 'me';
  /** False when scope=me was requested but the caller has no personal Atlassian link. */
  personalLinked: boolean;
  jira: JiraDashboardDto;
  confluence: ConfluenceDashboardDto;
}

// ----- Mirrored real Jira dashboards -----

export interface JiraDashboardSummaryDto {
  id: string;
  name: string;
  viewUrl: string;
}

/** One gadget from a real Jira dashboard, rendered natively where possible. */
export interface MirrorGadgetDto {
  id: number;
  title: string;
  color: string | null;
  /** 'issues' = we recomputed its data; 'link' = only openable in Jira. */
  kind: 'issues' | 'link';
  issues?: JiraDashboardIssue[];
  /** Why a 'link' gadget can't be rendered here (e.g. "Activity stream has no API"). */
  note?: string;
}

export interface JiraDashboardViewDto {
  id: string;
  name: string;
  viewUrl: string;
  gadgets: MirrorGadgetDto[];
}

// ----- Sprint / board view -----

export interface SprintIssue {
  key: string;
  summary: string;
  status: string | null;
  statusCategory: 'todo' | 'inProgress' | 'done';
  url: string;
}

export interface SprintDto {
  boardName: string;
  sprintName: string;
  endDate: string | null;
  todo: number;
  inProgress: number;
  done: number;
  issues: SprintIssue[];
}

export interface SprintDashboardDto {
  hasSprint: boolean;
  sprints: SprintDto[];
}

// ----- SLA / stale-issue alert rules -----

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const CreateJiraAlertSchema = z.object({
  channelId: z.string().min(1),
  staleDays: z.number().int().min(1).max(90).default(7),
  timeOfDay: z.string().regex(HHMM).default('09:00'),
  tzOffsetMin: z.number().int().min(-720).max(840).default(0),
});
export type CreateJiraAlertInput = z.infer<typeof CreateJiraAlertSchema>;

export interface JiraAlertRuleDto {
  id: string;
  channelId: string;
  staleDays: number;
  timeOfDay: string;
  active: boolean;
}

// ----- AI action items -----

export interface ActionItemsDto {
  items: string[];
}
