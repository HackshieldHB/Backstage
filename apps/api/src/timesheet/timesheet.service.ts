import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TimesheetEntry } from '@prisma/client';
import type { LogTimeInput, TimesheetEntryDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianService } from '../atlassian/atlassian.service';
import { AtlassianApiService } from '../atlassian/atlassian-api.service';
import { ActivityService } from './activity.service';

/**
 * User-facing timesheet: logs work against a Jira issue, mirrors it locally, and
 * pushes it to Jira as a native worklog (attributed to the caller's own account
 * when they've linked it, otherwise the shared workspace connection). Every
 * logged entry also becomes a WORK_LOGGED activity segment for utilization.
 */
@Injectable()
export class TimesheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly atlassian: AtlassianService,
    private readonly api: AtlassianApiService,
    private readonly activity: ActivityService,
  ) {}

  async logTime(userId: string, workspaceId: string, input: LogTimeInput): Promise<TimesheetEntryDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId);
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    if (Number.isNaN(startedAt.getTime())) throw new BadRequestException('Invalid start time');
    const durationSec = input.minutes * 60;

    const entry = await this.prisma.timesheetEntry.create({
      data: {
        workspaceId,
        userId,
        issueKey: input.issueKey,
        startedAt,
        durationSec,
        comment: input.comment?.trim() || null,
      },
    });

    // The work happened regardless of whether the Jira push succeeds.
    await this.activity.record({
      workspaceId,
      userId,
      kind: 'WORK_LOGGED',
      source: 'JIRA_WORKLOG',
      refId: input.issueKey,
      startedAt,
      durationSec,
    });

    // Push to Jira. On failure the entry stays unsynced and is retryable via
    // sync(); we surface the error so the user knows it didn't reach Jira.
    const synced = await this.pushToJira(userId, workspaceId, entry);
    return this.toDto(synced);
  }

  async listEntries(
    userId: string,
    workspaceId: string,
    range: { from?: Date; to?: Date },
  ): Promise<TimesheetEntryDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const entries = await this.prisma.timesheetEntry.findMany({
      where: {
        workspaceId,
        userId,
        ...(range.from || range.to
          ? { startedAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
          : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
    return entries.map((e) => this.toDto(e));
  }

  /** Retry pushing a previously-unsynced entry to Jira. */
  async sync(userId: string, entryId: string): Promise<TimesheetEntryDto> {
    const entry = await this.prisma.timesheetEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.userId !== userId) throw new NotFoundException('Timesheet entry not found');
    await this.policy.requireWorkspaceMember(userId, entry.workspaceId);
    if (entry.jiraWorklogId) return this.toDto(entry); // already synced
    const synced = await this.pushToJira(userId, entry.workspaceId, entry);
    return this.toDto(synced);
  }

  private async pushToJira(
    userId: string,
    workspaceId: string,
    entry: TimesheetEntry,
  ): Promise<TimesheetEntry> {
    const connection = await this.atlassian.connectionForWorkspace(workspaceId);
    const token =
      (await this.atlassian.userAccessTokenFor(userId)) ??
      (await this.atlassian.accessTokenFor(connection));
    const { id } = await this.api.addWorklog(token, connection.siteId, entry.issueKey, {
      startedAt: entry.startedAt,
      durationSec: entry.durationSec,
      comment: entry.comment ?? undefined,
    });
    return this.prisma.timesheetEntry.update({
      where: { id: entry.id },
      data: { jiraWorklogId: id, syncedAt: new Date() },
    });
  }

  private toDto(e: TimesheetEntry): TimesheetEntryDto {
    return {
      id: e.id,
      issueKey: e.issueKey,
      startedAt: e.startedAt.toISOString(),
      minutes: Math.round(e.durationSec / 60),
      comment: e.comment,
      synced: !!e.syncedAt,
      createdAt: e.createdAt.toISOString(),
    };
  }
}
