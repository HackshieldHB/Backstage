import { Injectable } from '@nestjs/common';
import type {
  JiraDashboardIssue,
  JiraDashboardSummaryDto,
  JiraDashboardViewDto,
  MirrorGadgetDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianApiService, type JiraSearchRow } from './atlassian-api.service';

type GadgetKind = 'assigned' | 'filter' | 'link';

function classify(moduleKey: string | null): GadgetKind {
  const m = (moduleKey ?? '').toLowerCase();
  if (m.includes('assigned-to-me')) return 'assigned';
  if (m.includes('filter-results')) return 'filter';
  return 'link';
}

function linkNote(moduleKey: string | null): string {
  const m = (moduleKey ?? '').toLowerCase();
  if (m.includes('activitystream') || m.includes('activity-stream')) return 'Activity stream — view in Jira';
  if (m.includes('introduction')) return 'Introduction — view in Jira';
  if (m.includes('project')) return 'Project summary — view in Jira';
  return 'This gadget can only be viewed in Jira';
}

/** Best-effort filter id extraction from a gadget's stored config. */
function filterIdFrom(config: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(config)) {
    if (/filter/i.test(k)) {
      const m = /(\d{3,})/.exec(v);
      if (m) return m[1];
    }
  }
  for (const v of Object.values(config)) {
    const m = /filter[-_]?(\d{3,})/i.exec(v);
    if (m) return m[1];
  }
  return null;
}

/**
 * Mirrors the user's REAL Jira dashboards. Jira doesn't expose rendered gadget
 * output via API, so we recompute the data ourselves for the gadget types we can
 * (Assigned to Me, filter-backed) and mark the rest as Jira-only links.
 */
@Injectable()
export class JiraDashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly atlassian: AtlassianService,
    private readonly jira: AtlassianApiService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<JiraDashboardSummaryDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId).catch(() => null);
    if (!connection) return [];
    const token = await this.atlassian.accessTokenFor(connection);
    const rows = await this.jira.listDashboards(token, connection.siteId).catch(() => []);
    return rows.map((d) => ({ id: d.id, name: d.name, viewUrl: this.viewUrl(connection.siteUrl, d.id, d.view) }));
  }

  async view(userId: string, workspaceId: string, dashboardId: string): Promise<JiraDashboardViewDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId);
    const token = await this.atlassian.accessTokenFor(connection);
    const cloudId = connection.siteId;
    const siteUrl = connection.siteUrl;

    const [gadgets, dashboards, link] = await Promise.all([
      this.jira.dashboardGadgets(token, cloudId, dashboardId).catch(() => []),
      this.jira.listDashboards(token, cloudId).catch(() => []),
      this.prisma.atlassianAccountLink.findUnique({ where: { userId }, select: { atlassianAccountId: true } }),
    ]);
    const meta = dashboards.find((d) => d.id === dashboardId);
    const viewUrl = this.viewUrl(siteUrl, dashboardId, meta?.view ?? null);
    const accountId = link?.atlassianAccountId ?? null;

    const rendered: MirrorGadgetDto[] = [];
    for (const g of gadgets) {
      rendered.push(await this.renderGadget(g, { token, cloudId, siteUrl, accountId, dashboardId }));
    }
    return { id: dashboardId, name: meta?.name ?? 'Dashboard', viewUrl, gadgets: rendered };
  }

  private async renderGadget(
    g: { id: number; title: string; moduleKey: string | null; color: string | null },
    ctx: { token: string; cloudId: string; siteUrl: string; accountId: string | null; dashboardId: string },
  ): Promise<MirrorGadgetDto> {
    const kind = classify(g.moduleKey);
    const base: MirrorGadgetDto = { id: g.id, title: g.title, color: g.color, kind: 'link' };

    if (kind === 'assigned') {
      if (!ctx.accountId) {
        return { ...base, note: 'Connect your Atlassian account to see your assigned issues' };
      }
      const rows = await this.jira
        .searchJql(ctx.token, ctx.cloudId, `assignee = "${ctx.accountId}" AND statusCategory != Done ORDER BY updated DESC`)
        .catch(() => []);
      return { ...base, kind: 'issues', issues: this.toIssues(rows, ctx.siteUrl) };
    }

    if (kind === 'filter') {
      const config = await this.jira.gadgetConfig(ctx.token, ctx.cloudId, ctx.dashboardId, g.id).catch(() => ({}));
      const filterId = filterIdFrom(config);
      if (filterId) {
        const jql = await this.jira.getFilterJql(ctx.token, ctx.cloudId, filterId).catch(() => null);
        if (jql) {
          const rows = await this.jira.searchJql(ctx.token, ctx.cloudId, jql).catch(() => []);
          return { ...base, kind: 'issues', issues: this.toIssues(rows, ctx.siteUrl) };
        }
      }
      return { ...base, note: 'Filter gadget — view in Jira' };
    }

    return { ...base, note: linkNote(g.moduleKey) };
  }

  private toIssues(rows: JiraSearchRow[], siteUrl: string): JiraDashboardIssue[] {
    return rows.slice(0, 10).map((r) => ({
      key: r.key,
      summary: r.summary,
      status: r.status,
      priority: r.priority,
      url: `${siteUrl}/browse/${r.key}`,
      updated: r.updated,
    }));
  }

  private viewUrl(siteUrl: string, id: string, view: string | null): string {
    return view ? `${siteUrl}${view}` : `${siteUrl}/jira/dashboards/${id}`;
  }
}
