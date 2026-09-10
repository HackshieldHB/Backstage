import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CreateJiraAlertInput, JiraAlertRuleDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { MessagesService, channelContainer } from '../messages/messages.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianApiService, type JiraSearchRow } from './atlassian-api.service';
import { localTime, parseHHMM } from '../standups/due';

function textDoc(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })),
  };
}

interface DueRow {
  active: boolean;
  timeOfDay: string;
  tzOffsetMin: number;
  lastRunOn: string | null;
}

/** Is this rule due to fire at nowMs? Once per rule-local day, after timeOfDay. */
export function alertDue(r: DueRow, nowMs: number): { due: boolean; onDate: string } {
  const lt = localTime(nowMs, r.tzOffsetMin);
  const onDate = lt.date;
  if (!r.active) return { due: false, onDate };
  if (lt.minutes < parseHHMM(r.timeOfDay)) return { due: false, onDate };
  if (r.lastRunOn === onDate) return { due: false, onDate };
  return { due: true, onDate };
}

@Injectable()
export class JiraAlertsService {
  private readonly logger = new Logger(JiraAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
    private readonly atlassian: AtlassianService,
    private readonly jira: AtlassianApiService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<JiraAlertRuleDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.jiraAlertRule.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateJiraAlertInput): Promise<JiraAlertRuleDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
    if (channel.workspaceId !== workspaceId) throw new ForbiddenException('Channel not in workspace');
    const row = await this.prisma.jiraAlertRule.create({
      data: {
        workspaceId,
        channelId: input.channelId,
        staleDays: input.staleDays,
        timeOfDay: input.timeOfDay,
        tzOffsetMin: input.tzOffsetMin,
        createdById: userId,
      },
    });
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.requireManage(userId, id);
    await this.prisma.jiraAlertRule.delete({ where: { id } });
    return { ok: true };
  }

  async runNow(userId: string, id: string): Promise<{ posted: boolean }> {
    const rule = await this.requireManage(userId, id);
    const text = await this.buildDigest(rule.workspaceId, rule.staleDays);
    if (!text) return { posted: false };
    await this.post(rule.createdById, rule.channelId, text);
    return { posted: true };
  }

  /** Scheduler entrypoint: post every rule whose local time is due. */
  async runDue(now = new Date()): Promise<number> {
    const rules = await this.prisma.jiraAlertRule.findMany({ where: { active: true } });
    let posted = 0;
    for (const rule of rules) {
      const { due, onDate } = alertDue(rule, now.getTime());
      if (!due) continue;
      try {
        const text = await this.buildDigest(rule.workspaceId, rule.staleDays);
        if (text) {
          await this.post(rule.createdById, rule.channelId, text);
          posted++;
        }
      } catch (err) {
        this.logger.warn(`Jira alert ${rule.id} skipped: ${String(err)}`);
      }
      await this.prisma.jiraAlertRule
        .update({ where: { id: rule.id }, data: { lastRunOn: onDate } })
        .catch(() => undefined);
    }
    return posted;
  }

  /** Builds the alert message, or null when the workspace isn't connected / has nothing to flag. */
  private async buildDigest(workspaceId: string, staleDays: number): Promise<string | null> {
    const connection = await this.atlassian.connectionForWorkspace(workspaceId).catch(() => null);
    if (!connection) return null;
    const token = await this.atlassian.accessTokenFor(connection);
    const cloudId = connection.siteId;

    const [overdue, stale, unassigned] = await Promise.all([
      this.jira.searchJql(token, cloudId, 'duedate < now() AND statusCategory != Done ORDER BY duedate ASC').catch(() => []),
      this.jira.searchJql(token, cloudId, `statusCategory != Done AND updated <= -${staleDays}d ORDER BY updated ASC`).catch(() => []),
      this.jira.searchJql(token, cloudId, 'assignee IS EMPTY AND statusCategory != Done ORDER BY created DESC').catch(() => []),
    ]);

    if (overdue.length === 0 && stale.length === 0 && unassigned.length === 0) return null;

    const site = connection.siteUrl;
    const line = (r: JiraSearchRow) => `• ${r.key} — ${r.summary} (${site}/browse/${r.key})`;
    const block = (title: string, rows: JiraSearchRow[]) =>
      rows.length ? [`${title} (${rows.length}):`, ...rows.slice(0, 5).map(line), ''] : [];

    return [
      '🔔 Jira alert — issues needing attention',
      '',
      ...block('⏰ Overdue', overdue),
      ...block(`🕸️ Stale (untouched >${staleDays}d)`, stale),
      ...block('🙋 Unassigned', unassigned),
    ]
      .join('\n')
      .trimEnd();
  }

  private async post(userId: string, channelId: string, text: string) {
    await this.messages.send(userId, channelContainer(channelId), {
      clientMsgId: randomUUID(),
      contentJson: textDoc(text),
      contentText: text,
      attachmentIds: [],
    });
  }

  private async requireManage(userId: string, id: string) {
    const rule = await this.prisma.jiraAlertRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Alert rule not found');
    const member = await this.policy.requireWorkspaceMember(userId, rule.workspaceId);
    if (rule.createdById !== userId && member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only the creator or an admin can manage this');
    }
    return rule;
  }
}

function toDto(row: {
  id: string;
  channelId: string;
  staleDays: number;
  timeOfDay: string;
  active: boolean;
}): JiraAlertRuleDto {
  return {
    id: row.id,
    channelId: row.channelId,
    staleDays: row.staleDays,
    timeOfDay: row.timeOfDay,
    active: row.active,
  };
}
