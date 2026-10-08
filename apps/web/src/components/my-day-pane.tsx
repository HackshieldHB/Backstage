'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import clsx from 'clsx';
import {
  CalendarDays,
  CheckSquare,
  Circle,
  ClipboardList,
  ExternalLink,
  Palmtree,
  Sparkles,
  SquareKanban,
  Sun,
  Video,
} from 'lucide-react';
import type { MyDayDto, MyDayItemDto } from '@backstages/shared';
import {
  useAiStatus,
  useMyDay,
  usePlanMyDay,
  useUpdateTask,
  type Container,
} from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { PaneShell } from './pane-shell';

const time = (iso: string) => format(new Date(iso), 'HH:mm');

/**
 * "My day": today's meetings beside the work to do, in a suggested order —
 * requests people are waiting on, overdue and due-today items, Jira issues,
 * then the rest. Optionally asks the AI for an order around the meetings.
 */
export function MyDayPane({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate: (c: Container, highlight?: string) => void;
}) {
  const day = useMyDay(workspaceId);
  const ai = useAiStatus();
  const plan = usePlanMyDay(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [aiOrder, setAiOrder] = useState<MyDayItemDto[] | null>(null);

  const d = day.data;
  // An AI order is only valid for the items it was made from.
  const sameItems =
    aiOrder &&
    d &&
    aiOrder.length === d.focus.length &&
    aiOrder.every((i) => d.focus.some((f) => f.id === i.id));
  const focus = sameItems ? aiOrder! : (d?.focus ?? []);

  const suggest = () =>
    plan.mutate(undefined, {
      onSuccess: (p) => {
        if (p.aiUsed) setAiOrder(p.focus);
        else
          pushToast('AI planning is unavailable right now — showing the standard order.', 'info');
      },
      onError: () => pushToast('Could not plan the day.', 'error'),
    });

  return (
    <PaneShell
      icon={<Sun size={18} className="text-accent" />}
      title="My day"
      subtitle={d ? format(new Date(`${d.date}T12:00:00`), 'EEEE, MMMM d') : 'Today'}
      actions={
        ai.data?.enabled ? (
          sameItems ? (
            <button
              onClick={() => setAiOrder(null)}
              className="rounded-lg border border-line-strong px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-hovered"
            >
              Standard order
            </button>
          ) : (
            <button
              onClick={suggest}
              disabled={plan.isPending || !d || d.focus.length < 2}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              data-testid="plan-my-day"
            >
              <Sparkles size={14} /> {plan.isPending ? 'Planning…' : 'Suggest an order'}
            </button>
          )
        ) : null
      }
    >
      {day.isLoading && <p className="py-10 text-center text-sm text-ink-3">Gathering your day…</p>}
      {day.isError && (
        <p className="py-10 text-center text-sm text-red-500">Could not load your day.</p>
      )}
      {d && (
        <div className="mx-auto max-w-5xl space-y-4" data-testid="my-day">
          {d.outOfOffice && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[13px] text-ink">
              <Palmtree size={16} className="text-amber-500" />
              You’re out of office until {format(new Date(d.outOfOffice.until), 'EEE, MMM d HH:mm')}
              .
              {d.outOfOffice.message && (
                <span className="text-ink-3">“{d.outOfOffice.message}”</span>
              )}
            </div>
          )}

          <Counts d={d} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section>
              <h2 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Focus{' '}
                {sameItems && (
                  <span className="rounded bg-accent/15 px-1.5 text-accent normal-case">
                    AI-suggested order
                  </span>
                )}
              </h2>
              {focus.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-ink-3">
                  Nothing waiting on you today. 🎉
                </p>
              ) : (
                <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-elevated">
                  {focus.map((item, i) => (
                    <FocusRow key={item.id} index={i} item={item} workspaceId={workspaceId} />
                  ))}
                </ol>
              )}
            </section>

            <aside className="space-y-4">
              <section>
                <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Schedule
                </h2>
                {d.meetings.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-3">
                    No meetings today.
                  </p>
                ) : (
                  <ul className="space-y-1.5" data-testid="my-day-meetings">
                    {d.meetings.map((m) => {
                      const container: Container | null = m.channelId
                        ? { kind: 'channel', id: m.channelId }
                        : m.conversationId
                          ? { kind: 'conversation', id: m.conversationId }
                          : null;
                      return (
                        <li
                          key={m.id}
                          className="flex items-start gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-[13px]"
                        >
                          <span className="w-12 shrink-0 font-mono text-[12px] text-ink-2">
                            {time(m.start)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ink">{m.title}</span>
                            <span className="text-[11px] text-ink-3">
                              {m.end ? `until ${time(m.end)} · ` : ''}
                              {m.source === 'calendar' ? 'Calendar' : 'Huddle'}
                            </span>
                          </span>
                          {container && (
                            <button
                              onClick={() => onNavigate(container)}
                              className="text-ink-3 hover:text-accent"
                              aria-label={`Open ${m.title}`}
                              title="Open the conversation"
                            >
                              <Video size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <Hints d={d} />
            </aside>
          </div>
        </div>
      )}
    </PaneShell>
  );
}

function Counts({ d }: { d: MyDayDto }) {
  const items = [
    { label: 'Meetings', value: d.counts.meetings },
    { label: 'Overdue', value: d.counts.overdue, warn: d.counts.overdue > 0 },
    { label: 'Due today', value: d.counts.dueToday },
    { label: 'Requests', value: d.counts.requests, warn: d.counts.requests > 0 },
    { label: 'Jira', value: d.counts.jira },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((s) => (
        <div key={s.label} className="rounded-xl border border-line bg-elevated px-3 py-2">
          <div
            className={clsx('text-[20px] font-semibold', s.warn ? 'text-amber-500' : 'text-ink')}
          >
            {s.value}
          </div>
          <div className="text-[11px] text-ink-3">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Hints({ d }: { d: MyDayDto }) {
  const hints: string[] = [];
  if (d.jira.state === 'not_linked')
    hints.push(
      'Connect your Atlassian account (Workspace menu) to see Jira issues assigned to you.',
    );
  if (d.jira.state === 'error')
    hints.push('Jira didn’t answer — your issues aren’t shown right now.');
  if (d.calendar.state === 'none')
    hints.push('Link your calendar (Availability & focus hours) to see your meetings here.');
  if (d.calendar.state === 'error')
    hints.push('Your calendar feed couldn’t be read — check its link.');
  if (hints.length === 0) return null;
  return (
    <ul className="space-y-1 text-[12px] text-ink-3">
      {hints.map((h) => (
        <li key={h} className="flex gap-1.5">
          <CalendarDays size={12} className="mt-0.5 shrink-0" /> {h}
        </li>
      ))}
    </ul>
  );
}

function FocusRow({
  item,
  index,
  workspaceId,
}: {
  item: MyDayItemDto;
  index: number;
  workspaceId: string;
}) {
  const update = useUpdateTask(workspaceId);
  const setMainView = useUiStore((s) => s.setMainView);
  const pushToast = useUiStore((s) => s.pushToast);
  const Icon =
    item.kind === 'jira' ? SquareKanban : item.kind === 'request' ? ClipboardList : CheckSquare;
  const taskId = item.kind === 'task' ? item.id.slice('task:'.length) : null;

  return (
    <li className="flex items-start gap-3 px-3 py-2.5" data-testid={`focus-${item.id}`}>
      <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[12px] text-ink-3">
        {index + 1}
      </span>
      {taskId ? (
        <button
          onClick={() =>
            update.mutate(
              { id: taskId, status: 'DONE' },
              { onError: () => pushToast('Could not complete the task.', 'error') },
            )
          }
          aria-label={`Mark “${item.title}” as done`}
          className="mt-0.5 shrink-0 text-ink-3 hover:text-accent"
        >
          <Circle size={16} />
        </button>
      ) : (
        <Icon
          size={16}
          className={clsx(
            'mt-0.5 shrink-0',
            item.kind === 'jira' ? 'text-[#2684FF]' : 'text-accent',
          )}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-ink">{item.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
          <span
            className={clsx(
              'rounded px-1.5',
              item.overdue ? 'bg-red-500/15 text-red-500' : 'bg-hovered text-ink-2',
            )}
          >
            {item.reason}
          </span>
          {item.detail && <span>{item.detail}</span>}
        </div>
      </div>
      {item.kind === 'request' && (
        <button
          onClick={() => setMainView('tasks')}
          className="shrink-0 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-hovered"
        >
          Respond
        </button>
      )}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-ink-3 hover:text-accent"
          aria-label={`Open ${item.title} in Jira`}
        >
          <ExternalLink size={14} />
        </a>
      )}
    </li>
  );
}
