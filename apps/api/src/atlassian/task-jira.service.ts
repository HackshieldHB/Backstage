import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { TaskDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskEvents, type TaskStatusChanged } from '../tasks/task-events';
import { AtlassianService } from './atlassian.service';
import { AtlassianApiService } from './atlassian-api.service';

/**
 * Pick the transition that moves an issue into `target`: "done" for a completed
 * task; for a reopened one prefer "In progress" (indeterminate), then "To do".
 */
export function pickTransition(
  transitions: Array<{ id: string; name: string; toCategory?: string | null }>,
  target: 'done' | 'open',
): { id: string; name: string } | null {
  if (target === 'done') return transitions.find((t) => t.toCategory === 'done') ?? null;
  return (
    transitions.find((t) => t.toCategory === 'indeterminate') ??
    transitions.find((t) => t.toCategory === 'new') ??
    null
  );
}

/**
 * Links tasks to Jira issues and keeps their status in step:
 *  - Backstages → Jira: completing/reopening a linked task transitions the issue,
 *    as the person who made the change (their own Atlassian link — never the
 *    shared workspace token, so Jira attributes it correctly). Failures are
 *    recorded on the task instead of failing the edit.
 *  - Jira → Backstages: status webhooks complete/reopen linked tasks (see
 *    JiraEventsService); that path never pushes back, so there is no loop.
 */
@Injectable()
export class TaskJiraService implements OnModuleInit {
  private readonly logger = new Logger(TaskJiraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly taskEvents: TaskEvents,
    private readonly atlassian: AtlassianService,
    private readonly api: AtlassianApiService,
  ) {}

  onModuleInit() {
    this.taskEvents.onStatusChanged((e) => this.pushStatus(e));
  }

  /** Create a Jira issue from a task (title → summary, notes → description) and link it. */
  async createIssue(userId: string, taskId: string, projectKey: string): Promise<TaskDto> {
    const task = await this.tasks.requireVisible(userId, taskId);
    if (task.jiraIssueKey) throw new ConflictException(`Already linked to ${task.jiraIssueKey}`);
    const connection = await this.atlassian.connectionForWorkspace(task.workspaceId);
    // Prefer the caller's own token so they're the issue's reporter.
    const token =
      (await this.atlassian.userAccessTokenFor(userId)) ??
      (await this.atlassian.accessTokenFor(connection));
    const link = await this.prisma.atlassianAccountLink.findUnique({ where: { userId } });
    const created = await this.api.createIssue(token, connection.siteId, {
      projectKey: projectKey.toUpperCase(),
      summary: task.title.slice(0, 250),
      description: task.notes.trim() || 'Created from a Backstages task.',
      reporterAccountId: link?.atlassianAccountId,
    });
    const issue = await this.api.getIssue(token, connection.siteId, created.key).catch(() => null);
    return this.tasks.setJiraLink(task.id, {
      key: created.key,
      url: `${connection.siteUrl}/browse/${created.key}`,
      status: issue?.status ?? null,
    });
  }

  /** Link a task to an existing issue (must exist on the workspace's Jira site). */
  async linkIssue(userId: string, taskId: string, issueKey: string): Promise<TaskDto> {
    const task = await this.tasks.requireVisible(userId, taskId);
    const connection = await this.atlassian.connectionForWorkspace(task.workspaceId);
    const token =
      (await this.atlassian.userAccessTokenFor(userId)) ??
      (await this.atlassian.accessTokenFor(connection));
    const issue = await this.api.getIssue(token, connection.siteId, issueKey);
    if (!issue) throw new NotFoundException(`Jira issue ${issueKey} not found`);
    return this.tasks.setJiraLink(task.id, {
      key: issue.key.toUpperCase(),
      url: `${connection.siteUrl}/browse/${issue.key}`,
      status: issue.status,
    });
  }

  async unlink(userId: string, taskId: string): Promise<TaskDto> {
    const task = await this.tasks.requireVisible(userId, taskId);
    return this.tasks.setJiraLink(task.id, null);
  }

  /** Backstages → Jira status push (called after a linked task opens/closes). */
  private async pushStatus({ task, actorId }: TaskStatusChanged): Promise<void> {
    if (!task.jiraIssueKey) return;
    const fail = (error: string) => this.tasks.setJiraSyncResult(task.id, { error });

    const connection = await this.prisma.atlassianConnection.findUnique({
      where: { workspaceId: task.workspaceId },
    });
    if (!connection) return fail('Jira is no longer connected to this workspace');
    const token = await this.atlassian.userAccessTokenFor(actorId);
    if (!token) {
      return fail(
        `Connect your Atlassian account to update ${task.jiraIssueKey} in Jira (Workspace menu → Connect Atlassian)`,
      );
    }

    const target = task.status === 'DONE' ? 'done' : 'open';
    try {
      const issue = await this.api.getIssue(token, connection.siteId, task.jiraIssueKey);
      if (!issue) return fail(`${task.jiraIssueKey} no longer exists in Jira`);
      const alreadyThere =
        issue.statusCategory != null && (issue.statusCategory === 'done') === (target === 'done');
      if (!alreadyThere) {
        const transitions = await this.api.getTransitions(token, connection.siteId, issue.key);
        const move = pickTransition(transitions, target);
        if (!move) {
          return fail(
            `Jira has no transition to ${target === 'done' ? 'a done status' : 'an open status'} for ${issue.key}`,
          );
        }
        await this.api.transitionIssue(token, connection.siteId, issue.key, move.id);
      }
      const after = await this.api.getIssue(token, connection.siteId, issue.key).catch(() => null);
      await this.tasks.setJiraSyncResult(task.id, {
        status: after?.status ?? issue.status,
        error: null,
      });
    } catch (err) {
      this.logger.warn(
        `Jira sync for ${task.jiraIssueKey} failed: ${err instanceof Error ? err.message : err}`,
      );
      await fail(`Jira rejected the update to ${task.jiraIssueKey}`);
    }
  }
}
