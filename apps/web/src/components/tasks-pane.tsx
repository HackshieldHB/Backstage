'use client';

import { useMemo, useRef, useState } from 'react';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import {
  CalendarDays,
  CheckSquare,
  Circle,
  CircleCheck,
  MessageSquareText,
  Plus,
  Trash2,
  Video,
} from 'lucide-react';
import clsx from 'clsx';
import type { TaskDto } from '@backstages/shared';
import {
  useCreateTask,
  useDeleteTask,
  useMembers,
  useTasks,
  useUpdateTask,
  type Container,
} from '@/hooks/queries';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { PaneShell } from './pane-shell';
import { Avatar } from './avatar';

const input =
  'rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';

type Tab = 'mine' | 'delegated' | 'done';

/** A date-only pick means "due by end of the working day" (17:00 local). */
export function dueFromDateInput(value: string): string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 17, 0, 0, 0).toISOString();
}

function toDateInput(iso: string | null): string {
  return iso ? format(new Date(iso), 'yyyy-MM-dd') : '';
}

export function dueLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy');
}

/** Bucket open tasks for the "Assigned to me" view. */
export function bucketOf(
  task: TaskDto,
  now = new Date(),
): 'overdue' | 'today' | 'upcoming' | 'someday' {
  if (!task.dueAt) return 'someday';
  const d = new Date(task.dueAt);
  if (d.getTime() < now.getTime()) return 'overdue';
  if (isToday(d)) return 'today';
  return 'upcoming';
}

const BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'someday', label: 'No due date' },
] as const;

export function TasksPane({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate: (c: Container, highlight?: string) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const tasks = useTasks(workspaceId);
  const [tab, setTab] = useState<Tab>('mine');

  const { mine, delegated, done } = useMemo(() => {
    const all = tasks.data ?? [];
    return {
      // Unassigned tasks you created stay on your own list.
      mine: all.filter(
        (t) =>
          t.status === 'OPEN' &&
          (t.assignee ? t.assignee.id === me?.id : t.createdBy.id === me?.id),
      ),
      delegated: all.filter(
        (t) =>
          t.status === 'OPEN' &&
          t.createdBy.id === me?.id &&
          !!t.assignee &&
          t.assignee.id !== me?.id,
      ),
      done: all.filter((t) => t.status === 'DONE'),
    };
  }, [tasks.data, me?.id]);

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'mine', label: 'Assigned to me', count: mine.length },
    { id: 'delegated', label: 'Assigned by me', count: delegated.length },
    { id: 'done', label: 'Done', count: done.length },
  ];
  const shown = tab === 'mine' ? mine : tab === 'delegated' ? delegated : done;

  return (
    <PaneShell
      icon={<CheckSquare size={18} className="text-accent" />}
      title="Tasks"
      subtitle="Your to-dos and the work you've handed off"
    >
      <div className="mx-auto max-w-3xl space-y-4" data-testid="tasks-pane">
        <QuickAdd workspaceId={workspaceId} />

        <div className="flex gap-1 border-b border-line" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              data-testid={`tasks-tab-${t.id}`}
              className={clsx(
                '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium',
                tab === t.id
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink',
              )}
            >
              {t.label}
              <span className="ml-1.5 rounded-full bg-hovered px-1.5 text-[11px] text-ink-2">
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {tasks.isLoading && <p className="py-6 text-center text-sm text-ink-3">Loading…</p>}
        {tasks.isError && (
          <p className="py-6 text-center text-sm text-red-500">Could not load tasks.</p>
        )}

        {tasks.isSuccess && shown.length === 0 && (
          <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-ink-3">
            {tab === 'mine'
              ? 'Nothing on your plate. Add a task above, or turn a message into one from its menu.'
              : tab === 'delegated'
                ? 'You haven’t assigned anything to anyone.'
                : 'No completed tasks yet.'}
          </p>
        )}

        {tab === 'mine'
          ? BUCKETS.map((b) => {
              const items = shown.filter((t) => bucketOf(t) === b.id);
              if (items.length === 0) return null;
              return (
                <section key={b.id}>
                  <h2
                    className={clsx(
                      'mb-1.5 text-[11px] font-semibold uppercase tracking-wide',
                      b.id === 'overdue' ? 'text-red-500' : 'text-ink-3',
                    )}
                  >
                    {b.label} · {items.length}
                  </h2>
                  <TaskList tasks={items} workspaceId={workspaceId} onNavigate={onNavigate} />
                </section>
              );
            })
          : shown.length > 0 && (
              <TaskList tasks={shown} workspaceId={workspaceId} onNavigate={onNavigate} />
            )}
      </div>
    </PaneShell>
  );
}

function QuickAdd({ workspaceId }: { workspaceId: string }) {
  const me = useAuthStore((s) => s.user);
  const members = useMembers(workspaceId);
  const create = useCreateTask(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const submit = () => {
    const t = title.trim();
    if (!t || create.isPending) return;
    create.mutate(
      { title: t, notes: '', dueAt: dueFromDateInput(due), ...(assigneeId ? { assigneeId } : {}) },
      {
        onSuccess: () => {
          setTitle('');
          setDue('');
          setAssigneeId('');
        },
        onError: () => pushToast('Could not add the task.', 'error'),
      },
    );
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-elevated p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className={clsx(input, 'min-w-[200px] flex-1')}
        placeholder="Add a task…"
        value={title}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Task title"
        data-testid="task-title-input"
      />
      <input
        type="date"
        className={input}
        value={due}
        onChange={(e) => setDue(e.target.value)}
        aria-label="Due date"
        title="Due by 5pm on this day"
      />
      <select
        className={input}
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
        aria-label="Assignee"
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
      <button
        type="submit"
        disabled={!title.trim() || create.isPending}
        className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        data-testid="task-add"
      >
        <Plus size={14} /> Add
      </button>
    </form>
  );
}

function TaskList({
  tasks,
  workspaceId,
  onNavigate,
}: {
  tasks: TaskDto[];
  workspaceId: string;
  onNavigate: (c: Container, highlight?: string) => void;
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-elevated">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} workspaceId={workspaceId} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  workspaceId,
  onNavigate,
}: {
  task: TaskDto;
  workspaceId: string;
  onNavigate: (c: Container, highlight?: string) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const members = useMembers(workspaceId);
  const update = useUpdateTask(workspaceId);
  const del = useDeleteTask(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const dateRef = useRef<HTMLInputElement>(null);

  const done = task.status === 'DONE';
  const overdue = !done && !!task.dueAt && isPast(new Date(task.dueAt));
  const isCreator = task.createdBy.id === me?.id;
  const onError = () => pushToast('Could not update the task.', 'error');

  const saveTitle = () => {
    setEditing(false);
    const t = draft.trim();
    if (!t || t === task.title) {
      setDraft(task.title);
      return;
    }
    update.mutate({ id: task.id, title: t }, { onError });
  };

  const source: Container | null = task.channelId
    ? { kind: 'channel', id: task.channelId }
    : task.conversationId
      ? { kind: 'conversation', id: task.conversationId }
      : null;

  return (
    <li className="group flex items-start gap-3 px-3 py-2.5" data-testid={`task-${task.id}`}>
      <button
        onClick={() => update.mutate({ id: task.id, status: done ? 'OPEN' : 'DONE' }, { onError })}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={clsx(
          'mt-0.5 shrink-0',
          done ? 'text-green-500' : 'text-ink-3 hover:text-accent',
        )}
        data-testid={`task-toggle-${task.id}`}
      >
        {done ? <CircleCheck size={18} /> : <Circle size={18} />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            className={clsx(input, 'w-full')}
            value={draft}
            maxLength={300}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') {
                setDraft(task.title);
                setEditing(false);
              }
            }}
            aria-label="Edit task title"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(task.title);
              setEditing(true);
            }}
            className={clsx(
              'block w-full text-left text-[14px]',
              done ? 'text-ink-3 line-through' : 'text-ink',
            )}
            title="Click to edit"
          >
            {task.title}
          </button>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
          <span
            className={clsx(
              'relative flex items-center gap-1',
              overdue && 'font-medium text-red-500',
            )}
          >
            <button
              onClick={() => {
                const el = dateRef.current;
                if (!el) return;
                try {
                  el.showPicker();
                } catch {
                  el.focus(); // older browsers: focusing the input opens its picker
                }
              }}
              className="flex items-center gap-1 hover:text-accent"
              title="Change due date"
            >
              <CalendarDays size={12} />
              {task.dueAt ? dueLabel(task.dueAt) : 'Set due date'}
            </button>
            <input
              ref={dateRef}
              type="date"
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 h-0 w-0 opacity-0"
              value={toDateInput(task.dueAt)}
              onChange={(e) =>
                update.mutate(
                  { id: task.id, dueAt: dueFromDateInput(e.target.value) ?? null },
                  { onError },
                )
              }
            />
            {task.dueAt && (
              <button
                onClick={() => update.mutate({ id: task.id, dueAt: null }, { onError })}
                className="text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100"
                aria-label="Clear due date"
                title="Clear due date"
              >
                ×
              </button>
            )}
          </span>

          <span className="flex items-center gap-1">
            {task.assignee ? <Avatar user={task.assignee} size="xs" /> : null}
            <select
              className="max-w-[160px] bg-transparent text-[12px] text-ink-3 outline-none hover:text-ink"
              value={task.assignee?.id ?? ''}
              onChange={(e) =>
                update.mutate({ id: task.id, assigneeId: e.target.value || null }, { onError })
              }
              aria-label="Assignee"
            >
              <option value="">Unassigned</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.id === me?.id ? 'Me' : m.user.displayName}
                </option>
              ))}
            </select>
          </span>

          {!isCreator && <span>from {task.createdBy.displayName}</span>}

          {source && (
            <button
              onClick={() => onNavigate(source, task.messageId ?? undefined)}
              className="flex items-center gap-1 hover:text-accent"
              title={
                task.meetingRecordId
                  ? 'Open the conversation this meeting was in'
                  : 'Open the source message'
              }
            >
              {task.meetingRecordId ? <Video size={12} /> : <MessageSquareText size={12} />}
              {task.meetingRecordId ? 'From a meeting' : 'From a message'}
            </button>
          )}
        </div>
      </div>

      {isCreator && (
        <button
          onClick={() =>
            del.mutate(task.id, { onError: () => pushToast('Could not delete the task.', 'error') })
          }
          aria-label="Delete task"
          className="shrink-0 rounded p-1 text-ink-3 opacity-0 hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
