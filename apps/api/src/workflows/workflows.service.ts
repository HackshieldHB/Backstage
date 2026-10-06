import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import type { Workflow } from '@prisma/client';
import {
  IncidentDeclaredConfigSchema,
  MemberJoinedConfigSchema,
  MessagePostedConfigSchema,
  ReactionAddedConfigSchema,
  ScheduleConfigSchema,
  SEVERITIES_ORDERED,
  TRIGGER_USER,
  type MessageDto,
  type WorkflowAction,
  type WorkflowConfig,
  type WorkflowDto,
  type WorkflowInput,
  type WorkflowTrigger,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer, conversationContainer } from '../messages/messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TasksService } from '../tasks/tasks.service';
import { WorkflowEvents, type WorkflowEvent } from './workflow-events';

const CONFIG_SCHEMAS = {
  message_posted: MessagePostedConfigSchema,
  reaction_added: ReactionAddedConfigSchema,
  member_joined: MemberJoinedConfigSchema,
  incident_declared: IncidentDeclaredConfigSchema,
  schedule: ScheduleConfigSchema,
} as const;

/** How far back a schedule tick looks for missed slots (covers a late worker). */
const SCHEDULE_LOOKBACK_MS = 10 * 60_000;

/** Replace {{name}} tokens with values; unknown tokens are left as typed. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

/** Weekday (0 = Sunday) and "HH:MM" of an instant in an IANA time zone. */
export function localSlot(at: Date, timeZone: string): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, time: `${get('hour')}:${get('minute')}` };
}

/**
 * True when a schedule slot (a whole minute matching `days` + `time` in
 * `timeZone`) falls in the window (from, to]. Pure, so it can be tested.
 */
export function scheduleSlotDue(
  cfg: { days: number[]; time: string; timeZone: string },
  from: Date,
  to: Date,
): boolean {
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000; // first minute strictly after `from`
  for (let i = 0; t <= to.getTime() && i < 24 * 60; i++, t += 60_000) {
    const slot = localSlot(new Date(t), cfg.timeZone);
    if (slot.time === cfg.time && cfg.days.includes(slot.day)) return true;
  }
  return false;
}

/** Whether an incident of `severity` meets a "at least `min`" threshold (SEV1 = most severe). */
export function severityMeets(severity: string, min: string): boolean {
  const s = SEVERITIES_ORDERED.indexOf(severity as (typeof SEVERITIES_ORDERED)[number]);
  const m = SEVERITIES_ORDERED.indexOf(min as (typeof SEVERITIES_ORDERED)[number]);
  return s !== -1 && m !== -1 && s <= m;
}

interface RunContext {
  workspaceId: string;
  /** The user whose action fired the trigger (null for schedules). */
  triggerUserId: string | null;
  vars: Record<string, string>;
  /** Source message/channel, linked onto created tasks. */
  messageId?: string;
  channelId?: string;
}

/**
 * Workflow automation: a trigger (message posted, reaction added, member joined,
 * incident declared, or a weekly schedule) runs up to five actions in order —
 * post to a channel, DM someone, or create a task. Only workspace admins manage
 * workflows; actions run on behalf of the workflow's creator and are re-checked
 * at run time (a removed creator stops their workflows).
 */
@Injectable()
export class WorkflowsService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    @Inject(forwardRef(() => IntegrationMessagesService))
    private readonly integrationMessages: IntegrationMessagesService,
    private readonly notifications: NotificationsService,
    private readonly conversations: ConversationsService,
    private readonly tasks: TasksService,
    private readonly events: WorkflowEvents,
  ) {}

  onModuleInit() {
    this.events.register((e) => this.onEvent(e));
  }

  // ---------- CRUD ----------

  async list(userId: string, workspaceId: string): Promise<WorkflowDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.workflow.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(userId: string, workspaceId: string, input: WorkflowInput): Promise<WorkflowDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    await this.validate(userId, workspaceId, input);
    const created = await this.prisma.workflow.create({
      data: {
        workspaceId,
        name: input.name,
        trigger: input.trigger,
        enabled: input.enabled,
        config: input.config as object,
        createdById: userId,
        // A schedule only fires for slots after it was saved.
        scheduleCursor: input.trigger === 'schedule' ? new Date() : null,
      },
    });
    return this.toDto(created);
  }

  async update(userId: string, id: string, input: WorkflowInput): Promise<WorkflowDto> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Workflow not found');
    await this.policy.requireWorkspaceMember(userId, existing.workspaceId, 'ADMIN');
    await this.validate(userId, existing.workspaceId, input);
    const updated = await this.prisma.workflow.update({
      where: { id },
      data: {
        name: input.name,
        trigger: input.trigger,
        enabled: input.enabled,
        config: input.config as object,
        scheduleCursor: input.trigger === 'schedule' ? new Date() : null,
      },
    });
    return this.toDto(updated);
  }

  /** Turn a workflow on/off without resubmitting its definition. */
  async setEnabled(userId: string, id: string, enabled: boolean): Promise<WorkflowDto> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Workflow not found');
    await this.policy.requireWorkspaceMember(userId, existing.workspaceId, 'ADMIN');
    const updated = await this.prisma.workflow.update({
      where: { id },
      data: {
        enabled,
        // Re-enabling a schedule must not replay slots missed while it was off.
        ...(enabled && existing.trigger === 'schedule' ? { scheduleCursor: new Date() } : {}),
      },
    });
    return this.toDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Workflow not found');
    await this.policy.requireWorkspaceMember(userId, existing.workspaceId, 'ADMIN');
    await this.prisma.workflow.delete({ where: { id } });
  }

  private async validate(userId: string, workspaceId: string, input: WorkflowInput): Promise<void> {
    const cfg = input.config as Record<string, unknown>;
    // The admin must be able to read a watched channel.
    if (typeof cfg.channelId === 'string')
      await this.requireChannelIn(userId, workspaceId, cfg.channelId);

    for (const action of input.config.actions) {
      if (action.type === 'post_message') {
        const channel = await this.requireChannelIn(userId, workspaceId, action.channelId);
        if (channel.isArchived) throw new BadRequestException('Cannot post to an archived channel');
        continue;
      }
      const who = action.type === 'send_dm' ? action.to : action.assignee;
      if (who === TRIGGER_USER) {
        if (input.trigger === 'schedule') {
          throw new BadRequestException(
            'A scheduled workflow has no triggering person — pick a specific member',
          );
        }
      } else if (!(await this.isActiveMember(workspaceId, who))) {
        throw new BadRequestException('Recipients and assignees must be members of this workspace');
      }
    }
  }

  private async requireChannelIn(userId: string, workspaceId: string, channelId: string) {
    const { channel } = await this.policy.requireChannelMember(userId, channelId);
    if (channel.workspaceId !== workspaceId)
      throw new ForbiddenException('Channels must belong to this workspace');
    return channel;
  }

  private async isActiveMember(workspaceId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { deactivatedAt: true },
    });
    return !!m && !m.deactivatedAt;
  }

  // ---------- triggers ----------

  /**
   * Called after every user message is persisted. Only genuine top-level user
   * messages trigger rules — INTEGRATION posts (including our own actions) never
   * re-trigger, which prevents loops. Best-effort: never surfaces to the sender.
   */
  async onMessagePosted(message: MessageDto): Promise<void> {
    if (message.kind !== 'USER' || message.parentId || !message.channelId || !message.user) return;
    try {
      for (const wf of await this.enabled(message.workspaceId, 'message_posted')) {
        const cfg = this.parse(wf, 'message_posted');
        if (!cfg || cfg.channelId !== message.channelId) continue;
        if (cfg.keyword && !message.contentText.toLowerCase().includes(cfg.keyword.toLowerCase()))
          continue;
        await this.run(wf, cfg.actions, {
          workspaceId: message.workspaceId,
          triggerUserId: message.user.id,
          messageId: message.id,
          channelId: message.channelId,
          vars: {
            user: message.user.displayName,
            channel: await this.channelName(message.channelId),
            message: message.contentText.slice(0, 500),
            date: isoDate(new Date()),
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Workflow evaluation failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async onEvent(e: WorkflowEvent): Promise<void> {
    if (e.type === 'reaction_added') {
      for (const wf of await this.enabled(e.workspaceId, 'reaction_added')) {
        const cfg = this.parse(wf, 'reaction_added');
        if (!cfg || cfg.channelId !== e.channelId || cfg.emoji !== e.emoji) continue;
        await this.run(wf, cfg.actions, {
          workspaceId: e.workspaceId,
          triggerUserId: e.userId,
          messageId: e.messageId,
          channelId: e.channelId,
          vars: {
            user: await this.displayName(e.userId),
            channel: await this.channelName(e.channelId),
            message: e.messageText.slice(0, 500),
            emoji: e.emoji,
            date: isoDate(new Date()),
          },
        });
      }
    } else if (e.type === 'member_joined') {
      for (const wf of await this.enabled(e.workspaceId, 'member_joined')) {
        const cfg = this.parse(wf, 'member_joined');
        if (!cfg || cfg.channelId !== e.channelId) continue;
        await this.run(wf, cfg.actions, {
          workspaceId: e.workspaceId,
          triggerUserId: e.userId,
          channelId: e.channelId,
          vars: {
            user: await this.displayName(e.userId),
            channel: await this.channelName(e.channelId),
            date: isoDate(new Date()),
          },
        });
      }
    } else if (e.type === 'incident_declared') {
      for (const wf of await this.enabled(e.workspaceId, 'incident_declared')) {
        const cfg = this.parse(wf, 'incident_declared');
        if (!cfg || !severityMeets(e.severity, cfg.minSeverity)) continue;
        await this.run(wf, cfg.actions, {
          workspaceId: e.workspaceId,
          triggerUserId: e.userId,
          vars: {
            user: await this.displayName(e.userId),
            incident: e.title,
            severity: e.severity,
            date: isoDate(new Date()),
          },
        });
      }
    }
  }

  /**
   * Runs every enabled schedule whose slot fell since it last ran. Each slot is
   * claimed atomically (compare-and-set on scheduleCursor) so concurrent workers
   * can't double-fire. Returns how many workflows ran.
   */
  async runDueSchedules(now = new Date()): Promise<number> {
    const rows = await this.prisma.workflow.findMany({
      where: { enabled: true, trigger: 'schedule' },
    });
    let ran = 0;
    for (const wf of rows) {
      const cfg = this.parse(wf, 'schedule');
      if (!cfg) continue;
      const cursor = wf.scheduleCursor ?? wf.createdAt;
      const from = new Date(Math.max(cursor.getTime(), now.getTime() - SCHEDULE_LOOKBACK_MS));
      if (!scheduleSlotDue(cfg, from, now)) continue;
      const { count } = await this.prisma.workflow.updateMany({
        where: { id: wf.id, scheduleCursor: wf.scheduleCursor },
        data: { scheduleCursor: now },
      });
      if (count === 0) continue; // another worker took this slot
      await this.run(wf, cfg.actions, {
        workspaceId: wf.workspaceId,
        triggerUserId: null,
        vars: { date: isoDate(now, cfg.timeZone) },
      });
      ran++;
    }
    return ran;
  }

  // ---------- actions ----------

  private async run(wf: Workflow, actions: WorkflowAction[], ctx: RunContext): Promise<void> {
    // Actions act on the creator's behalf: stop if they've left the workspace.
    if (!(await this.isActiveMember(wf.workspaceId, wf.createdById))) return;
    let ok = 0;
    for (const action of actions) {
      try {
        if (await this.runAction(wf, action, ctx)) ok++;
      } catch (err) {
        this.logger.warn(
          `Workflow ${wf.id} action ${action.type} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (ok > 0) {
      await this.prisma.workflow.update({
        where: { id: wf.id },
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      });
    }
  }

  /** Returns true when the action did something. */
  private async runAction(wf: Workflow, action: WorkflowAction, ctx: RunContext): Promise<boolean> {
    if (action.type === 'post_message') {
      const channel = await this.prisma.channel.findUnique({ where: { id: action.channelId } });
      if (!channel || channel.isArchived || channel.workspaceId !== ctx.workspaceId) return false;
      const text = renderTemplate(action.text, ctx.vars);
      await this.integrationMessages.post(channelContainer(channel.id), {
        workspaceId: ctx.workspaceId,
        contentText: text,
        contentJson: textDoc(text),
        appName: wf.name,
      });
      return true;
    }

    const target =
      (action.type === 'send_dm' ? action.to : action.assignee) === TRIGGER_USER
        ? ctx.triggerUserId
        : action.type === 'send_dm'
          ? action.to
          : action.assignee;
    if (!target || !(await this.isActiveMember(ctx.workspaceId, target))) return false;

    if (action.type === 'send_dm') {
      const text = renderTemplate(action.text, ctx.vars);
      if (target === wf.createdById) {
        // No DM-with-yourself: deliver to the creator as a notification instead.
        await this.notifications.notify({
          userId: target,
          type: 'SYSTEM',
          payload: { source: 'workflow', title: wf.name, text },
        });
        return true;
      }
      const dm = await this.conversations.open(wf.createdById, ctx.workspaceId, {
        memberIds: [target],
      });
      await this.integrationMessages.post(conversationContainer(dm.id), {
        workspaceId: ctx.workspaceId,
        contentText: text,
        contentJson: textDoc(text),
        appName: wf.name,
      });
      return true;
    }

    // create_task
    const dueAt =
      action.dueInDays !== undefined ? new Date(Date.now() + action.dueInDays * 86_400_000) : null;
    await this.tasks.createFromWorkflow({
      workspaceId: ctx.workspaceId,
      createdById: wf.createdById,
      assigneeId: target,
      title: renderTemplate(action.title, ctx.vars).slice(0, 300),
      dueAt,
      messageId: ctx.messageId ?? null,
      channelId: ctx.channelId ?? null,
    });
    return true;
  }

  // ---------- helpers ----------

  private enabled(workspaceId: string, trigger: WorkflowTrigger) {
    return this.prisma.workflow.findMany({ where: { workspaceId, enabled: true, trigger } });
  }

  /** Parse a stored config with its trigger's schema (lifting legacy shapes); null if invalid. */
  private parse<T extends WorkflowTrigger>(
    wf: Workflow,
    trigger: T,
  ): ReturnType<(typeof CONFIG_SCHEMAS)[T]['parse']> | null {
    const result = CONFIG_SCHEMAS[trigger].safeParse(wf.config);
    if (!result.success) {
      this.logger.warn(`Workflow ${wf.id} has an invalid ${trigger} config; skipping`);
      return null;
    }
    return result.data as ReturnType<(typeof CONFIG_SCHEMAS)[T]['parse']>;
  }

  private async channelName(channelId: string): Promise<string> {
    const c = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    return c?.name ?? 'channel';
  }

  private async displayName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return u?.displayName ?? 'Someone';
  }

  private toDto(w: Workflow): WorkflowDto {
    const trigger = w.trigger as WorkflowTrigger;
    const schema = CONFIG_SCHEMAS[trigger];
    const parsed = schema?.safeParse(w.config);
    return {
      id: w.id,
      name: w.name,
      enabled: w.enabled,
      trigger,
      config: (parsed?.success ? parsed.data : w.config) as WorkflowConfig,
      runCount: w.runCount,
      lastRunAt: w.lastRunAt?.toISOString() ?? null,
      createdAt: w.createdAt.toISOString(),
    };
  }
}

function textDoc(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((l) =>
        l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' },
      ),
  };
}

/** YYYY-MM-DD, in a time zone when given (else UTC). */
function isoDate(at: Date, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
