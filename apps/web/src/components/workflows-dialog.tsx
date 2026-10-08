'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, History, Pencil, Plus, Trash2, X, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  MAX_WORKFLOW_ACTIONS,
  TRIGGER_USER,
  WORKFLOW_VARIABLES,
  WorkflowInputSchema,
  type WorkflowAction,
  type WorkflowDto,
  type WorkflowFormField,
  type WorkflowRunStatus,
  type WorkflowTrigger,
} from '@backstages/shared';
import { api } from '@/lib/api';
import {
  keys,
  useMembers,
  useWorkflowRuns,
  useWorkflows,
  type ChannelWithMeta,
} from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

const TRIGGER_LABEL: Record<WorkflowTrigger, string> = {
  message_posted: 'A message is posted',
  reaction_added: 'Someone reacts with an emoji',
  member_joined: 'Someone joins a channel',
  incident_declared: 'An incident is declared',
  schedule: 'On a schedule',
};
const ACTION_LABEL: Record<WorkflowAction['type'], string> = {
  post_message: 'Post to a channel',
  send_dm: 'Send a direct message',
  create_task: 'Create a task',
  call_webhook: 'Call a webhook',
  request_approval: 'Ask for approval',
  ask_form: 'Ask someone to fill in a form',
};
const RUN_STATUS_STYLE: Record<WorkflowRunStatus, string> = {
  RUNNING: 'bg-blue-500/15 text-blue-500',
  WAITING: 'bg-amber-500/15 text-amber-500',
  SUCCEEDED: 'bg-green-500/15 text-green-500',
  PARTIAL: 'bg-amber-500/15 text-amber-500',
  FAILED: 'bg-red-500/15 text-red-500',
  REJECTED: 'bg-red-500/15 text-red-500',
  EXPIRED: 'bg-slate-500/15 text-ink-3',
};
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Lookup = (id: string) => string;

/** One-line, human description of when a workflow fires. */
export function describeTrigger(
  wf: Pick<WorkflowDto, 'trigger' | 'config'>,
  channel: Lookup,
): string {
  const c = wf.config as Record<string, unknown>;
  switch (wf.trigger) {
    case 'message_posted':
      return `When a message${c.keyword ? ` containing “${String(c.keyword)}”` : ''} is posted in #${channel(String(c.channelId))}`;
    case 'reaction_added':
      return `When someone reacts :${String(c.emoji)}: in #${channel(String(c.channelId))}`;
    case 'member_joined':
      return `When someone joins #${channel(String(c.channelId))}`;
    case 'incident_declared':
      return c.minSeverity === 'SEV3' || !c.minSeverity
        ? 'When any incident is declared'
        : `When a ${String(c.minSeverity)} or worse incident is declared`;
    case 'schedule': {
      const days = (c.days as number[]) ?? [];
      const dayText =
        days.length === 7
          ? 'Every day'
          : [1, 2, 3, 4, 5].every((d) => days.includes(d)) && days.length === 5
            ? 'Weekdays'
            : [...days]
                .sort()
                .map((d) => DAY_LABELS[d])
                .join(', ');
      return `${dayText} at ${String(c.time)} (${String(c.timeZone)})`;
    }
    default:
      return 'Unknown trigger';
  }
}

/** One-line, human description of an action. */
export function describeAction(a: WorkflowAction, channel: Lookup, person: Lookup): string {
  const who = (id: string) => (id === TRIGGER_USER ? 'the person who triggered it' : person(id));
  switch (a.type) {
    case 'post_message':
      return `post to #${channel(a.channelId)}`;
    case 'send_dm':
      return `DM ${who(a.to)}`;
    case 'create_task':
      return `create a task for ${who(a.assignee)}`;
    case 'call_webhook': {
      let host = a.url;
      try {
        host = new URL(a.url).host;
      } catch {
        /* show as typed */
      }
      return `call ${host}`;
    }
    case 'request_approval':
      return `ask ${who(a.approver)} to approve`;
    case 'ask_form':
      return `ask ${who(a.assignee)} to fill in a form`;
  }
}

/** Variables a step can use: the trigger's, plus anything earlier approval/form steps add. */
export function variablesBefore(
  trigger: WorkflowTrigger,
  actions: WorkflowAction[],
  index: number,
): string[] {
  const vars = [...WORKFLOW_VARIABLES[trigger]];
  for (const a of actions.slice(0, index)) {
    if (a.type === 'request_approval') vars.push('approver', 'decision');
    if (a.type === 'ask_form')
      vars.push('respondent', ...a.fields.map((f) => f.key).filter(Boolean));
  }
  return [...new Set(vars)];
}

/** A short, human message for the first schema problem, naming the step. */
export function describeIssue(issue: { path: (string | number)[]; message: string }): string {
  const stepIdx =
    issue.path[0] === 'config' && issue.path[1] === 'actions' ? issue.path[2] : undefined;
  const field = issue.path[issue.path.length - 1];
  const message = /at least 1 character|Required|Invalid input/i.test(issue.message)
    ? `${typeof field === 'string' ? field : 'a field'} is required`
    : issue.message;
  if (typeof stepIdx === 'number') return `Step ${stepIdx + 1}: ${message}`;
  if (issue.path.length === 0) return message;
  return `Check “${String(field)}”: ${message}`;
}

// ---------- editor state ----------

interface Draft {
  name: string;
  trigger: WorkflowTrigger;
  channelId: string;
  keyword: string;
  emoji: string;
  minSeverity: 'SEV1' | 'SEV2' | 'SEV3';
  days: number[];
  time: string;
  timeZone: string;
  actions: WorkflowAction[];
  enabled: boolean;
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function emptyDraft(channels: ChannelWithMeta[]): Draft {
  const first = channels[0]?.id ?? '';
  return {
    name: '',
    trigger: 'message_posted',
    channelId: first,
    keyword: '',
    emoji: 'ticket',
    minSeverity: 'SEV3',
    days: [1, 2, 3, 4, 5],
    time: '09:00',
    timeZone: localTimeZone(),
    actions: [{ type: 'post_message', channelId: first, text: '' }],
    enabled: true,
  };
}

function draftFrom(wf: WorkflowDto, channels: ChannelWithMeta[]): Draft {
  const c = wf.config as Record<string, unknown>;
  const d = emptyDraft(channels);
  return {
    ...d,
    name: wf.name,
    trigger: wf.trigger,
    enabled: wf.enabled,
    channelId: typeof c.channelId === 'string' ? c.channelId : d.channelId,
    keyword: typeof c.keyword === 'string' ? c.keyword : '',
    emoji: typeof c.emoji === 'string' ? c.emoji : d.emoji,
    minSeverity: (c.minSeverity as Draft['minSeverity']) ?? 'SEV3',
    days: Array.isArray(c.days) ? (c.days as number[]) : d.days,
    time: typeof c.time === 'string' ? c.time : d.time,
    timeZone: typeof c.timeZone === 'string' ? c.timeZone : d.timeZone,
    actions: (c.actions as WorkflowAction[]) ?? d.actions,
  };
}

/** Shape the draft into the API body for its trigger (validated by the shared schema). */
export function toInput(d: Pick<Draft, keyof Draft>) {
  const base = { name: d.name.trim(), enabled: d.enabled, trigger: d.trigger };
  const actions = d.actions;
  switch (d.trigger) {
    case 'message_posted':
      return {
        ...base,
        config: {
          channelId: d.channelId,
          ...(d.keyword.trim() ? { keyword: d.keyword.trim() } : {}),
          actions,
        },
      };
    case 'reaction_added':
      return {
        ...base,
        config: { channelId: d.channelId, emoji: d.emoji.trim().replace(/^:|:$/g, ''), actions },
      };
    case 'member_joined':
      return { ...base, config: { channelId: d.channelId, actions } };
    case 'incident_declared':
      return { ...base, config: { minSeverity: d.minSeverity, actions } };
    case 'schedule':
      return {
        ...base,
        config: { days: [...d.days].sort(), time: d.time, timeZone: d.timeZone.trim(), actions },
      };
  }
}

function newAction(
  type: WorkflowAction['type'],
  d: Draft,
  channels: ChannelWithMeta[],
): WorkflowAction {
  const person = d.trigger === 'schedule' ? '' : TRIGGER_USER;
  switch (type) {
    case 'post_message':
      return { type, channelId: channels[0]?.id ?? '', text: '' };
    case 'send_dm':
      return { type, to: person, text: '' };
    case 'create_task':
      return { type, title: '', assignee: person };
    case 'call_webhook':
      return { type, url: 'https://' };
    case 'request_approval':
      return { type, approver: '', prompt: '' };
    case 'ask_form':
      return {
        type,
        assignee: person,
        prompt: '',
        fields: [{ key: 'answer', label: 'Answer', kind: 'text', required: true }],
      };
  }
}

/** Clear "the person who triggered it" from every step (a schedule has nobody). */
function withoutTriggerUser(actions: WorkflowAction[]): WorkflowAction[] {
  return actions.map((a) => {
    if (a.type === 'send_dm' && a.to === TRIGGER_USER) return { ...a, to: '' };
    if ((a.type === 'create_task' || a.type === 'ask_form') && a.assignee === TRIGGER_USER)
      return { ...a, assignee: '' };
    if (a.type === 'request_approval' && a.approver === TRIGGER_USER) return { ...a, approver: '' };
    return a;
  });
}

// ---------- dialog ----------

/**
 * Workflow builder: pick a trigger, then up to five steps — post to a channel,
 * DM someone, create a task, call a webhook, or pause for an approval / form.
 * Text can use {{variables}} from the trigger and earlier steps.
 */
export function WorkflowsDialog({
  workspaceId,
  channels,
  canManage,
  onClose,
}: {
  workspaceId: string;
  channels: ChannelWithMeta[];
  canManage: boolean;
  onClose: () => void;
}) {
  const workflows = useWorkflows(workspaceId);
  const members = useMembers(workspaceId);
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.workflows(workspaceId) });
  const channelName: Lookup = (id) => channels.find((c) => c.id === id)?.name ?? 'unknown-channel';
  const personName: Lookup = (id) =>
    members.data?.find((m) => m.user.id === id)?.user.displayName ?? 'a member';

  const fail = (fallback: string) => (err: unknown) =>
    pushToast(err instanceof Error ? err.message : fallback, 'error');

  const remove = async (id: string) => {
    try {
      await api('DELETE', `/workflows/${id}`);
      await refresh();
    } catch (err) {
      fail('Could not delete')(err);
    }
  };

  const toggle = async (wf: WorkflowDto) => {
    try {
      await api('PATCH', `/workflows/${wf.id}`, { enabled: !wf.enabled });
      await refresh();
    } catch (err) {
      fail('Could not update')(err);
    }
  };

  if (editing) {
    return (
      <Dialog title={editing.id ? 'Edit workflow' : 'New workflow'} onClose={onClose} wide>
        <WorkflowEditor
          workspaceId={workspaceId}
          channels={channels}
          workflowId={editing.id}
          initial={editing.draft}
          onDone={async () => {
            setEditing(null);
            await refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      </Dialog>
    );
  }

  return (
    <Dialog title="Workflows" onClose={onClose} wide>
      <p className="mb-3 text-sm text-ink-3">
        Automate routine work: when something happens, post a message, DM someone, create a task,
        call a webhook, or ask someone to approve or fill in a form.
        {!canManage && ' Only workspace admins can create or change workflows.'}
      </p>

      <ul className="mb-4 space-y-2">
        {(workflows.data ?? []).map((wf) => (
          <li
            key={wf.id}
            className="flex items-start gap-3 rounded-lg border border-line p-3"
            data-testid="workflow-row"
          >
            <Zap size={16} className={wf.enabled ? 'mt-0.5 text-accent' : 'mt-0.5 text-ink-3'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">{wf.name}</div>
              <div className="text-[12px] text-ink-2">
                {describeTrigger(wf, channelName)} →{' '}
                {(wf.config.actions ?? [])
                  .map((a) => describeAction(a, channelName, personName))
                  .join(', then ')}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">
                {wf.runCount > 0 && wf.lastRunAt
                  ? `Ran ${wf.runCount} time${wf.runCount === 1 ? '' : 's'} · last ${formatDistanceToNow(new Date(wf.lastRunAt), { addSuffix: true })}`
                  : 'Hasn’t run yet'}
              </div>
              {canManage && wf.signingSecret && <SigningSecret secret={wf.signingSecret} />}
              {historyFor === wf.id && <RunHistory workflowId={wf.id} />}
            </div>
            {canManage && (
              <>
                <button
                  onClick={() => setHistoryFor((cur) => (cur === wf.id ? null : wf.id))}
                  title="Run history"
                  aria-label={`Run history for ${wf.name}`}
                  aria-expanded={historyFor === wf.id}
                  className="shrink-0 rounded p-1 text-ink-3 hover:bg-hovered hover:text-ink"
                >
                  <History size={15} />
                </button>
                <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-3">
                  <input type="checkbox" checked={wf.enabled} onChange={() => void toggle(wf)} />
                  On
                </label>
                <button
                  onClick={() => setEditing({ id: wf.id, draft: draftFrom(wf, channels) })}
                  title="Edit"
                  aria-label={`Edit ${wf.name}`}
                  className="shrink-0 rounded p-1 text-ink-3 hover:bg-hovered hover:text-ink"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => void remove(wf.id)}
                  title="Delete"
                  aria-label={`Delete ${wf.name}`}
                  className="shrink-0 rounded p-1 text-ink-3 hover:bg-red-500/10 hover:text-red-500"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </li>
        ))}
        {workflows.isSuccess && workflows.data.length === 0 && (
          <li className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-ink-3">
            No workflows yet.
          </li>
        )}
      </ul>

      {canManage && (
        <button
          onClick={() => setEditing({ id: null, draft: emptyDraft(channels) })}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          data-testid="new-workflow"
        >
          <Plus size={15} /> New workflow
        </button>
      )}
    </Dialog>
  );
}

const inputCls =
  'w-full rounded-md border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';
const labelCls = 'block text-xs font-medium text-ink-3';

function WorkflowEditor({
  workspaceId,
  channels,
  workflowId,
  initial,
  onDone,
  onCancel,
}: {
  workspaceId: string;
  channels: ChannelWithMeta[];
  workflowId: string | null;
  initial: Draft;
  onDone: () => void;
  onCancel: () => void;
}) {
  const pushToast = useUiStore((s) => s.pushToast);
  const members = useMembers(workspaceId);
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const setAction = (i: number, a: WorkflowAction) =>
    setD((prev) => ({ ...prev, actions: prev.actions.map((x, j) => (j === i ? a : x)) }));

  const hasTriggerUser = d.trigger !== 'schedule';

  const changeTrigger = (trigger: WorkflowTrigger) => {
    // A schedule has no triggering person: clear any such recipient.
    set({ trigger, actions: trigger === 'schedule' ? withoutTriggerUser(d.actions) : d.actions });
  };

  const submit = async () => {
    const parsed = WorkflowInputSchema.safeParse(toInput(d));
    if (!parsed.success) {
      pushToast(describeIssue(parsed.error.issues[0]), 'error');
      return;
    }
    setBusy(true);
    try {
      if (workflowId) await api('PUT', `/workflows/${workflowId}`, parsed.data);
      else await api('POST', `/workspaces/${workspaceId}/workflows`, parsed.data);
      onDone();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not save the workflow', 'error');
      setBusy(false);
    }
  };

  const channelOptions = channels.map((c) => (
    <option key={c.id} value={c.id}>
      #{c.name}
    </option>
  ));
  const personOptions = (
    <>
      <option value="" disabled>
        Choose a person…
      </option>
      {hasTriggerUser && <option value={TRIGGER_USER}>The person who triggered it</option>}
      {(members.data ?? []).map((m) => (
        <option key={m.user.id} value={m.user.id}>
          {m.user.displayName}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-4" data-testid="workflow-editor">
      <button
        onClick={onCancel}
        className="flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={14} /> All workflows
      </button>

      <label className={labelCls}>
        Name
        <input
          className={`${inputCls} mt-1`}
          placeholder="e.g. Deploy notifier"
          value={d.name}
          maxLength={80}
          onChange={(e) => set({ name: e.target.value })}
          autoFocus
          data-testid="workflow-name"
        />
      </label>

      {/* Trigger */}
      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-ink-2">When…</legend>
        <select
          className={inputCls}
          value={d.trigger}
          onChange={(e) => changeTrigger(e.target.value as WorkflowTrigger)}
          aria-label="Trigger"
          data-testid="workflow-trigger"
        >
          {(Object.keys(TRIGGER_LABEL) as WorkflowTrigger[]).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABEL[t]}
            </option>
          ))}
        </select>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(d.trigger === 'message_posted' ||
            d.trigger === 'reaction_added' ||
            d.trigger === 'member_joined') && (
            <label className={labelCls}>
              Channel
              <select
                className={`${inputCls} mt-1`}
                value={d.channelId}
                onChange={(e) => set({ channelId: e.target.value })}
              >
                {channelOptions}
              </select>
            </label>
          )}
          {d.trigger === 'message_posted' && (
            <label className={labelCls}>
              Containing (optional)
              <input
                className={`${inputCls} mt-1`}
                placeholder="keyword"
                value={d.keyword}
                maxLength={100}
                onChange={(e) => set({ keyword: e.target.value })}
              />
            </label>
          )}
          {d.trigger === 'reaction_added' && (
            <label className={labelCls}>
              Emoji shortcode
              <input
                className={`${inputCls} mt-1`}
                placeholder="ticket"
                value={d.emoji}
                maxLength={64}
                onChange={(e) => set({ emoji: e.target.value })}
              />
            </label>
          )}
          {d.trigger === 'incident_declared' && (
            <label className={labelCls}>
              Severity
              <select
                className={`${inputCls} mt-1`}
                value={d.minSeverity}
                onChange={(e) => set({ minSeverity: e.target.value as Draft['minSeverity'] })}
              >
                <option value="SEV3">Any severity</option>
                <option value="SEV2">SEV2 or worse</option>
                <option value="SEV1">SEV1 only</option>
              </select>
            </label>
          )}
        </div>

        {d.trigger === 'schedule' && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
              {DAY_LABELS.map((label, day) => {
                const on = d.days.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set({ days: on ? d.days.filter((x) => x !== day) : [...d.days, day] })
                    }
                    className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${on ? 'bg-accent text-white' : 'bg-hovered text-ink-2'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelCls}>
                Time
                <input
                  type="time"
                  className={`${inputCls} mt-1`}
                  value={d.time}
                  onChange={(e) => set({ time: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Time zone
                <input
                  className={`${inputCls} mt-1`}
                  value={d.timeZone}
                  onChange={(e) => set({ timeZone: e.target.value })}
                />
              </label>
            </div>
          </div>
        )}
      </fieldset>

      {/* Actions */}
      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-ink-2">Then…</legend>
        <p className="mb-2 text-[11px] text-ink-3">
          Steps run in order. An approval or form pauses the run until that person responds (in
          their Tasks); rejecting an approval stops it.
        </p>
        <ol className="space-y-2">
          {d.actions.map((a, i) => (
            <li
              key={i}
              className="rounded-md border border-line bg-surface p-2.5"
              data-testid={`workflow-action-${i}`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-ink-3">{i + 1}.</span>
                <select
                  className={inputCls}
                  value={a.type}
                  onChange={(e) =>
                    setAction(i, newAction(e.target.value as WorkflowAction['type'], d, channels))
                  }
                  aria-label={`Action ${i + 1} type`}
                >
                  {(Object.keys(ACTION_LABEL) as WorkflowAction['type'][]).map((t) => (
                    <option key={t} value={t}>
                      {ACTION_LABEL[t]}
                    </option>
                  ))}
                </select>
                {d.actions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => set({ actions: d.actions.filter((_, j) => j !== i) })}
                    aria-label={`Remove action ${i + 1}`}
                    className="rounded p-1 text-ink-3 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {a.type === 'post_message' && (
                <>
                  <select
                    className={`${inputCls} mb-2`}
                    value={a.channelId}
                    onChange={(e) => setAction(i, { ...a, channelId: e.target.value })}
                    aria-label="Post to channel"
                  >
                    {channelOptions}
                  </select>
                  <textarea
                    className={`${inputCls} resize-y`}
                    rows={2}
                    placeholder="Message to post"
                    value={a.text}
                    maxLength={4000}
                    onChange={(e) => setAction(i, { ...a, text: e.target.value })}
                  />
                </>
              )}
              {a.type === 'send_dm' && (
                <>
                  <select
                    className={`${inputCls} mb-2`}
                    value={a.to}
                    onChange={(e) => setAction(i, { ...a, to: e.target.value })}
                    aria-label="Send to"
                  >
                    {personOptions}
                  </select>
                  <textarea
                    className={`${inputCls} resize-y`}
                    rows={2}
                    placeholder="Direct message"
                    value={a.text}
                    maxLength={4000}
                    onChange={(e) => setAction(i, { ...a, text: e.target.value })}
                  />
                </>
              )}
              {a.type === 'create_task' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_110px]">
                  <input
                    className={inputCls}
                    placeholder="Task title"
                    value={a.title}
                    maxLength={300}
                    onChange={(e) => setAction(i, { ...a, title: e.target.value })}
                    aria-label="Task title"
                  />
                  <select
                    className={inputCls}
                    value={a.assignee}
                    onChange={(e) => setAction(i, { ...a, assignee: e.target.value })}
                    aria-label="Assignee"
                  >
                    {personOptions}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    className={inputCls}
                    placeholder="Due in days"
                    value={a.dueInDays ?? ''}
                    onChange={(e) => {
                      const n =
                        e.target.value === ''
                          ? undefined
                          : Math.max(0, Math.min(365, Math.trunc(Number(e.target.value))));
                      setAction(i, { ...a, dueInDays: n });
                    }}
                    aria-label="Due in days"
                  />
                </div>
              )}
              {a.type === 'call_webhook' && (
                <>
                  <input
                    className={inputCls}
                    placeholder="https://example.com/hooks/backstages"
                    value={a.url}
                    maxLength={2000}
                    onChange={(e) => setAction(i, { ...a, url: e.target.value })}
                    aria-label="Webhook URL"
                  />
                  <p className="mt-1 text-[11px] text-ink-3">
                    Sends the run’s variables as JSON, signed with this workflow’s secret
                    (X-Backstages-Signature). Must be a public https:// address.
                  </p>
                </>
              )}
              {a.type === 'request_approval' && (
                <>
                  <select
                    className={`${inputCls} mb-2`}
                    value={a.approver}
                    onChange={(e) => setAction(i, { ...a, approver: e.target.value })}
                    aria-label="Approver"
                  >
                    {personOptions}
                  </select>
                  <textarea
                    className={`${inputCls} resize-y`}
                    rows={2}
                    placeholder="What should they approve?"
                    value={a.prompt}
                    maxLength={4000}
                    onChange={(e) => setAction(i, { ...a, prompt: e.target.value })}
                    aria-label="Approval question"
                  />
                </>
              )}
              {a.type === 'ask_form' && (
                <>
                  <select
                    className={`${inputCls} mb-2`}
                    value={a.assignee}
                    onChange={(e) => setAction(i, { ...a, assignee: e.target.value })}
                    aria-label="Form recipient"
                  >
                    {personOptions}
                  </select>
                  <textarea
                    className={`${inputCls} mb-2 resize-y`}
                    rows={2}
                    placeholder="Introduce the form"
                    value={a.prompt}
                    maxLength={4000}
                    onChange={(e) => setAction(i, { ...a, prompt: e.target.value })}
                    aria-label="Form introduction"
                  />
                  <FormFieldsEditor
                    fields={a.fields}
                    onChange={(fields) => setAction(i, { ...a, fields })}
                  />
                </>
              )}
              {a.type !== 'call_webhook' && (
                <p className="mt-1.5 text-[11px] text-ink-3">
                  Can use:{' '}
                  {variablesBefore(d.trigger, d.actions, i)
                    .map((v) => `{{${v}}}`)
                    .join(' ')}
                </p>
              )}
            </li>
          ))}
        </ol>
        {d.actions.length < MAX_WORKFLOW_ACTIONS && (
          <button
            type="button"
            onClick={() => set({ actions: [...d.actions, newAction('post_message', d, channels)] })}
            className="mt-2 flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
            data-testid="workflow-add-action"
          >
            <Plus size={13} /> Add another action
          </button>
        )}
      </fieldset>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hovered"
        >
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="save-workflow"
        >
          {busy ? 'Saving…' : workflowId ? 'Save changes' : 'Create workflow'}
        </button>
      </div>
    </div>
  );
}

/** Edit up to five form fields: key (variable name), label, text/choice, required. */
function FormFieldsEditor({
  fields,
  onChange,
}: {
  fields: WorkflowFormField[];
  onChange: (fields: WorkflowFormField[]) => void;
}) {
  const update = (i: number, patch: Partial<WorkflowFormField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-1.5" data-testid="form-fields">
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_110px_auto_auto] items-center gap-1.5">
          <input
            className={inputCls}
            placeholder="Label"
            value={f.label}
            maxLength={80}
            onChange={(e) => update(i, { label: e.target.value })}
            aria-label={`Field ${i + 1} label`}
          />
          <input
            className={inputCls}
            placeholder="variable_name"
            value={f.key}
            maxLength={30}
            onChange={(e) =>
              update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })
            }
            aria-label={`Field ${i + 1} variable name`}
          />
          <select
            className={inputCls}
            value={f.kind}
            onChange={(e) => {
              const kind = e.target.value as WorkflowFormField['kind'];
              update(
                i,
                kind === 'select'
                  ? { kind, options: f.options?.length ? f.options : ['Yes', 'No'] }
                  : { kind, options: undefined },
              );
            }}
            aria-label={`Field ${i + 1} type`}
          >
            <option value="text">Text</option>
            <option value="select">Choice</option>
          </select>
          <label className="flex items-center gap-1 text-[11px] text-ink-3">
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            Required
          </label>
          <button
            type="button"
            onClick={() => onChange(fields.filter((_, j) => j !== i))}
            disabled={fields.length === 1}
            aria-label={`Remove field ${i + 1}`}
            className="rounded p-1 text-ink-3 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
          >
            <X size={13} />
          </button>
          {f.kind === 'select' && (
            <input
              className={`${inputCls} col-span-5`}
              placeholder="Choices, separated by commas"
              value={(f.options ?? []).join(', ')}
              onChange={(e) =>
                update(i, {
                  options: e.target.value
                    .split(',')
                    .map((o) => o.trim())
                    .filter(Boolean)
                    .slice(0, 10),
                })
              }
              aria-label={`Field ${i + 1} choices`}
            />
          )}
        </div>
      ))}
      {fields.length < 5 && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...fields,
              { key: `field_${fields.length + 1}`, label: '', kind: 'text', required: true },
            ])
          }
          className="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <Plus size={12} /> Add a field
        </button>
      )}
    </div>
  );
}

/** Recent runs of one workflow with each step's outcome (admins only). */
function RunHistory({ workflowId }: { workflowId: string }) {
  const runs = useWorkflowRuns(workflowId);
  if (runs.isLoading) return <p className="py-2 text-[12px] text-ink-3">Loading…</p>;
  if (runs.isError)
    return <p className="py-2 text-[12px] text-red-500">Could not load the history.</p>;
  if (!runs.data?.length) return <p className="py-2 text-[12px] text-ink-3">No runs yet.</p>;
  return (
    <ol className="mt-2 space-y-2 border-t border-line pt-2" data-testid="workflow-runs">
      {runs.data.map((r) => (
        <li key={r.id} className="text-[12px]">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${RUN_STATUS_STYLE[r.status]}`}
            >
              {r.status}
            </span>
            <span className="text-ink-2">
              {formatDistanceToNow(new Date(r.startedAt), { addSuffix: true })}
              {r.triggerUser && ` · by ${r.triggerUser.displayName}`}
            </span>
          </div>
          <ul className="mt-1 space-y-0.5 pl-1">
            {r.steps.map((s, k) => (
              <li key={k} className={s.ok ? 'text-ink-3' : 'text-red-500'}>
                {s.ok ? '✓' : '✗'} {s.index + 1}. {s.detail}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** The webhook signing secret, hidden until asked for (admins only receive it). */
function SigningSecret({ secret }: { secret: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
      <span>Signing secret:</span>
      <code className="rounded bg-hovered px-1.5 py-0.5 font-mono text-ink-2">
        {shown ? secret : '•'.repeat(16)}
      </code>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="text-accent hover:underline"
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
