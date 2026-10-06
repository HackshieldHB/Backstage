'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useCreateTask, useMembers, useRemindAboutMessage } from '@/hooks/queries';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';
import { dueFromDateInput } from './tasks-pane';

const input =
  'w-full rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';
const primary =
  'rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50';

/** A message's text, flattened and trimmed to a usable task title. */
export function titleFromMessage(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

/** Quick "remind me" choices relative to `now` (all strictly in the future). */
export function reminderPresets(now = new Date()): Array<{ label: string; at: Date }> {
  const at = (h: number, daysAhead: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: 'In 20 minutes', at: new Date(now.getTime() + 20 * 60_000) },
    { label: 'In 1 hour', at: new Date(now.getTime() + 60 * 60_000) },
    { label: 'In 3 hours', at: new Date(now.getTime() + 3 * 60 * 60_000) },
    { label: 'Tomorrow at 9:00', at: at(9, 1) },
    { label: 'Next Monday at 9:00', at: at(9, daysToMonday) },
  ];
}

export function CreateTaskFromMessageDialog({
  workspaceId,
  messageId,
  messageText,
  onClose,
}: {
  workspaceId: string;
  messageId: string;
  messageText: string;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const members = useMembers(workspaceId);
  const create = useCreateTask(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [title, setTitle] = useState(
    () => titleFromMessage(messageText) || 'Follow up on this message',
  );
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    create.mutate(
      {
        title: t,
        notes: '',
        messageId,
        dueAt: dueFromDateInput(due),
        ...(assigneeId ? { assigneeId } : {}),
      },
      {
        onSuccess: () => {
          pushToast('Task created — find it under Tasks.', 'success');
          onClose();
        },
        onError: (err) =>
          pushToast(err instanceof Error ? err.message : 'Could not create the task.', 'error'),
      },
    );
  };

  return (
    <Dialog title="Create a task" onClose={onClose}>
      <form
        className="w-full space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block text-[12px] font-medium text-ink-2">
          Task
          <input
            className={`${input} mt-1`}
            value={title}
            maxLength={300}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            data-testid="message-task-title"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[12px] font-medium text-ink-2">
            Due
            <input
              type="date"
              className={`${input} mt-1`}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label className="block text-[12px] font-medium text-ink-2">
            Assignee
            <select
              className={`${input} mt-1`}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Me</option>
              {(members.data ?? [])
                .filter((m) => m.user.id !== me?.id)
                .map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.displayName}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <p className="text-[12px] text-ink-3">
          The task links back to this message. Only you and the assignee can see it.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-ink-2 hover:bg-hovered"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || create.isPending}
            className={primary}
            data-testid="message-task-submit"
          >
            Create task
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function RemindMeDialog({
  workspaceId,
  messageId,
  onClose,
}: {
  workspaceId: string;
  messageId: string;
  onClose: () => void;
}) {
  const remind = useRemindAboutMessage(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [presets] = useState(() => reminderPresets());
  const [custom, setCustom] = useState('');

  const schedule = (at: Date) => {
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      pushToast('Pick a time in the future.', 'error');
      return;
    }
    remind.mutate(
      { messageId, remindAt: at.toISOString() },
      {
        onSuccess: () => {
          pushToast(`Reminder set for ${format(at, 'EEE, MMM d · HH:mm')}.`, 'success');
          onClose();
        },
        onError: (err) =>
          pushToast(err instanceof Error ? err.message : 'Could not set the reminder.', 'error'),
      },
    );
  };

  return (
    <Dialog title="Remind me about this message" onClose={onClose}>
      <div className="w-full space-y-1">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => schedule(p.at)}
            disabled={remind.isPending}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-hovered disabled:opacity-50"
          >
            {p.label}
            <span className="text-[12px] text-ink-3">{format(p.at, 'EEE HH:mm')}</span>
          </button>
        ))}
        <form
          className="flex items-center gap-2 border-t border-line px-1 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom) schedule(new Date(custom));
          }}
        >
          <input
            type="datetime-local"
            className={input}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="Custom reminder time"
          />
          <button type="submit" disabled={!custom || remind.isPending} className={primary}>
            Set
          </button>
        </form>
      </div>
    </Dialog>
  );
}
