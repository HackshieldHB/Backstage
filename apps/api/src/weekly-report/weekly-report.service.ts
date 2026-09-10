import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  CreateWeeklyReportInput,
  UpdateWeeklyReportInput,
  WeeklyReportDto,
  WeeklyReportPreviewDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { MessagesService, channelContainer } from '../messages/messages.service';
import { AiService } from '../ai/ai.service';
import { localTime, parseHHMM } from '../standups/due';

function textDoc(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })),
  };
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface DueRow {
  active: boolean;
  dayOfWeek: number;
  timeOfDay: string;
  tzOffsetMin: number;
  lastRunOn: string | null;
}

/** Is this report due to fire at nowMs? Once per scheduled local day. */
export function reportDue(r: DueRow, nowMs: number): { due: boolean; onDate: string } {
  const lt = localTime(nowMs, r.tzOffsetMin);
  const onDate = lt.date;
  if (!r.active) return { due: false, onDate };
  if (lt.weekday !== r.dayOfWeek) return { due: false, onDate };
  if (lt.minutes < parseHHMM(r.timeOfDay)) return { due: false, onDate };
  if (r.lastRunOn === onDate) return { due: false, onDate };
  return { due: true, onDate };
}

@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
    private readonly ai: AiService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<WeeklyReportDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.weeklyReport.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    userId: string,
    workspaceId: string,
    input: CreateWeeklyReportInput,
  ): Promise<WeeklyReportDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
    if (channel.workspaceId !== workspaceId) throw new ForbiddenException('Channel not in workspace');
    const row = await this.prisma.weeklyReport.create({
      data: {
        workspaceId,
        channelId: input.channelId,
        dayOfWeek: input.dayOfWeek,
        timeOfDay: input.timeOfDay,
        tzOffsetMin: input.tzOffsetMin,
        createdById: userId,
      },
    });
    return toDto(row);
  }

  async update(userId: string, id: string, input: UpdateWeeklyReportInput): Promise<WeeklyReportDto> {
    const existing = await this.requireManage(userId, id);
    const row = await this.prisma.weeklyReport.update({
      where: { id },
      data: {
        dayOfWeek: input.dayOfWeek,
        timeOfDay: input.timeOfDay,
        tzOffsetMin: input.tzOffsetMin,
        active: input.active,
        ...(input.channelId && input.channelId !== existing.channelId
          ? { channel: { connect: { id: input.channelId } } }
          : {}),
      },
    });
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.requireManage(userId, id);
    await this.prisma.weeklyReport.delete({ where: { id } });
    return { ok: true };
  }

  /** Post the report immediately (for previews / manual runs). */
  async runNow(userId: string, id: string): Promise<{ posted: boolean }> {
    const r = await this.requireManage(userId, id);
    const { text } = await this.buildReport(r.workspaceId);
    await this.messages.send(userId, channelContainer(r.channelId), {
      clientMsgId: randomUUID(),
      contentJson: textDoc(text),
      contentText: text,
      attachmentIds: [],
    });
    return { posted: true };
  }

  /** Render the draft without posting, so the UI can show/edit it first. */
  async preview(userId: string, id: string): Promise<WeeklyReportPreviewDto> {
    const r = await this.requireManage(userId, id);
    return this.buildReport(r.workspaceId);
  }

  /** Scheduler entrypoint: post every report whose local time is due. */
  async runDue(now = new Date()): Promise<number> {
    const active = await this.prisma.weeklyReport.findMany({ where: { active: true } });
    let posted = 0;
    for (const r of active) {
      const { due, onDate } = reportDue(r, now.getTime());
      if (!due) continue;
      try {
        const { text } = await this.buildReport(r.workspaceId);
        await this.messages.send(r.createdById, channelContainer(r.channelId), {
          clientMsgId: randomUUID(),
          contentJson: textDoc(text),
          contentText: text,
          attachmentIds: [],
        });
        posted++;
      } catch (err) {
        this.logger.warn(`Weekly report ${r.id} skipped: ${String(err)}`);
      }
      await this.prisma.weeklyReport
        .update({ where: { id: r.id }, data: { lastRunOn: onDate } })
        .catch(() => undefined);
    }
    return posted;
  }

  /**
   * Aggregate the past 7 days of activity into a report. When AI is configured
   * it opens with a generated narrative built from the same facts; otherwise it
   * falls back to the plain stats digest.
   */
  async buildReport(workspaceId: string): Promise<WeeklyReportPreviewDto> {
    const facts = await this.gatherFacts(workspaceId);

    const stats = [
      `• ${facts.messages} messages from ${facts.activePeople} people`,
      `• ${fmtDuration(facts.meetingSec)} in huddles/meetings`,
      `• ${fmtDuration(facts.loggedSec)} of work logged`,
      `• ${facts.decisionsCount} decisions recorded`,
      `• ${facts.checkins} standup check-ins`,
    ];

    let narrative: string | null = null;
    try {
      narrative = await this.ai.narrateWeekly(this.factsPrompt(facts));
    } catch (err) {
      this.logger.warn(`Weekly-report AI narrative failed, using stats digest: ${String(err)}`);
    }

    if (narrative) {
      const text = [
        '📊 Weekly team report',
        '',
        narrative,
        '',
        'By the numbers:',
        ...stats,
        '',
        'Open Team timeline for the full breakdown.',
      ].join('\n');
      return { text, aiGenerated: true };
    }

    const text = [
      '📊 Weekly team report',
      `Last 7 days:`,
      ...stats,
      '',
      'Open Team timeline for the full breakdown.',
    ].join('\n');
    return { text, aiGenerated: false };
  }

  /** Collect the raw weekly facts shared by the AI narrative and the stats digest. */
  private async gatherFacts(workspaceId: string) {
    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const [messages, activePeople, meeting, logged, decisionRows, checkins, contributors] =
      await Promise.all([
        this.prisma.message.count({
          where: { workspaceId, createdAt: { gte: weekAgo }, deletedAt: null },
        }),
        this.prisma.message.findMany({
          where: { workspaceId, createdAt: { gte: weekAgo } },
          distinct: ['userId'],
          select: { userId: true },
        }),
        this.prisma.activitySegment.aggregate({
          where: { workspaceId, kind: 'MEETING', startedAt: { gte: weekAgo } },
          _sum: { durationSec: true },
        }),
        this.prisma.activitySegment.aggregate({
          where: { workspaceId, kind: 'WORK_LOGGED', startedAt: { gte: weekAgo } },
          _sum: { durationSec: true },
        }),
        this.prisma.decision.findMany({
          where: { workspaceId, status: 'DECIDED', decidedAt: { gte: weekAgo } },
          orderBy: { decidedAt: 'desc' },
          take: 8,
          select: { title: true, outcome: true },
        }),
        this.prisma.standupResponse.count({
          where: { standup: { workspaceId }, createdAt: { gte: weekAgo } },
        }),
        this.prisma.message.groupBy({
          by: ['userId'],
          where: { workspaceId, createdAt: { gte: weekAgo }, deletedAt: null, userId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { userId: 'desc' } },
          take: 3,
        }),
      ]);

    const topUsers = await this.prisma.user.findMany({
      where: { id: { in: contributors.map((c) => c.userId!).filter(Boolean) } },
      select: { id: true, displayName: true },
    });
    const nameById = new Map(topUsers.map((u) => [u.id, u.displayName]));

    return {
      messages,
      activePeople: activePeople.length,
      meetingSec: meeting._sum.durationSec ?? 0,
      loggedSec: logged._sum.durationSec ?? 0,
      decisionsCount: decisionRows.length,
      decisions: decisionRows,
      checkins,
      topContributors: contributors.map((c) => ({
        name: nameById.get(c.userId!) ?? 'Someone',
        messages: c._count._all,
      })),
    };
  }

  /** Flatten the facts into the plain-text prompt the AI narrates from. */
  private factsPrompt(facts: Awaited<ReturnType<WeeklyReportService['gatherFacts']>>): string {
    const lines = [
      `Messages: ${facts.messages} from ${facts.activePeople} active people`,
      `Meetings/huddles: ${fmtDuration(facts.meetingSec)}`,
      `Work logged: ${fmtDuration(facts.loggedSec)}`,
      `Standup check-ins: ${facts.checkins}`,
      `Decisions recorded: ${facts.decisionsCount}`,
    ];
    if (facts.topContributors.length) {
      lines.push(
        `Most active: ${facts.topContributors.map((c) => `${c.name} (${c.messages} msgs)`).join(', ')}`,
      );
    }
    if (facts.decisions.length) {
      lines.push('Key decisions:');
      for (const d of facts.decisions) {
        lines.push(`- ${d.title}${d.outcome ? `: ${d.outcome}` : ''}`);
      }
    }
    return lines.join('\n');
  }

  private async requireManage(userId: string, id: string) {
    const r = await this.prisma.weeklyReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Report not found');
    const member = await this.policy.requireWorkspaceMember(userId, r.workspaceId);
    if (r.createdById !== userId && member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only the creator or an admin can manage this');
    }
    return r;
  }
}

function toDto(row: {
  id: string;
  channelId: string;
  dayOfWeek: number;
  timeOfDay: string;
  tzOffsetMin: number;
  active: boolean;
}): WeeklyReportDto {
  return {
    id: row.id,
    channelId: row.channelId,
    dayOfWeek: row.dayOfWeek,
    timeOfDay: row.timeOfDay,
    tzOffsetMin: row.tzOffsetMin,
    active: row.active,
  };
}
