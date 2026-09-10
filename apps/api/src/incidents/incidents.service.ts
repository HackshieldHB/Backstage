import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CreateOncallShiftInput,
  OpenIncidentInput,
  IncidentDto,
  IncidentStatus,
  IncidentUpdateDto,
  IncidentUpdateInput,
  OncallDto,
  OncallShiftDto,
  Severity,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

const userSelect = { select: { id: true, displayName: true, avatarUrl: true } };
const incidentInclude = {
  declaredBy: userSelect,
  commander: userSelect,
  updates: { include: { author: userSelect }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.IncidentInclude;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<IncidentDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.incident.findMany({
      where: { workspaceId },
      include: incidentInclude,
      orderBy: [{ resolvedAt: 'asc' }, { declaredAt: 'desc' }],
      take: 100,
    });
    return rows.map(toDto);
  }

  async declare(userId: string, workspaceId: string, input: OpenIncidentInput): Promise<IncidentDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (input.commanderId) await this.requireWorkspaceUser(workspaceId, input.commanderId);
    const row = await this.prisma.incident.create({
      data: {
        workspaceId,
        title: input.title.trim(),
        severity: input.severity,
        channelId: input.channelId ?? null,
        commanderId: input.commanderId ?? null,
        jiraIssueKey: input.jiraIssueKey ?? null,
        declaredById: userId,
        updates: {
          create: { authorId: userId, kind: 'STATUS', body: `Incident declared (${input.severity}).` },
        },
      },
      include: incidentInclude,
    });
    return toDto(row);
  }

  async addUpdate(userId: string, incidentId: string, input: IncidentUpdateInput): Promise<IncidentDto> {
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('Incident not found');
    await this.policy.requireWorkspaceMember(userId, incident.workspaceId);

    const nextStatus =
      input.kind === 'RESOLVED' ? 'RESOLVED' : input.kind === 'MITIGATED' ? 'MITIGATED' : null;

    const row = await this.prisma.incident.update({
      where: { id: incidentId },
      data: {
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(input.kind === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
        updates: { create: { authorId: userId, kind: input.kind, body: input.body.trim() } },
      },
      include: incidentInclude,
    });
    return toDto(row);
  }

  // ----- on-call -----

  async oncall(userId: string, workspaceId: string): Promise<OncallDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const now = new Date();
    const [current, upcoming] = await Promise.all([
      this.prisma.oncallShift.findMany({
        where: { workspaceId, startsAt: { lte: now }, endsAt: { gt: now } },
        include: { user: userSelect },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.oncallShift.findMany({
        where: { workspaceId, startsAt: { gt: now } },
        include: { user: userSelect },
        orderBy: { startsAt: 'asc' },
        take: 10,
      }),
    ]);
    return { current: current.map(toShift), upcoming: upcoming.map(toShift) };
  }

  async createShift(userId: string, workspaceId: string, input: CreateOncallShiftInput): Promise<OncallShiftDto> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can manage the on-call roster');
    }
    await this.requireWorkspaceUser(workspaceId, input.userId);
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (end <= start) throw new ForbiddenException('Shift end must be after its start');
    const row = await this.prisma.oncallShift.create({
      data: { workspaceId, userId: input.userId, label: input.label, startsAt: start, endsAt: end },
      include: { user: userSelect },
    });
    return toShift(row);
  }

  async removeShift(userId: string, shiftId: string): Promise<{ ok: boolean }> {
    const shift = await this.prisma.oncallShift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundException('Shift not found');
    const member = await this.policy.requireWorkspaceMember(userId, shift.workspaceId);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can manage the on-call roster');
    }
    await this.prisma.oncallShift.delete({ where: { id: shiftId } });
    return { ok: true };
  }

  private async requireWorkspaceUser(workspaceId: string, userId: string) {
    const m = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!m) throw new ForbiddenException('User must be a member of this workspace');
  }
}

type UserRow = { id: string; displayName: string; avatarUrl: string | null };
const toUser = (u: UserRow | null) =>
  u ? { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl } : null;

function toDto(row: {
  id: string;
  title: string;
  severity: string;
  status: string;
  channelId: string | null;
  jiraIssueKey: string | null;
  commander: UserRow | null;
  declaredBy: UserRow;
  declaredAt: Date;
  resolvedAt: Date | null;
  updates: Array<{ id: string; kind: string; body: string; author: UserRow | null; createdAt: Date }>;
}): IncidentDto {
  return {
    id: row.id,
    title: row.title,
    severity: row.severity as Severity,
    status: row.status as IncidentStatus,
    channelId: row.channelId,
    jiraIssueKey: row.jiraIssueKey,
    commander: toUser(row.commander),
    declaredBy: toUser(row.declaredBy)!,
    declaredAt: row.declaredAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    durationMin: row.resolvedAt
      ? Math.round((row.resolvedAt.getTime() - row.declaredAt.getTime()) / 60000)
      : null,
    updates: row.updates.map(
      (u): IncidentUpdateDto => ({
        id: u.id,
        kind: u.kind as IncidentUpdateDto['kind'],
        body: u.body,
        author: toUser(u.author),
        createdAt: u.createdAt.toISOString(),
      }),
    ),
  };
}

function toShift(row: { id: string; label: string; startsAt: Date; endsAt: Date; user: UserRow }): OncallShiftDto {
  return {
    id: row.id,
    user: toUser(row.user)!,
    label: row.label,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}
