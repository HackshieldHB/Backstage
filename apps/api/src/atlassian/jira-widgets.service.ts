import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateJiraWidgetInput, JiraWidgetDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianApiService } from './atlassian-api.service';

const MAX_WIDGETS = 12;

/**
 * User-saved JQL count widgets for the dashboard. The JQL is member-supplied, so
 * it runs read-only under the shared workspace connection and only ever reaches
 * {@link AtlassianApiService.countJql} (a count query) — never a write path.
 */
@Injectable()
export class JiraWidgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly jira: AtlassianApiService,
  ) {}

  async create(userId: string, workspaceId: string, input: CreateJiraWidgetInput) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const existing = await this.prisma.jiraSavedWidget.count({ where: { workspaceId } });
    if (existing >= MAX_WIDGETS) {
      throw new ForbiddenException(`At most ${MAX_WIDGETS} widgets per workspace`);
    }
    const row = await this.prisma.jiraSavedWidget.create({
      data: {
        workspaceId,
        createdById: userId,
        label: input.label.trim(),
        jql: input.jql.trim(),
        sortOrder: existing,
      },
    });
    return { id: row.id, label: row.label, jql: row.jql };
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    const w = await this.prisma.jiraSavedWidget.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Widget not found');
    const member = await this.policy.requireWorkspaceMember(userId, w.workspaceId);
    if (w.createdById !== userId && member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only the creator or an admin can delete this');
    }
    await this.prisma.jiraSavedWidget.delete({ where: { id } });
    return { ok: true };
  }

  /** Loads the workspace's widgets and runs each JQL as a count (failures flagged, not fatal). */
  async withCounts(workspaceId: string, token: string, cloudId: string): Promise<JiraWidgetDto[]> {
    const widgets = await this.prisma.jiraSavedWidget.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return Promise.all(
      widgets.map(async (w) => {
        try {
          const count = await this.jira.countJql(token, cloudId, w.jql);
          return { id: w.id, label: w.label, jql: w.jql, count, failed: false };
        } catch {
          return { id: w.id, label: w.label, jql: w.jql, count: 0, failed: true };
        }
      }),
    );
  }
}
