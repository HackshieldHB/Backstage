import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import {
  SOCKET_EVENTS,
  type CreateTaskInput,
  type TaskChangedPayload,
  type TaskDto,
  type UpdateTaskInput,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';

const userSelect = { select: { id: true, displayName: true, avatarUrl: true } };
const taskInclude = { createdBy: userSelect, assignee: userSelect } satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** How many completed tasks the list returns (open tasks are always all returned). */
const DONE_LIMIT = 100;

/**
 * Split a meeting action item of the form "Owner — do the thing" into its owner
 * name and the task text. Accepts em/en dashes, or a hyphen surrounded by spaces.
 * Returns owner=null when there is no recognisable prefix.
 */
export function splitOwnerPrefix(item: string): { owner: string | null; text: string } {
  const m = /^\s*([^—–\n]{1,40}?)\s+[—–-]\s+(.+)$/s.exec(item);
  if (!m) return { owner: null, text: item.trim() };
  return { owner: m[1].trim(), text: m[2].trim() };
}

/**
 * Resolve an owner name from an action item to exactly one candidate user, by
 * full display name or by first name. Ambiguous or unknown names resolve to null
 * so we never assign work to the wrong person.
 */
export function matchOwner(
  owner: string,
  candidates: Array<{ id: string; displayName: string }>,
): string | null {
  const needle = owner.trim().toLowerCase();
  if (!needle) return null;
  const full = candidates.filter((c) => c.displayName.trim().toLowerCase() === needle);
  if (full.length === 1) return full[0].id;
  if (full.length > 1) return null;
  const first = candidates.filter(
    (c) => c.displayName.trim().toLowerCase().split(/\s+/)[0] === needle,
  );
  return first.length === 1 ? first[0].id : null;
}

/**
 * Personal and assigned to-dos. A task is visible only to its creator and its
 * assignee — never to the wider workspace — so turning a private message into a
 * task can't leak it. Assignees must be active members of the task's workspace.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<TaskDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const mine: Prisma.TaskWhereInput = {
      workspaceId,
      OR: [{ createdById: userId }, { assigneeId: userId }],
    };
    const [open, done] = await Promise.all([
      this.prisma.task.findMany({
        where: { ...mine, status: 'OPEN' },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        include: taskInclude,
      }),
      this.prisma.task.findMany({
        where: { ...mine, status: 'DONE' },
        orderBy: { completedAt: 'desc' },
        take: DONE_LIMIT,
        include: taskInclude,
      }),
    ]);
    return [...open, ...done].map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateTaskInput): Promise<TaskDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const assigneeId = input.assigneeId ?? userId;
    if (assigneeId !== userId) await this.requireActiveMember(workspaceId, assigneeId);

    // A source message must be one the caller can read, in this workspace.
    let source: {
      messageId: string;
      channelId: string | null;
      conversationId: string | null;
    } | null = null;
    if (input.messageId) {
      const message = await this.prisma.message.findUnique({ where: { id: input.messageId } });
      if (!message || message.deletedAt || message.workspaceId !== workspaceId) {
        throw new NotFoundException('Message not found');
      }
      if (message.channelId) await this.policy.requireChannelMember(userId, message.channelId);
      else if (message.conversationId) {
        await this.policy.requireConversationMember(userId, message.conversationId);
      }
      source = {
        messageId: message.id,
        channelId: message.channelId,
        conversationId: message.conversationId,
      };
    }

    const row = await this.prisma.task.create({
      data: {
        workspaceId,
        title: input.title,
        notes: input.notes,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assigneeId,
        createdById: userId,
        ...(source ?? {}),
      },
      include: taskInclude,
    });
    await this.afterChange(row, userId, { assignedTo: assigneeId !== userId ? assigneeId : null });
    return toDto(row);
  }

  /** Turn a meeting's action item into a task, auto-assigning a named owner when unambiguous. */
  async createFromMeetingItem(
    userId: string,
    record: {
      id: string;
      workspaceId: string;
      channelId: string | null;
      conversationId: string | null;
    },
    item: string,
  ): Promise<TaskDto> {
    const { owner, text } = splitOwnerPrefix(item);
    let resolved: string | null = null;
    if (owner) {
      // Candidates are the meeting room's members — the people who could have been named.
      const where = record.channelId
        ? { channelMemberships: { some: { channelId: record.channelId } } }
        : { conversationMemberships: { some: { conversationId: record.conversationId ?? '' } } };
      const candidates = await this.prisma.user.findMany({
        where: {
          ...where,
          workspaceMemberships: { some: { workspaceId: record.workspaceId, deactivatedAt: null } },
        },
        select: { id: true, displayName: true },
      });
      resolved = matchOwner(owner, candidates);
    }
    const assigneeId = resolved ?? userId;
    // Keep the owner's name in the title when we couldn't resolve it to a person.
    const title = (owner && !resolved ? item.trim() : text).slice(0, 300);

    const row = await this.prisma.task.create({
      data: {
        workspaceId: record.workspaceId,
        title,
        assigneeId,
        createdById: userId,
        channelId: record.channelId,
        conversationId: record.conversationId,
        meetingRecordId: record.id,
      },
      include: taskInclude,
    });
    await this.afterChange(row, userId, { assignedTo: assigneeId !== userId ? assigneeId : null });
    return toDto(row);
  }

  /**
   * A task created by a workflow action on its creator's behalf. The caller has
   * already resolved the assignee; it must still be an active member.
   */
  async createFromWorkflow(input: {
    workspaceId: string;
    createdById: string;
    assigneeId: string;
    title: string;
    dueAt: Date | null;
    messageId: string | null;
    channelId: string | null;
  }): Promise<TaskDto> {
    await this.requireActiveMember(input.workspaceId, input.assigneeId);
    const row = await this.prisma.task.create({
      data: {
        workspaceId: input.workspaceId,
        title: input.title,
        dueAt: input.dueAt,
        assigneeId: input.assigneeId,
        createdById: input.createdById,
        messageId: input.messageId,
        channelId: input.channelId,
      },
      include: taskInclude,
    });
    await this.afterChange(row, input.createdById, {
      assignedTo: input.assigneeId !== input.createdById ? input.assigneeId : null,
    });
    return toDto(row);
  }

  async update(userId: string, id: string, input: UpdateTaskInput): Promise<TaskDto> {
    const existing = await this.loadVisible(userId, id);
    if (input.assigneeId) await this.requireActiveMember(existing.workspaceId, input.assigneeId);

    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
    if (input.dueAt !== undefined) {
      data.dueAt = input.dueAt ? new Date(input.dueAt) : null;
      data.dueNotifiedAt = null; // a new deadline earns a fresh "due" notification
    }
    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      data.completedAt = input.status === 'DONE' ? new Date() : null;
    }

    const row = await this.prisma.task.update({ where: { id }, data, include: taskInclude });
    const reassigned =
      input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId
        ? input.assigneeId
        : null;
    await this.afterChange(row, userId, {
      assignedTo: reassigned && reassigned !== userId ? reassigned : null,
      previousAssigneeId: existing.assigneeId,
      completed: existing.status === 'OPEN' && row.status === 'DONE',
    });
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.loadVisible(userId, id);
    if (existing.createdById !== userId)
      throw new ForbiddenException('Only the creator can delete a task');
    await this.prisma.task.delete({ where: { id } });
    this.emit(existing, true, existing.assigneeId);
    return { ok: true };
  }

  /**
   * Sends one "task is due" notification per open task whose deadline has passed
   * (to the assignee, or the creator if unassigned). Called by the worker each
   * minute; returns how many notifications were sent.
   */
  async notifyDue(now = new Date()): Promise<number> {
    const due = await this.prisma.task.findMany({
      where: { status: 'OPEN', dueNotifiedAt: null, dueAt: { lte: now } },
      take: 200,
    });
    let sent = 0;
    for (const t of due) {
      // Claim it first so a concurrent sweep can't double-notify.
      const { count } = await this.prisma.task.updateMany({
        where: { id: t.id, dueNotifiedAt: null },
        data: { dueNotifiedAt: now },
      });
      if (count === 0) continue;
      await this.notifications.notify({
        userId: t.assigneeId ?? t.createdById,
        type: 'SYSTEM',
        payload: { source: 'task', action: 'due', taskId: t.id, title: t.title },
      });
      sent++;
    }
    return sent;
  }

  // ---------- helpers ----------

  private async loadVisible(userId: string, id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    // 404 (not 403) for tasks the caller isn't party to: don't confirm they exist.
    if (!task || (task.createdById !== userId && task.assigneeId !== userId)) {
      throw new NotFoundException('Task not found');
    }
    await this.policy.requireWorkspaceMember(userId, task.workspaceId);
    return task;
  }

  private async requireActiveMember(workspaceId: string, userId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { deactivatedAt: true },
    });
    if (!member || member.deactivatedAt) {
      throw new ForbiddenException('Assignee must be a member of this workspace');
    }
  }

  private async afterChange(
    row: TaskRow,
    actorId: string,
    opts: { assignedTo?: string | null; previousAssigneeId?: string | null; completed?: boolean },
  ): Promise<void> {
    this.emit(row, false, opts.previousAssigneeId);
    if (opts.assignedTo) {
      await this.notifications.notify({
        userId: opts.assignedTo,
        type: 'SYSTEM',
        actorId,
        payload: { source: 'task', action: 'assigned', taskId: row.id, title: row.title },
      });
    }
    if (opts.completed && row.createdById !== actorId) {
      await this.notifications.notify({
        userId: row.createdById,
        type: 'SYSTEM',
        actorId,
        payload: { source: 'task', action: 'completed', taskId: row.id, title: row.title },
      });
    }
  }

  /** Tell everyone who can (or just stopped being able to) see the task to refresh. */
  private emit(task: Task, deleted: boolean, previousAssigneeId?: string | null): void {
    const payload: TaskChangedPayload = { workspaceId: task.workspaceId, taskId: task.id, deleted };
    const recipients = new Set(
      [task.createdById, task.assigneeId, previousAssigneeId].filter(Boolean) as string[],
    );
    for (const uid of recipients)
      this.realtime.emitToUser(uid, SOCKET_EVENTS.TASK_CHANGED, payload);
  }
}

function toDto(t: TaskRow): TaskDto {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    title: t.title,
    notes: t.notes,
    status: t.status,
    dueAt: t.dueAt?.toISOString() ?? null,
    assignee: t.assignee,
    createdBy: t.createdBy,
    messageId: t.messageId,
    channelId: t.channelId,
    conversationId: t.conversationId,
    meetingRecordId: t.meetingRecordId,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
