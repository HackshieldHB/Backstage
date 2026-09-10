import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ClientRollupDto,
  CreateClientInput,
  CreateProjectInput,
  ProjectRollupDto,
  ProjectsOverviewDto,
  UpdateProjectInput,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

type ProjectRow = {
  id: string;
  clientId: string;
  name: string;
  jiraProjectKey: string | null;
  channelId: string | null;
  billRateCents: number;
  costRateCents: number;
  budgetHours: number | null;
  billable: boolean;
  archived: boolean;
};

/**
 * Clients & projects for a consulting workspace, plus the billability/margin
 * rollup. Time is attributed by matching a project's Jira key against the prefix
 * of logged worklog issue keys (e.g. "KAN-17" → project key "KAN"). Financials
 * are admin-only.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  private async requireManager(userId: string, workspaceId: string) {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only workspace admins can manage clients & projects');
    }
    return member;
  }

  async createClient(userId: string, workspaceId: string, input: CreateClientInput) {
    await this.requireManager(userId, workspaceId);
    return this.prisma.client.create({ data: { workspaceId, name: input.name.trim() } });
  }

  async removeClient(userId: string, id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    await this.requireManager(userId, client.workspaceId);
    await this.prisma.client.delete({ where: { id } });
    return { ok: true };
  }

  async createProject(userId: string, workspaceId: string, input: CreateProjectInput) {
    await this.requireManager(userId, workspaceId);
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, workspaceId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found in this workspace');
    return this.prisma.project.create({
      data: {
        workspaceId,
        clientId: input.clientId,
        name: input.name.trim(),
        jiraProjectKey: input.jiraProjectKey ?? null,
        channelId: input.channelId ?? null,
        billRateCents: input.billRateCents,
        costRateCents: input.costRateCents,
        budgetHours: input.budgetHours ?? null,
        billable: input.billable,
      },
    });
  }

  async updateProject(userId: string, id: string, input: UpdateProjectInput) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    await this.requireManager(userId, project.workspaceId);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.jiraProjectKey !== undefined ? { jiraProjectKey: input.jiraProjectKey } : {}),
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        ...(input.billRateCents !== undefined ? { billRateCents: input.billRateCents } : {}),
        ...(input.costRateCents !== undefined ? { costRateCents: input.costRateCents } : {}),
        ...(input.budgetHours !== undefined ? { budgetHours: input.budgetHours } : {}),
        ...(input.billable !== undefined ? { billable: input.billable } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
      },
    });
  }

  async removeProject(userId: string, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    await this.requireManager(userId, project.workspaceId);
    await this.prisma.project.delete({ where: { id } });
    return { ok: true };
  }

  /** The billability + margin rollup across clients/projects over a time window. */
  async overview(userId: string, workspaceId: string, windowDays: number): Promise<ProjectsOverviewDto> {
    await this.requireManager(userId, workspaceId);
    const days = Math.min(Math.max(windowDays || 30, 1), 365);
    const since = new Date(Date.now() - days * 86400_000);

    const [clients, projects, entries] = await Promise.all([
      this.prisma.client.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }),
      this.prisma.project.findMany({ where: { workspaceId, archived: false }, orderBy: { name: 'asc' } }),
      this.prisma.timesheetEntry.findMany({
        where: { workspaceId, startedAt: { gte: since } },
        select: { issueKey: true, durationSec: true },
      }),
    ]);

    // Sum logged seconds per Jira project key ("KAN-17" → "KAN").
    const byKey = new Map<string, number>();
    for (const e of entries) {
      const key = e.issueKey.split('-')[0]?.toUpperCase();
      if (key) byKey.set(key, (byKey.get(key) ?? 0) + e.durationSec);
    }

    const roll = (p: ProjectRow): ProjectRollupDto => {
      const loggedSec = p.jiraProjectKey ? (byKey.get(p.jiraProjectKey.toUpperCase()) ?? 0) : 0;
      const billableSec = p.billable ? loggedSec : 0;
      const revenueCents = Math.round((billableSec / 3600) * p.billRateCents);
      const costCents = Math.round((loggedSec / 3600) * p.costRateCents);
      return {
        id: p.id,
        clientId: p.clientId,
        name: p.name,
        jiraProjectKey: p.jiraProjectKey,
        channelId: p.channelId,
        billRateCents: p.billRateCents,
        costRateCents: p.costRateCents,
        budgetHours: p.budgetHours,
        billable: p.billable,
        archived: p.archived,
        loggedSec,
        billableSec,
        revenueCents,
        costCents,
        marginCents: revenueCents - costCents,
        budgetUsedPct: p.budgetHours ? Math.round((loggedSec / 3600 / p.budgetHours) * 100) : null,
      };
    };

    const clientDtos: ClientRollupDto[] = clients.map((c) => {
      const ps = projects.filter((p) => p.clientId === c.id).map(roll);
      return {
        id: c.id,
        name: c.name,
        projectCount: ps.length,
        loggedSec: ps.reduce((a, b) => a + b.loggedSec, 0),
        revenueCents: ps.reduce((a, b) => a + b.revenueCents, 0),
        costCents: ps.reduce((a, b) => a + b.costCents, 0),
        marginCents: ps.reduce((a, b) => a + b.marginCents, 0),
        projects: ps,
      };
    });

    const totals = clientDtos.reduce(
      (acc, c) => ({
        loggedSec: acc.loggedSec + c.loggedSec,
        revenueCents: acc.revenueCents + c.revenueCents,
        costCents: acc.costCents + c.costCents,
        marginCents: acc.marginCents + c.marginCents,
      }),
      { loggedSec: 0, revenueCents: 0, costCents: 0, marginCents: 0 },
    );

    return { windowDays: days, totals, clients: clientDtos };
  }
}
