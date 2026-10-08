import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Prisma, Workflow, WorkflowRun, WorkflowRunStatus } from '@prisma/client';
import {
  SOCKET_EVENTS,
  TRIGGER_USER,
  type RespondToWorkflowRequestInput,
  type WorkflowAction,
  type WorkflowFormField,
  type WorkflowRequestDto,
  type WorkflowRequestsChangedPayload,
  type WorkflowRunDto,
  type WorkflowRunStepDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { RealtimeService } from '../realtime/realtime.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer, conversationContainer } from '../messages/messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TasksService } from '../tasks/tasks.service';
import { postWebhook } from './safe-webhook';
import { renderTemplate, textDoc } from './workflow-utils';

/** What fired a run. */
export interface RunContext {
  workspaceId: string;
  trigger: string;
  /** The user whose action fired the trigger (null for schedules). */
  triggerUserId: string | null;
  vars: Record<string, string>;
  /** Source message/channel, linked onto created tasks. */
  messageId?: string;
  channelId?: string;
}

/** Pending approvals/forms expire after this long. */
export const REQUEST_TTL_MS = 7 * 24 * 60 * 60_000;
/** Runs kept per workflow (older ones are pruned). */
const KEEP_RUNS = 100;

type StepOutcome =
  { ok: boolean; detail: string } | { pause: true; userId: string; detail: string };

/** Validate and normalise form answers against the field definitions. */
export function validateAnswers(
  fields: WorkflowFormField[],
  answers: Record<string, string>,
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const values: Record<string, string> = {};
  for (const f of fields) {
    const raw = (answers[f.key] ?? '').trim();
    if (!raw) {
      if (f.required) return { ok: false, error: `“${f.label}” is required` };
      values[f.key] = '';
      continue;
    }
    if (f.kind === 'select' && !(f.options ?? []).includes(raw)) {
      return { ok: false, error: `Pick one of the options for “${f.label}”` };
    }
    values[f.key] = raw.slice(0, 2000);
  }
  return { ok: true, values };
}

/**
 * Executes workflow runs step by step and records what happened. Approval and
 * form steps pause the run (WAITING) until the requested person responds —
 * through the Tasks pane — then the run resumes from the next step with the
 * answers as variables. Every step runs on the workflow creator's behalf and
 * is re-checked at run time.
 */
@Injectable()
export class WorkflowRunsService {
  private readonly logger = new Logger(WorkflowRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly realtime: RealtimeService,
    @Inject(forwardRef(() => IntegrationMessagesService))
    private readonly integrationMessages: IntegrationMessagesService,
    private readonly notifications: NotificationsService,
    private readonly conversations: ConversationsService,
    private readonly tasks: TasksService,
  ) {}

  // ---------- execution ----------

  /** Start a run of `actions` for `wf`. Never throws (a failing workflow must not fail the trigger). */
  async start(
    wf: Workflow,
    actions: WorkflowAction[],
    ctx: RunContext,
  ): Promise<WorkflowRun | null> {
    try {
      const run = await this.prisma.workflowRun.create({
        data: {
          workflowId: wf.id,
          workspaceId: wf.workspaceId,
          trigger: ctx.trigger,
          triggerUserId: ctx.triggerUserId,
          actions: actions as unknown as Prisma.InputJsonValue,
          vars: ctx.vars,
          messageId: ctx.messageId ?? null,
          channelId: ctx.channelId ?? null,
        },
      });
      await this.prune(wf.id);
      return await this.execute(wf, run);
    } catch (err) {
      this.logger.warn(`Workflow ${wf.id} run failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Run steps from run.nextStep until done or paused. */
  private async execute(wf: Workflow, run: WorkflowRun): Promise<WorkflowRun> {
    const actions = run.actions as unknown as WorkflowAction[];
    const vars = { ...(run.vars as Record<string, string>) };
    const steps = [...((run.steps as unknown as WorkflowRunStepDto[]) ?? [])];
    const log = (index: number, type: WorkflowAction['type'], ok: boolean, detail: string) =>
      steps.push({ index, type, ok, detail, at: new Date().toISOString() });

    // Steps act on the creator's behalf: stop if they've left the workspace.
    if (!(await this.isActiveMember(wf.workspaceId, wf.createdById))) {
      log(
        run.nextStep,
        actions[run.nextStep]?.type ?? 'post_message',
        false,
        'Skipped: the workflow’s creator is no longer an active member',
      );
      return this.finish(run, steps, vars, 'FAILED');
    }

    for (let i = run.nextStep; i < actions.length; i++) {
      const action = actions[i];
      let outcome: StepOutcome;
      try {
        outcome = await this.runStep(wf, run, action, vars);
      } catch (err) {
        outcome = {
          ok: false,
          detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if ('pause' in outcome) {
        log(i, action.type, true, outcome.detail);
        const now = new Date();
        const paused = await this.prisma.workflowRun.update({
          where: { id: run.id },
          data: {
            status: 'WAITING',
            steps: steps as unknown as Prisma.InputJsonValue,
            vars,
            nextStep: i + 1,
            pendingUserId: outcome.userId,
            pendingSince: now,
            expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
          },
        });
        await this.notifyRequest(wf, paused, action, vars);
        return paused;
      }

      log(i, action.type, outcome.ok, outcome.detail);
      // A human step that couldn't even be requested gates everything after it.
      if (!outcome.ok && (action.type === 'request_approval' || action.type === 'ask_form')) {
        return this.finish(run, steps, vars, 'FAILED');
      }
    }

    const okCount = steps.filter((s) => s.ok).length;
    const status: WorkflowRunStatus =
      okCount === steps.length ? 'SUCCEEDED' : okCount === 0 ? 'FAILED' : 'PARTIAL';
    return this.finish(run, steps, vars, status);
  }

  private async finish(
    run: WorkflowRun,
    steps: WorkflowRunStepDto[],
    vars: Record<string, string>,
    status: WorkflowRunStatus,
  ): Promise<WorkflowRun> {
    const done = await this.prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status,
        steps: steps as unknown as Prisma.InputJsonValue,
        vars,
        finishedAt: new Date(),
        pendingUserId: null,
        expiresAt: null,
      },
    });
    if (steps.some((s) => s.ok)) {
      await this.prisma.workflow.update({
        where: { id: run.workflowId },
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      });
    }
    return done;
  }

  private async runStep(
    wf: Workflow,
    run: WorkflowRun,
    action: WorkflowAction,
    vars: Record<string, string>,
  ): Promise<StepOutcome> {
    if (action.type === 'post_message') {
      const channel = await this.prisma.channel.findUnique({ where: { id: action.channelId } });
      if (!channel || channel.workspaceId !== run.workspaceId) {
        return { ok: false, detail: 'Channel no longer exists' };
      }
      if (channel.isArchived) return { ok: false, detail: `#${channel.name} is archived` };
      const text = renderTemplate(action.text, vars);
      await this.integrationMessages.post(channelContainer(channel.id), {
        workspaceId: run.workspaceId,
        contentText: text,
        contentJson: textDoc(text),
        appName: wf.name,
      });
      return { ok: true, detail: `Posted to #${channel.name}` };
    }

    if (action.type === 'call_webhook') {
      const secret = await this.ensureSecret(wf);
      const status = await postWebhook(
        action.url,
        {
          workflow: { id: wf.id, name: wf.name },
          runId: run.id,
          trigger: run.trigger,
          variables: vars,
          sentAt: new Date().toISOString(),
        },
        secret,
      );
      const host = new URL(action.url).host;
      return status >= 200 && status < 300
        ? { ok: true, detail: `Called ${host} → ${status}` }
        : { ok: false, detail: `${host} answered ${status}` };
    }

    // Everything else targets a person.
    const who =
      action.type === 'send_dm'
        ? action.to
        : action.type === 'create_task' || action.type === 'ask_form'
          ? action.assignee
          : action.approver;
    const target = who === TRIGGER_USER ? run.triggerUserId : who;
    if (!target || !(await this.isActiveMember(run.workspaceId, target))) {
      return { ok: false, detail: 'That person is no longer in this workspace' };
    }
    const name = await this.displayName(target);

    if (action.type === 'send_dm') {
      const text = renderTemplate(action.text, vars);
      if (target === wf.createdById) {
        // No DM-with-yourself: deliver to the creator as a notification instead.
        await this.notifications.notify({
          userId: target,
          type: 'SYSTEM',
          payload: { source: 'workflow', title: wf.name, text },
        });
        return { ok: true, detail: `Notified ${name}` };
      }
      const dm = await this.conversations.open(wf.createdById, run.workspaceId, {
        memberIds: [target],
      });
      await this.integrationMessages.post(conversationContainer(dm.id), {
        workspaceId: run.workspaceId,
        contentText: text,
        contentJson: textDoc(text),
        appName: wf.name,
      });
      return { ok: true, detail: `Sent a DM to ${name}` };
    }

    if (action.type === 'create_task') {
      const dueAt =
        action.dueInDays !== undefined
          ? new Date(Date.now() + action.dueInDays * 86_400_000)
          : null;
      await this.tasks.createFromWorkflow({
        workspaceId: run.workspaceId,
        createdById: wf.createdById,
        assigneeId: target,
        title: renderTemplate(action.title, vars).slice(0, 300),
        dueAt,
        messageId: run.messageId,
        channelId: run.channelId,
      });
      return { ok: true, detail: `Created a task for ${name}` };
    }

    // request_approval / ask_form → pause for `target`.
    return {
      pause: true,
      userId: target,
      detail:
        action.type === 'request_approval'
          ? `Waiting for ${name} to approve`
          : `Waiting for ${name} to fill in the form`,
    };
  }

  // ---------- human steps ----------

  /** Pending approvals/forms addressed to the caller in a workspace. */
  async listRequests(userId: string, workspaceId: string): Promise<WorkflowRequestDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.workflowRun.findMany({
      where: {
        workspaceId,
        pendingUserId: userId,
        status: 'WAITING',
        expiresAt: { gt: new Date() },
      },
      include: {
        workflow: { include: { createdBy: { select: { id: true, displayName: true } } } },
      },
      orderBy: { pendingSince: 'asc' },
    });
    return rows.flatMap((r) => {
      const action = (r.actions as unknown as WorkflowAction[])[r.nextStep - 1];
      if (!action || (action.type !== 'request_approval' && action.type !== 'ask_form')) return [];
      const vars = r.vars as Record<string, string>;
      return [
        {
          runId: r.id,
          workflowName: r.workflow.name,
          kind: action.type,
          prompt: renderTemplate(action.prompt, vars),
          fields: action.type === 'ask_form' ? action.fields : [],
          requestedBy: r.workflow.createdBy,
          createdAt: (r.pendingSince ?? r.startedAt).toISOString(),
          expiresAt: r.expiresAt?.toISOString() ?? null,
        },
      ];
    });
  }

  /** Approve/reject or submit a form, then resume the run. */
  async respond(
    userId: string,
    runId: string,
    input: RespondToWorkflowRequestInput,
  ): Promise<WorkflowRunDto> {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId } });
    // 404 for anything not addressed to the caller: don't confirm it exists.
    if (!run || run.pendingUserId !== userId) throw new NotFoundException('Request not found');
    await this.policy.requireWorkspaceMember(userId, run.workspaceId);
    if (run.status !== 'WAITING' || !run.expiresAt || run.expiresAt <= new Date()) {
      throw new ConflictException('This request is no longer open');
    }
    const action = (run.actions as unknown as WorkflowAction[])[run.nextStep - 1];
    const name = await this.displayName(userId);
    const vars = { ...(run.vars as Record<string, string>) };
    let detail: string;
    let rejected = false;

    if (action?.type === 'request_approval') {
      if (!('decision' in input)) throw new BadRequestException('Approve or reject this request');
      rejected = input.decision === 'reject';
      vars.approver = name;
      vars.decision = rejected ? 'rejected' : 'approved';
      detail = rejected ? `Rejected by ${name}` : `Approved by ${name}`;
    } else if (action?.type === 'ask_form') {
      if (!('answers' in input)) throw new BadRequestException('Fill in the form');
      const checked = validateAnswers(action.fields, input.answers);
      if (!checked.ok) throw new BadRequestException(checked.error);
      Object.assign(vars, checked.values);
      vars.respondent = name;
      detail = `Form completed by ${name}`;
    } else {
      throw new ConflictException('This request is no longer open');
    }

    // Claim it: only one response wins, even if submitted twice concurrently.
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { id: run.id, status: 'WAITING', pendingUserId: userId },
      data: { status: 'RUNNING', pendingUserId: null, expiresAt: null },
    });
    if (count === 0) throw new ConflictException('This request is no longer open');
    this.emitRequestsChanged(userId, run.workspaceId);

    const steps = [...(run.steps as unknown as WorkflowRunStepDto[])];
    steps.push({
      index: run.nextStep - 1,
      type: action.type,
      ok: !rejected,
      detail,
      at: new Date().toISOString(),
    });
    const claimed = await this.prisma.workflowRun.update({
      where: { id: run.id },
      data: { steps: steps as unknown as Prisma.InputJsonValue, vars },
    });

    const wf = await this.prisma.workflow.findUnique({ where: { id: run.workflowId } });
    const final =
      rejected || !wf
        ? await this.finish(claimed, steps, vars, rejected ? 'REJECTED' : 'FAILED')
        : await this.execute(wf, claimed);
    return this.toRunDto(final, null);
  }

  /** Close requests nobody answered in time. Returns how many expired. */
  async expireRequests(now = new Date()): Promise<number> {
    const due = await this.prisma.workflowRun.findMany({
      where: { status: 'WAITING', expiresAt: { lte: now } },
      take: 200,
    });
    let expired = 0;
    for (const r of due) {
      const { count } = await this.prisma.workflowRun.updateMany({
        where: { id: r.id, status: 'WAITING' },
        data: { status: 'EXPIRED', finishedAt: now, pendingUserId: null },
      });
      if (count === 0) continue;
      const steps = [...(r.steps as unknown as WorkflowRunStepDto[])];
      const action = (r.actions as unknown as WorkflowAction[])[r.nextStep - 1];
      steps.push({
        index: r.nextStep - 1,
        type: action?.type ?? 'request_approval',
        ok: false,
        detail: 'Expired without a response',
        at: now.toISOString(),
      });
      await this.prisma.workflowRun.update({
        where: { id: r.id },
        data: { steps: steps as unknown as Prisma.InputJsonValue },
      });
      if (r.pendingUserId) this.emitRequestsChanged(r.pendingUserId, r.workspaceId);
      expired++;
    }
    return expired;
  }

  // ---------- history ----------

  /** The latest runs of a workflow (admins only — runs can carry message text). */
  async listRuns(userId: string, workflowId: string): Promise<WorkflowRunDto[]> {
    const wf = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!wf) throw new NotFoundException('Workflow not found');
    await this.policy.requireWorkspaceMember(userId, wf.workspaceId, 'ADMIN');
    const rows = await this.prisma.workflowRun.findMany({
      where: { workflowId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { triggerUser: { select: { id: true, displayName: true } } },
    });
    return rows.map((r) => this.toRunDto(r, r.triggerUser));
  }

  // ---------- helpers ----------

  private async notifyRequest(
    wf: Workflow,
    run: WorkflowRun,
    action: WorkflowAction,
    vars: Record<string, string>,
  ): Promise<void> {
    if (!run.pendingUserId) return;
    const prompt = 'prompt' in action ? renderTemplate(action.prompt, vars) : '';
    await this.notifications.notify({
      userId: run.pendingUserId,
      type: 'SYSTEM',
      payload: {
        source: 'workflow_request',
        action: action.type === 'request_approval' ? 'approval' : 'form',
        title: wf.name,
        text: prompt.slice(0, 200),
        runId: run.id,
      },
    });
    this.emitRequestsChanged(run.pendingUserId, run.workspaceId);
  }

  private emitRequestsChanged(userId: string, workspaceId: string): void {
    const payload: WorkflowRequestsChangedPayload = { workspaceId };
    this.realtime.emitToUser(userId, SOCKET_EVENTS.WORKFLOW_REQUESTS_CHANGED, payload);
  }

  /** The workflow's webhook signing secret, created on first use. */
  private async ensureSecret(wf: Workflow): Promise<string> {
    if (wf.signingSecret) return wf.signingSecret;
    const secret = randomBytes(32).toString('hex');
    await this.prisma.workflow.updateMany({
      where: { id: wf.id, signingSecret: null },
      data: { signingSecret: secret },
    });
    const fresh = await this.prisma.workflow.findUnique({
      where: { id: wf.id },
      select: { signingSecret: true },
    });
    return fresh?.signingSecret ?? secret;
  }

  private async prune(workflowId: string): Promise<void> {
    const stale = await this.prisma.workflowRun.findMany({
      where: { workflowId, status: { notIn: ['WAITING', 'RUNNING'] } },
      orderBy: { startedAt: 'desc' },
      skip: KEEP_RUNS,
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.workflowRun.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  }

  private async isActiveMember(workspaceId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { deactivatedAt: true },
    });
    return !!m && !m.deactivatedAt;
  }

  private async displayName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return u?.displayName ?? 'Someone';
  }

  private toRunDto(
    r: WorkflowRun,
    triggerUser: { id: string; displayName: string } | null,
  ): WorkflowRunDto {
    return {
      id: r.id,
      workflowId: r.workflowId,
      status: r.status,
      triggerUser,
      steps: (r.steps as unknown as WorkflowRunStepDto[]) ?? [],
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    };
  }
}
