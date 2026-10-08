import { Injectable, Logger } from '@nestjs/common';
import type { AtlassianOverviewDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianApiService } from './atlassian-api.service';
import { ConfluenceApiService } from './confluence-api.service';
import { hasGranularConfluence } from './scopes';

/**
 * Live numbers for the Applications Hub's Atlassian card, read with the
 * workspace connection (read-only calls). Each source is fetched independently:
 * a failing call is reported in `problems` and degrades the status instead of
 * failing the whole overview.
 */
@Injectable()
export class AtlassianOverviewService {
  private readonly logger = new Logger(AtlassianOverviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly atlassian: AtlassianService,
    private readonly api: AtlassianApiService,
    private readonly confluence: ConfluenceApiService,
  ) {}

  async overview(userId: string, workspaceId: string): Promise<AtlassianOverviewDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.prisma.atlassianConnection.findUnique({ where: { workspaceId } });
    if (!connection) return { connected: false };

    const token = await this.atlassian.accessTokenFor(connection);
    const site = connection.siteId;
    const confluenceReady = hasGranularConfluence(connection.scopes);
    const [projects, openIssues, recent, spaces, linkedMembers] = await Promise.allSettled([
      this.api.listProjects(token, site),
      this.api.countJql(token, site, 'statusCategory != Done'),
      this.api.searchJql(token, site, 'updated >= -7d ORDER BY updated DESC'),
      confluenceReady ? this.confluence.listSpaces(token, site) : Promise.resolve(null),
      this.prisma.atlassianAccountLink.count({
        where: { user: { workspaceMemberships: { some: { workspaceId, deactivatedAt: null } } } },
      }),
    ]);

    const problems: string[] = [];
    const value = <T>(r: PromiseSettledResult<T>, what: string): T | null => {
      if (r.status === 'fulfilled') return r.value;
      problems.push(what);
      this.logger.warn(`Atlassian overview: ${what} failed: ${String(r.reason)}`);
      return null;
    };
    const projectList = value(projects, 'Jira projects');
    const open = value(openIssues, 'open issue count');
    const recentRows = value(recent, 'recent activity');
    const spaceList = value(spaces, 'Confluence spaces');

    return {
      connected: true,
      siteUrl: connection.siteUrl,
      siteName: connection.siteName,
      fetchedAt: new Date().toISOString(),
      projects: projectList?.length ?? null,
      openIssues: open,
      confluenceSpaces: confluenceReady ? (spaceList?.length ?? null) : null,
      linkedMembers: value(linkedMembers, 'linked members') ?? 0,
      recent: (recentRows ?? []).slice(0, 6).map((r) => ({
        key: r.key,
        summary: r.summary,
        status: r.status,
        updated: r.updated,
        url: `${connection.siteUrl}/browse/${r.key}`,
      })),
      problems,
    };
  }
}
