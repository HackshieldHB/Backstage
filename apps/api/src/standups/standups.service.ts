import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma, Standup } from '@prisma/client';
import type {
  CreateStandupInput,
  StandupDto,
  StandupPrefillDto,
  StandupResponseDto,
  SubmitCheckinInput,
  UpdateStandupInput,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { MessagesService, channelContainer } from '../messages/messages.service';
import { isDue, scheduleDate } from './due';

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const KIND_LABEL: Record<string, string> = {
  MEETING: 'in huddles/meetings',
  IMPLEMENTATION: 'coding',
  DOCUMENTATION: 'writing docs',
  COLLABORATION: 'collaborating',
};

/** Wrap plain text in a minimal TipTap doc so it renders like any message. */
function textDoc(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const standupInclude = {
  members: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
} satisfies Prisma.StandupInclude;

type StandupWithMembers = Prisma.StandupGetPayload<{ include: typeof standupInclude }>;

@Injectable()
export class StandupsService {
  private readonly logger = new Logger(StandupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
  ) {}

  // ---------- CRUD ----------

  async list(userId: string, workspaceId: string): Promise<StandupDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.standup.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      include: standupInclude,
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateStandupInput): Promise<StandupDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    // The digest channel must belong to this workspace and the creator must be in it.
    const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
    if (channel.workspaceId !== workspaceId) throw new ForbiddenException('Channel not in workspace');

    const row = await this.prisma.standup.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        channelId: input.channelId,
        timeOfDay: input.timeOfDay,
        days: normalizeDays(input.days),
        tzOffsetMin: input.tzOffsetMin,
        createdById: userId,
        members: { create: dedupe(input.memberIds).map((uid) => ({ userId: uid })) },
      },
      include: standupInclude,
    });
    return toDto(row);
  }

  async update(userId: string, id: string, input: UpdateStandupInput): Promise<StandupDto> {
    const existing = await this.requireManage(userId, id);

    const data: Prisma.StandupUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.timeOfDay !== undefined) data.timeOfDay = input.timeOfDay;
    if (input.days !== undefined) data.days = normalizeDays(input.days);
    if (input.tzOffsetMin !== undefined) data.tzOffsetMin = input.tzOffsetMin;
    if (input.active !== undefined) data.active = input.active;
    if (input.channelId !== undefined && input.channelId !== existing.channelId) {
      const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
      if (channel.workspaceId !== existing.workspaceId) {
        throw new ForbiddenException('Channel not in workspace');
      }
      data.channel = { connect: { id: input.channelId } };
    }

    await this.prisma.standup.update({ where: { id }, data });
    if (input.memberIds !== undefined) {
      await this.prisma.standupMember.deleteMany({ where: { standupId: id } });
      await this.prisma.standupMember.createMany({
        data: dedupe(input.memberIds).map((uid) => ({ standupId: id, userId: uid })),
        skipDuplicates: true,
      });
    }
    const fresh = await this.prisma.standup.findUniqueOrThrow({ where: { id }, include: standupInclude });
    return toDto(fresh);
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.requireManage(userId, id);
    await this.prisma.standup.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- check-ins ----------

  async submitCheckin(
    userId: string,
    standupId: string,
    input: SubmitCheckinInput,
  ): Promise<StandupResponseDto> {
    const standup = await this.loadForMember(userId, standupId);
    const onDate = scheduleDate(Date.now(), standup.tzOffsetMin);
    const row = await this.prisma.standupResponse.upsert({
      where: { standupId_userId_onDate: { standupId, userId, onDate } },
      create: {
        standupId,
        userId,
        onDate,
        yesterday: input.yesterday,
        today: input.today,
        blockers: input.blockers ?? null,
      },
      update: {
        yesterday: input.yesterday,
        today: input.today,
        blockers: input.blockers ?? null,
      },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    return responseDto(row);
  }

  async responses(
    userId: string,
    standupId: string,
    date?: string,
  ): Promise<StandupResponseDto[]> {
    const standup = await this.loadForMember(userId, standupId);
    const onDate = date ?? scheduleDate(Date.now(), standup.tzOffsetMin);
    const rows = await this.prisma.standupResponse.findMany({
      where: { standupId, onDate },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    return rows.map(responseDto);
  }

  /** Auto-pull the caller's recent activity to pre-fill their check-in. */
  async prefill(userId: string, standupId: string): Promise<StandupPrefillDto> {
    const standup = await this.loadForMember(userId, standupId);
    const since = new Date(Date.now() - 20 * 3600_000);
    const segments = await this.prisma.activitySegment.findMany({
      where: { workspaceId: standup.workspaceId, userId, startedAt: { gte: since } },
      select: { kind: true, refId: true, durationSec: true, startedAt: true, endedAt: true },
    });

    const byKind = new Map<string, number>();
    const issues = new Set<string>();
    for (const s of segments) {
      const dur =
        s.durationSec ?? Math.round(((s.endedAt?.getTime() ?? Date.now()) - s.startedAt.getTime()) / 1000);
      byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + Math.max(0, dur));
      if (s.refId && JIRA_KEY_RE.test(s.refId)) issues.add(s.refId);
    }

    const summary: string[] = [];
    for (const [kind, label] of Object.entries(KIND_LABEL)) {
      const total = byKind.get(kind) ?? 0;
      if (total >= 60) summary.push(`${fmtDuration(total)} ${label}`);
    }
    return { jiraIssues: [...issues].sort(), summary };
  }

  // ---------- scheduler (called by the queue worker) ----------

  /** Post prompts for every standup whose local time is due. Returns how many. */
  async runDue(now = new Date()): Promise<number> {
    const active = await this.prisma.standup.findMany({ where: { active: true } });
    let posted = 0;
    for (const s of active) {
      const { due, onDate } = isDue(s, now.getTime());
      if (!due) continue;
      try {
        const text =
          `🧍 Standup "${s.name}" — reply with your check-in:\n` +
          `• What did you do?  • What's next?  • Any blockers?\n` +
          `Open Standups in the sidebar to submit (activity auto-filled).`;
        await this.messages.send(s.createdById, channelContainer(s.channelId), {
          clientMsgId: randomUUID(),
          contentJson: textDoc(text),
          contentText: text,
          attachmentIds: [],
        });
        posted++;
      } catch (err) {
        this.logger.warn(`Standup ${s.id} prompt skipped: ${String(err)}`);
      }
      // Stamp regardless of send outcome so a broken channel doesn't retry every minute.
      await this.prisma.standup
        .update({ where: { id: s.id }, data: { lastRunOn: onDate } })
        .catch(() => undefined);
    }
    return posted;
  }

  /** Assemble today's responses into a digest message posted to the channel. */
  async postDigest(userId: string, standupId: string): Promise<{ posted: boolean }> {
    const standup = await this.requireManage(userId, standupId);
    const rows = await this.responses(userId, standupId);
    if (rows.length === 0) return { posted: false };

    const lines: string[] = [`📋 ${standup.name} — standup digest`];
    for (const r of rows) {
      lines.push('');
      lines.push(`${r.user.displayName}`);
      if (r.yesterday) lines.push(`  Did: ${r.yesterday}`);
      if (r.today) lines.push(`  Next: ${r.today}`);
      if (r.blockers) lines.push(`  ⛔ Blockers: ${r.blockers}`);
    }
    const text = lines.join('\n');
    await this.messages.send(userId, channelContainer(standup.channelId), {
      clientMsgId: randomUUID(),
      contentJson: textDoc(text),
      contentText: text,
      attachmentIds: [],
    });
    return { posted: true };
  }

  // ---------- helpers ----------

  /** Manage (edit/delete/digest): creator or a workspace admin/owner. */
  private async requireManage(userId: string, id: string): Promise<Standup> {
    const standup = await this.prisma.standup.findUnique({ where: { id } });
    if (!standup) throw new NotFoundException('Standup not found');
    const member = await this.policy.requireWorkspaceMember(userId, standup.workspaceId);
    if (standup.createdById !== userId && member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only the creator or an admin can manage this standup');
    }
    return standup;
  }

  /** Read/participate: any member of the standup's workspace. */
  private async loadForMember(userId: string, id: string): Promise<Standup> {
    const standup = await this.prisma.standup.findUnique({ where: { id } });
    if (!standup) throw new NotFoundException('Standup not found');
    await this.policy.requireWorkspaceMember(userId, standup.workspaceId);
    return standup;
  }
}

function toDto(row: StandupWithMembers): StandupDto {
  return {
    id: row.id,
    name: row.name,
    channelId: row.channelId,
    timeOfDay: row.timeOfDay,
    days: row.days.split(',').map(Number).filter((n) => !Number.isNaN(n)),
    tzOffsetMin: row.tzOffsetMin,
    active: row.active,
    members: row.members.map((m) => ({
      id: m.user.id,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    })),
  };
}

function responseDto(row: {
  id: string;
  standupId: string;
  onDate: string;
  yesterday: string;
  today: string;
  blockers: string | null;
  createdAt: Date;
  user: { id: string; displayName: string; avatarUrl: string | null };
}): StandupResponseDto {
  return {
    id: row.id,
    standupId: row.standupId,
    onDate: row.onDate,
    user: { id: row.user.id, displayName: row.user.displayName, avatarUrl: row.user.avatarUrl },
    yesterday: row.yesterday,
    today: row.today,
    blockers: row.blockers,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeDays(days: number[]): string {
  return [...new Set(days)].sort((a, b) => a - b).join(',');
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}
