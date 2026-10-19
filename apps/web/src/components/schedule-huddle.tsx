'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarClock, Hash, Headphones, Repeat, Users, X } from 'lucide-react';
import {
  DEFAULT_MEETING_REMINDER_MINS,
  MAX_CONVERSATION_MEMBERS,
  MEETING_REMINDER_OPTIONS,
  type ConversationDto,
  type MeetingRecurrence,
  type ScheduledHuddleDto,
} from '@backstages/shared';
import type { Container } from '@/hooks/queries';
import {
  useCancelScheduledHuddle,
  useChannels,
  useMembers,
  usePeopleCalendars,
  useScheduleHuddle,
  useScheduledHuddles,
  useUpdateMeeting,
} from '@/hooks/queries';
import type { HuddleController } from '@/hooks/use-huddle';
import { api } from '@/lib/api';
import { track } from '@/lib/usage';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

const pad = (n: number) => String(n).padStart(2, '0');

/** A Date as the value of a datetime-local input (local time, no zone suffix). */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The next round half-hour from now. */
export function nextHalfHour(): Date {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  d.setMinutes(d.getMinutes() >= 30 ? 60 : 30, 0, 0);
  return d;
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
  if (diffMin <= 0 && diffMin > -60) return 'starting now';
  if (diffMin > 0 && diffMin < 60) return `in ${diffMin} min`;
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export function reminderLabel(mins: number): string {
  if (mins === 0) return 'No early reminder';
  if (mins === 60) return '1 hour before';
  return `${mins} min before`;
}

export const RECURRENCE_LABELS: Record<MeetingRecurrence, string> = {
  NONE: 'Does not repeat',
  DAILY: 'Every day',
  WEEKDAYS: 'Every weekday (Mon–Fri)',
  WEEKLY: 'Every week',
};

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

const inputCls =
  'rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent';

/**
 * Create or edit a meeting. From a channel/DM header the place is fixed
 * (`container`); from the calendar the organiser picks a channel or a few people
 * (which opens — or reuses — a group DM with them, where the huddle will run).
 */
export function ScheduleHuddleDialog({
  container,
  workspaceId,
  initialStart,
  meeting,
  onClose,
}: {
  container?: Container | null;
  workspaceId?: string;
  initialStart?: Date;
  /** Edit this meeting instead of creating one. */
  meeting?: ScheduledHuddleDto;
  onClose: () => void;
}) {
  const editing = !!meeting;
  const schedule = useScheduleHuddle(container ?? null);
  const update = useUpdateMeeting();
  const pushToast = useUiStore((s) => s.pushToast);
  const me = useAuthStore((s) => s.user);

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [when, setWhen] = useState(() =>
    toLocalInput(meeting ? new Date(meeting.scheduledFor) : (initialStart ?? nextHalfHour())),
  );
  const [duration, setDuration] = useState(meeting?.durationMins ?? 30);
  const [reminder, setReminder] = useState<number>(meeting?.reminderMins ?? DEFAULT_MEETING_REMINDER_MINS);
  const [recurrence, setRecurrence] = useState<MeetingRecurrence>(meeting?.recurrence ?? 'NONE');

  // Where (calendar only).
  const pickPlace = !editing && !container;
  const [placeKind, setPlaceKind] = useState<'people' | 'channel'>('people');
  const channels = useChannels(pickPlace ? (workspaceId ?? '') : '');
  const members = useMembers(pickPlace ? (workspaceId ?? '') : '');
  const myChannels = useMemo(
    // Channels shared in from a partner workspace can't host scheduled meetings.
    () => (channels.data ?? []).filter((c) => !c.sharedFrom).sort((a, b) => a.name.localeCompare(b.name)),
    [channels.data],
  );
  const [channelId, setChannelId] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const others = useMemo(
    () =>
      (members.data ?? [])
        .filter((m) => !m.deactivatedAt && m.user.id !== me?.id)
        .map((m) => m.user)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [members.data, me?.id],
  );
  const matches = others.filter(
    (u) => !people.includes(u.id) && u.displayName.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const maxPeople = MAX_CONVERSATION_MEMBERS - 1;

  // Conflict hints from the picked people's shared calendars (that day).
  const startAt = new Date(when);
  const validStart = !Number.isNaN(startAt.getTime());
  const dayStart = validStart ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate()) : new Date(0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const checkPeople = pickPlace && placeKind === 'people' && validStart ? people : [];
  const peopleCals = usePeopleCalendars(workspaceId ?? '', checkPeople, dayStart, dayEnd);
  const conflicts = useMemo(() => {
    if (!checkPeople.length || !peopleCals.data) return [];
    const s0 = startAt.getTime();
    const e0 = s0 + duration * 60_000;
    return checkPeople.map((id) => {
      const name = others.find((o) => o.id === id)?.displayName ?? 'Someone';
      const cal = peopleCals.data!.find((c) => c.userId === id);
      if (!cal || cal.visibility === 'PRIVATE') return { id, name, state: 'unknown' as const, busy: [] as string[] };
      const busy = cal.events
        .filter((e) => new Date(e.start).getTime() < e0 && new Date(e.end).getTime() > s0)
        .map((e) => `${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(e.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${e.title ? ` (${e.title})` : ''}`);
      return { id, name, state: busy.length ? ('busy' as const) : ('free' as const), busy };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleCals.data, when, duration, checkPeople.join(','), others]);

  const resolveTarget = async (): Promise<Container | null> => {
    if (!pickPlace) return container ?? null;
    if (placeKind === 'channel') return channelId ? { kind: 'channel', id: channelId } : null;
    if (!people.length || !workspaceId) return null;
    const dm = await api<ConversationDto>('POST', `/workspaces/${workspaceId}/conversations`, { memberIds: people });
    return { kind: 'conversation', id: dm.id };
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    const at = new Date(when);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      pushToast('Pick a time in the future.', 'error');
      return;
    }
    const fields = {
      title: t,
      description: description.trim(),
      scheduledFor: at.toISOString(),
      durationMins: duration,
      reminderMins: reminder,
      recurrence,
      timeZone: browserTimeZone(),
    };
    setBusy(true);
    try {
      if (editing) {
        await update.mutateAsync({ id: meeting!.sourceId, ...fields });
        track('meeting:edit');
        pushToast('Meeting updated — guests were notified.', 'success');
      } else {
        const target = await resolveTarget();
        if (!target) {
          pushToast(placeKind === 'channel' ? 'Pick a channel.' : 'Add at least one person.', 'error');
          return;
        }
        await schedule.mutateAsync({ ...fields, description: fields.description || undefined, target });
        track(pickPlace ? 'meeting:schedule:calendar' : 'meeting:schedule:chat');
        pushToast(
          reminder > 0
            ? `Meeting scheduled — guests are invited and reminded ${reminderLabel(reminder)}.`
            : 'Meeting scheduled — guests are invited and reminded when it starts.',
          'success',
        );
      }
      onClose();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not save the meeting.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !!title.trim() &&
    !busy &&
    (!pickPlace || (placeKind === 'channel' ? !!channelId : people.length > 0));

  return (
    <Dialog title={editing ? 'Edit meeting' : 'Schedule a meeting'} onClose={onClose}>
      <div className="flex flex-col gap-3" data-testid="schedule-meeting-dialog">
        <label className="flex flex-col gap-1 text-[13px] text-ink-2">
          Title
          <input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sprint planning"
            maxLength={200}
            className={inputCls}
            data-testid="meeting-title"
          />
        </label>

        {pickPlace && (
          <div className="flex flex-col gap-1.5 text-[13px] text-ink-2">
            <span>Who</span>
            <div className="flex gap-1 rounded-lg bg-hovered p-0.5" role="tablist">
              {(
                [
                  ['people', 'People', Users],
                  ['channel', 'Channel', Hash],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={placeKind === k}
                  onClick={() => setPlaceKind(k)}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-medium',
                    placeKind === k ? 'bg-elevated text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
                  )}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            {placeKind === 'channel' ? (
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className={inputCls}
                data-testid="meeting-channel"
              >
                <option value="">Choose a channel…</option>
                {myChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-col gap-1.5">
                {people.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {people.map((id) => {
                      const u = others.find((o) => o.id === id);
                      return (
                        <span
                          key={id}
                          className="flex items-center gap-1 rounded-full bg-accent/10 py-0.5 pl-2 pr-1 text-[12px] text-ink"
                        >
                          {u?.displayName ?? 'Member'}
                          <button
                            onClick={() => setPeople((p) => p.filter((x) => x !== id))}
                            aria-label={`Remove ${u?.displayName ?? 'member'}`}
                            className="rounded-full p-0.5 hover:bg-accent/20"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {people.length < maxPeople ? (
                  <>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Add people…"
                      className={inputCls}
                      data-testid="meeting-people-search"
                    />
                    {query.trim() && (
                      <div className="thin-scrollbar max-h-36 overflow-y-auto rounded-lg border border-line">
                        {matches.slice(0, 20).map((u) => (
                          <button
                            key={u.id}
                            onClick={() => {
                              setPeople((p) => [...p, u.id]);
                              setQuery('');
                            }}
                            className="block w-full px-3 py-1.5 text-left text-[13px] text-ink hover:bg-hovered"
                          >
                            {u.displayName}
                          </button>
                        ))}
                        {matches.length === 0 && <p className="px-3 py-1.5 text-[12px] text-ink-3">No one found</p>}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] text-ink-3">
                    Up to {maxPeople} people — for a bigger meeting, schedule it in a channel.
                  </p>
                )}
                <p className="text-[11.5px] text-ink-3">The huddle runs in a group DM with these people.</p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            Starts
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputCls}
              data-testid="meeting-when"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            Length
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputCls}>
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>

        {conflicts.length > 0 && (
          <ul className="flex flex-col gap-0.5 rounded-lg bg-hovered px-3 py-2 text-[12px]" data-testid="meeting-conflicts">
            {conflicts.map((c) => (
              <li
                key={c.id}
                className={clsx(
                  c.state === 'busy' && 'text-amber-700 dark:text-amber-300',
                  c.state === 'free' && 'text-emerald-700 dark:text-emerald-300',
                  c.state === 'unknown' && 'text-ink-3',
                )}
              >
                {c.state === 'busy' && `⚠ ${c.name} is busy ${c.busy.join(', ')}`}
                {c.state === 'free' && `✓ ${c.name} looks free`}
                {c.state === 'unknown' && `${c.name} hasn't shared their calendar`}
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            <span className="flex items-center gap-1">
              <CalendarClock size={13} /> Remind guests
            </span>
            <select
              value={reminder}
              onChange={(e) => setReminder(Number(e.target.value))}
              className={inputCls}
              data-testid="meeting-reminder"
            >
              {MEETING_REMINDER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {reminderLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            <span className="flex items-center gap-1">
              <Repeat size={13} /> Repeat
            </span>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as MeetingRecurrence)}
              className={inputCls}
              data-testid="meeting-recurrence"
            >
              {(Object.keys(RECURRENCE_LABELS) as MeetingRecurrence[]).map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-[13px] text-ink-2">
          Agenda <span className="text-[11.5px] text-ink-3">(optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What will you cover?"
            className={clsx(inputCls, 'resize-y')}
          />
        </label>

        <p className="text-[11.5px] text-ink-3">
          Everyone in the {pickPlace ? (placeKind === 'channel' ? 'channel' : 'group DM') : 'conversation'} is invited
          and gets a reminder{reminder > 0 ? ` ${reminderLabel(reminder)} and` : ''} when it starts.
        </p>

        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 hover:bg-hovered">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            data-testid="meeting-submit"
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Schedule'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** A compact banner listing upcoming (and just-started) meetings for a container. */
export function UpcomingHuddles({ container, huddle }: { container: Container; huddle: HuddleController }) {
  const myId = useAuthStore((s) => s.user?.id);
  const upcoming = useScheduledHuddles(container);
  const cancel = useCancelScheduledHuddle(container);
  const openDetail = useUiStore((s) => s.setMeetingDetailId);
  // Only what's coming up in the next 24h (or just started) — the calendar has the rest.
  const horizon = Date.now() + 24 * 60 * 60 * 1000;
  const rows = (upcoming.data ?? []).filter((h) => new Date(h.scheduledFor).getTime() < horizon);
  if (rows.length === 0) return null;

  return (
    <div className="border-b border-line bg-amber-50 px-4 py-1.5 dark:bg-amber-950/30" data-testid="upcoming-huddles">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-1">
        {rows.map((h) => (
          <div key={h.id} className="flex items-center gap-2 text-[12.5px] text-amber-800 dark:text-amber-200">
            <CalendarClock size={14} className="shrink-0" />
            <button
              onClick={() => openDetail(h.id)}
              className="min-w-0 flex-1 truncate text-left hover:underline"
              title="Meeting details"
            >
              <strong className="font-semibold">{h.title}</strong>
              <span className="text-amber-700/70 dark:text-amber-200/60">
                {' '}
                · {whenLabel(h.scheduledFor)} · {h.createdByName}
                {h.recurrence !== 'NONE' && ' · repeats'}
              </span>
            </button>
            <button
              onClick={() => void huddle.join(container)}
              className="flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[11.5px] font-semibold text-white hover:bg-amber-600"
              data-testid="join-scheduled-huddle"
            >
              <Headphones size={12} /> Join
            </button>
            {h.createdById === myId && (
              <button
                onClick={() => cancel.mutate({ id: h.id, scope: h.recurrence !== 'NONE' ? 'occurrence' : 'series' })}
                title={h.recurrence !== 'NONE' ? 'Skip this occurrence' : 'Cancel this meeting'}
                aria-label="Cancel scheduled huddle"
                className="rounded p-0.5 text-amber-700/70 hover:bg-amber-500/20 dark:text-amber-200/60"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
