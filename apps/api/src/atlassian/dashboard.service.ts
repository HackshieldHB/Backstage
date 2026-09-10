import { Injectable, Logger } from '@nestjs/common';
import type {
  ConfluenceDashboardDto,
  JiraBucket,
  JiraDashboardDto,
  JiraDashboardIssue,
  SprintDashboardDto,
  SprintDto,
  WorkDashboardDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianApiService } from './atlassian-api.service';
import { ConfluenceApiService } from './confluence-api.service';
import { JiraWidgetsService } from './jira-widgets.service';
import { hasGranularConfluence } from './scopes';

const PRIORITY_ORDER = ['Highest', 'High', 'Medium', 'Low', 'Lowest', 'None'];

/**
 * Bucket → JQL. Literals are server-owned; `assignee` is a validated Atlassian
 * accountId from our own DB (never raw user input), so the JQL-safety contract holds.
 */
export function bucketJql(bucket: JiraBucket, assignee: string | null): string {
  const mine = assignee ? ` AND assignee = "${assignee}"` : '';
  switch (bucket) {
    case 'todo':
      return `statusCategory = "To Do"${mine}`;
    case 'inProgress':
      return `statusCategory = "In Progress"${mine}`;
    case 'resolvedLast7d':
      return `statusCategory = Done AND statusCategoryChangedDate >= -7d${mine}`;
    case 'createdLast7d':
      return `created >= -7d${mine}`;
    case 'overdue':
      return `duedate < now() AND statusCategory != Done${mine}`;
    case 'dueThisWeek':
      return `duedate >= now() AND duedate <= endOfWeek() AND statusCategory != Done${mine}`;
    case 'unassigned':
      // In "mine" scope this is intentionally contradictory (nobody's issue is both
      // mine and unassigned) → 0, so the tile is meaningless-but-safe.
      return assignee
        ? `assignee = "${assignee}" AND assignee IS EMPTY`
        : 'assignee IS EMPTY AND statusCategory != Done';
  }
}

export function recentOpenJql(assignee: string | null): string {
  const mine = assignee ? ` AND assignee = "${assignee}"` : '';
  return `statusCategory != Done${mine} ORDER BY updated DESC`;
}

const emptyJira = (siteUrl: string | null): JiraDashboardDto => ({
  siteUrl,
  projectCount: 0,
  stats: { todo: 0, inProgress: 0, resolvedLast7d: 0, createdLast7d: 0, overdue: 0, dueThisWeek: 0, unassigned: 0 },
  priorityMix: [],
  recent: [],
  widgets: [],
});

/**
 * Read-only Jira + Confluence overview for a connected workspace. Uses the shared
 * workspace connection (reads aren't attributed, so no personal link required),
 * and every remote call degrades to a safe zero/empty rather than failing the whole
 * dashboard. `scope=me` filters Jira by the caller's own Atlassian accountId.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly atlassian: AtlassianService,
    private readonly jira: AtlassianApiService,
    private readonly confluence: ConfluenceApiService,
    private readonly widgets: JiraWidgetsService,
  ) {}

  private async assigneeFor(userId: string, scope: 'all' | 'me') {
    if (scope !== 'me') return { assignee: null as string | null, personalLinked: true };
    const link = await this.prisma.atlassianAccountLink.findUnique({
      where: { userId },
      select: { atlassianAccountId: true },
    });
    return { assignee: link?.atlassianAccountId ?? null, personalLinked: Boolean(link) };
  }

  async get(userId: string, workspaceId: string, scope: 'all' | 'me' = 'all'): Promise<WorkDashboardDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);

    const connection = await this.atlassian.connectionForWorkspace(workspaceId).catch(() => null);
    if (!connection) {
      return {
        connected: false,
        scope,
        personalLinked: true,
        jira: emptyJira(null),
        confluence: { ready: false, spaceCount: 0, recentPages: [] },
      };
    }

    const token = await this.atlassian.accessTokenFor(connection);
    const cloudId = connection.siteId;
    const siteUrl = connection.siteUrl;
    const { assignee, personalLinked } = await this.assigneeFor(userId, scope);

    const [jira, confluence] = await Promise.all([
      this.buildJira(workspaceId, token, cloudId, siteUrl, assignee),
      this.buildConfluence(connection.scopes, token, cloudId, siteUrl),
    ]);

    return { connected: true, scope, personalLinked, jira, confluence };
  }

  /** Drill-down: the issue list behind one stat tile. */
  async bucketIssues(
    userId: string,
    workspaceId: string,
    bucket: JiraBucket,
    scope: 'all' | 'me',
  ): Promise<JiraDashboardIssue[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId).catch(() => null);
    if (!connection) return [];
    const token = await this.atlassian.accessTokenFor(connection);
    const { assignee } = await this.assigneeFor(userId, scope);
    const rows = await this.jira
      .searchJql(token, connection.siteId, `${bucketJql(bucket, assignee)} ORDER BY updated DESC`)
      .catch(() => []);
    return rows.map((r) => this.toIssue(r, connection.siteUrl));
  }

  /** Active-sprint progress across the site's boards (bounded to keep API calls low). */
  async sprint(userId: string, workspaceId: string): Promise<SprintDashboardDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId).catch(() => null);
    if (!connection) return { hasSprint: false, sprints: [] };
    const token = await this.atlassian.accessTokenFor(connection);
    const cloudId = connection.siteId;

    const boards = await this.jira.listBoards(token, cloudId).catch(() => []);
    const picks: { boardName: string; sprintId: number; sprintName: string; endDate: string | null }[] = [];
    for (const b of boards) {
      if (picks.length >= 2) break;
      const sprints = await this.jira.activeSprints(token, cloudId, b.id).catch(() => []);
      for (const s of sprints) {
        if (picks.length >= 2) break;
        picks.push({ boardName: b.name, sprintId: s.id, sprintName: s.name, endDate: s.endDate });
      }
    }

    const sprints: SprintDto[] = [];
    for (const p of picks) {
      const issues = await this.jira.sprintIssues(token, cloudId, p.sprintId).catch(() => []);
      const counts = { todo: 0, inProgress: 0, done: 0 };
      for (const i of issues) counts[i.category] += 1;
      sprints.push({
        boardName: p.boardName,
        sprintName: p.sprintName,
        endDate: p.endDate,
        ...counts,
        issues: issues.slice(0, 20).map((i) => ({
          key: i.key,
          summary: i.summary,
          status: i.status,
          statusCategory: i.category,
          url: `${connection.siteUrl}/browse/${i.key}`,
        })),
      });
    }
    return { hasSprint: sprints.length > 0, sprints };
  }

  private toIssue(r: { key: string; summary: string; status: string | null; priority: string | null; updated: string | null }, siteUrl: string): JiraDashboardIssue {
    return {
      key: r.key,
      summary: r.summary,
      status: r.status,
      priority: r.priority,
      url: `${siteUrl}/browse/${r.key}`,
      updated: r.updated,
    };
  }

  private async buildJira(
    workspaceId: string,
    token: string,
    cloudId: string,
    siteUrl: string,
    assignee: string | null,
  ): Promise<JiraDashboardDto> {
    const count = (bucket: JiraBucket) =>
      this.jira.countJql(token, cloudId, bucketJql(bucket, assignee)).catch((err) => {
        this.logger.warn(`dashboard count failed: ${String(err)}`);
        return 0;
      });

    const [todo, inProgress, resolvedLast7d, createdLast7d, overdue, dueThisWeek, unassigned, recentRows, projects, widgets] =
      await Promise.all([
        count('todo'),
        count('inProgress'),
        count('resolvedLast7d'),
        count('createdLast7d'),
        count('overdue'),
        count('dueThisWeek'),
        count('unassigned'),
        this.jira.searchJql(token, cloudId, recentOpenJql(assignee)).catch(() => []),
        this.jira.listProjects(token, cloudId).catch(() => []),
        this.widgets.withCounts(workspaceId, token, cloudId),
      ]);

    const mix = new Map<string, number>();
    for (const r of recentRows) mix.set(r.priority ?? 'None', (mix.get(r.priority ?? 'None') ?? 0) + 1);
    const priorityMix = [...mix.entries()]
      .map(([label, c]) => ({ label, count: c }))
      .sort((a, b) => PRIORITY_ORDER.indexOf(a.label) - PRIORITY_ORDER.indexOf(b.label));

    return {
      siteUrl,
      projectCount: projects.length,
      stats: { todo, inProgress, resolvedLast7d, createdLast7d, overdue, dueThisWeek, unassigned },
      priorityMix,
      recent: recentRows.slice(0, 8).map((r) => this.toIssue(r, siteUrl)),
      widgets,
    };
  }

  private async buildConfluence(
    scopes: string,
    token: string,
    cloudId: string,
    siteUrl: string,
  ): Promise<ConfluenceDashboardDto> {
    if (!hasGranularConfluence(scopes)) return { ready: false, spaceCount: 0, recentPages: [] };
    const [spaces, pages] = await Promise.all([
      this.confluence.listSpaces(token, cloudId).catch(() => []),
      this.confluence.recentPages(token, cloudId, 8).catch(() => []),
    ]);
    return {
      ready: true,
      spaceCount: spaces.length,
      recentPages: pages.map((p) => ({
        id: p.id,
        title: p.title,
        url: p.webui ? `${siteUrl}/wiki${p.webui}` : `${siteUrl}/wiki/pages/viewpage.action?pageId=${p.id}`,
        updatedAt: p.updatedAt,
      })),
    };
  }
}
