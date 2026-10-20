'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { addDays, format, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import { BellRing, CalendarDays, ChevronLeft, ChevronRight, Eye, Plus, Repeat, Users, X } from 'lucide-react';
import type {
  CalendarVisibility,
  ScheduledHuddleDto,
  SharedCalendarEventDto,
  SharedCalendarPersonDto,
} from '@backstages/shared';
import {
  useCalendarMeetings,
  useCalendarSharing,
  useMyExternalEvents,
  usePeopleCalendars,
  useSetCalendarSharing,
  useSharedCalendarPeople,
} from '@/hooks/queries';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { dateLocale, useT } from '@/lib/i18n';
import { PaneShell } from './pane-shell';
import { Dialog } from './dialog';
import { ScheduleHuddleDialog } from './schedule-huddle';
import { enableNotifications } from './pwa-registrar';

const HOUR_PX = 48;
const DEFAULT_MINS = 30;
const MAX_PEOPLE = 5;
/** One colour per overlaid teammate (readable on light and dark). */
const PERSON_COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#ea580c'];

export const VISIBILITY_COPY: Record<CalendarVisibility, { label: string; hint: string }> = {
  PRIVATE: { label: 'Private', hint: 'Only you can see your calendar.' },
  FREE_BUSY: { label: 'Free / busy', hint: 'Teammates see when you’re busy — no titles or details.' },
  DETAILS: {
    label: 'Full details',
    hint: 'Teammates also see titles of meetings they’re part of, and of your linked calendar. Meetings in channels or DMs they aren’t in still show only as “Busy”.',
  },
};

type Item =
  | { kind: 'mine'; key: string; s: number; e: number; m: ScheduledHuddleDto }
  | { kind: 'external'; key: string; s: number; e: number; title: string }
  | { kind: 'person'; key: string; s: number; e: number; ev: SharedCalendarEventDto; person: OverlayPerson };

interface OverlayPerson {
  userId: string;
  name: string;
  color: string;
}

interface Placed {
  item: Item;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Lay out one day's items: overlapping ones share the width in lanes. */
function layoutDay(all: Item[], day: Date): Placed[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 24 * 60 * 60_000;
  const items = all
    .map((item) => ({ item, s: Math.max(item.s, dayStart), e: Math.min(item.e, dayEnd) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const out: Placed[] = [];
  let cluster: { x: (typeof items)[number]; lane: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const { x, lane } of cluster) {
      out.push({
        item: x.item,
        top: ((x.s - dayStart) / 3_600_000) * HOUR_PX,
        // Keep very short blocks clickable.
        height: Math.max(20, ((x.e - x.s) / 3_600_000) * HOUR_PX - 2),
        lane,
        lanes,
      });
    }
    cluster = [];
  };
  for (const x of items) {
    if (x.s >= clusterEnd) flush();
    const busy = new Set(cluster.filter((c) => c.x.e > x.s).map((c) => c.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    cluster.push({ x, lane });
    clusterEnd = Math.max(clusterEnd, x.e);
  }
  flush();
  return out;
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Overlaid teammates, remembered per workspace in this browser. */
function usePickedPeople(workspaceId: string): [string[], (ids: string[]) => void] {
  const key = `bs.calendar.people.${workspaceId}`;
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setIds(raw ? (JSON.parse(raw) as string[]).slice(0, MAX_PEOPLE) : []);
    } catch {
      setIds([]);
    }
  }, [key]);
  const update = (next: string[]) => {
    setIds(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* per-browser convenience only */
    }
  };
  return [ids, update];
}

/**
 * Week (or, on phones, day) calendar of every meeting the user is invited to —
 * scheduled huddles in their channels and DMs, with repeating ones projected —
 * plus, optionally, the calendars teammates chose to share.
 */
export function CalendarPane({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const lang = useUiStore((s) => s.lang);
  const openDetail = useUiStore((s) => s.setMeetingDetailId);
  const myId = useAuthStore((s) => s.user?.id);
  const narrow = useIsNarrow();
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<'none' | 'sharing' | 'people'>('none');
  const [now, setNow] = useState(() => new Date());
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const days = useMemo(() => {
    if (narrow) return [anchor];
    const first = startOfWeek(anchor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }, [anchor, narrow]);
  const from = days[0];
  const to = addDays(days[days.length - 1], 1);
  const meetings = useCalendarMeetings(workspaceId, from, to);

  const sharing = useCalendarSharing(workspaceId);
  const shared = useSharedCalendarPeople(workspaceId);
  const [picked, setPicked] = usePickedPeople(workspaceId);
  // Only people who still share (someone may have gone private since).
  const people: OverlayPerson[] = useMemo(() => {
    const byId = new Map((shared.data ?? []).map((p) => [p.userId, p]));
    return picked
      .filter((id) => byId.has(id))
      .map((id, i) => ({ userId: id, name: byId.get(id)!.displayName, color: PERSON_COLORS[i % PERSON_COLORS.length] }));
  }, [picked, shared.data]);
  const calendars = usePeopleCalendars(
    workspaceId,
    people.map((p) => p.userId),
    from,
    to,
  );
  // My own Google Calendar / ICS events, shown greyed (toggle remembered per browser).
  const [showMine, setShowMine] = useState(true);
  useEffect(() => {
    try {
      setShowMine(window.localStorage.getItem('bs.calendar.showMine') !== '0');
    } catch {
      /* default on */
    }
  }, []);
  const toggleMine = (v: boolean) => {
    setShowMine(v);
    try {
      window.localStorage.setItem('bs.calendar.showMine', v ? '1' : '0');
    } catch {
      /* per-browser convenience only */
    }
  };
  const external = useMyExternalEvents(from, to);
  const externalSource = external.data?.source ?? 'none';
  const allDayByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!showMine) return map;
    for (const e of external.data?.events ?? []) {
      if (!e.allDay) continue;
      // All-day dates are calendar dates; walk them day by day (end is exclusive).
      for (let t = Date.parse(e.start); t < Date.parse(e.end); t += 24 * 3600_000) {
        const key = new Date(t).toISOString().slice(0, 10);
        map.set(key, [...(map.get(key) ?? []), e.title || 'Busy']);
      }
    }
    return map;
  }, [external.data, showMine]);

  // Start the grid scrolled to the working day (or just before now).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = new Date().getHours();
    el.scrollTop = (h >= 8 && h <= 20 ? h - 1 : 7) * HOUR_PX;
  }, []);

  const items: Item[] = useMemo(() => {
    const mine: Item[] = (meetings.data ?? []).map((m) => {
      const s = new Date(m.scheduledFor).getTime();
      return { kind: 'mine', key: m.id, s, e: s + (m.durationMins ?? DEFAULT_MINS) * 60_000, m };
    });
    const myMeetingIds = new Set((meetings.data ?? []).map((m) => m.sourceId));
    const theirs: Item[] = [];
    for (const person of people) {
      const cal = calendars.data?.find((c) => c.userId === person.userId);
      for (const [i, ev] of (cal?.events ?? []).entries()) {
        // A meeting I'm in already shows as mine.
        if (ev.meetingId && myMeetingIds.has(ev.meetingId)) continue;
        theirs.push({
          kind: 'person',
          key: `${person.userId}:${i}:${ev.start}`,
          s: new Date(ev.start).getTime(),
          e: new Date(ev.end).getTime(),
          ev,
          person,
        });
      }
    }
    const ext: Item[] = showMine
      ? (external.data?.events ?? [])
          .filter((e) => !e.allDay)
          .map((e, i) => ({ kind: 'external' as const, key: `ext:${i}:${e.start}`, s: Date.parse(e.start), e: Date.parse(e.end), title: e.title }))
      : [];
    return [...mine, ...theirs, ...ext];
  }, [meetings.data, calendars.data, people, external.data, showMine]);

  const step = narrow ? 1 : 7;
  const title = narrow
    ? format(anchor, 'EEEE d MMMM', { locale: dateLocale(lang) })
    : `${format(days[0], 'd MMM', { locale: dateLocale(lang) })} – ${format(days[6], 'd MMM yyyy', { locale: dateLocale(lang) })}`;

  const openSlot = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30; // snap to 30 min
    const at = new Date(startOfDay(day).getTime() + minutes * 60_000);
    if (at.getTime() <= Date.now()) return; // can't schedule in the past
    setDraftStart(at);
    setCreating(true);
  };

  const visibility = sharing.data?.visibility ?? 'PRIVATE';
  const btn = 'flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12.5px] font-medium text-ink hover:bg-hovered';

  return (
    <PaneShell
      icon={<CalendarDays size={18} className="text-accent" />}
      title={t('calendar')}
      subtitle={title}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      actions={
        <>
          <button onClick={() => setDialog('people')} className={btn} title="Show teammates' calendars" data-testid="calendar-people">
            <Users size={14} />
            <span className="hidden lg:inline">Teammates</span>
            {people.length > 0 && <span className="rounded bg-accent/15 px-1 text-[11px] text-accent">{people.length}</span>}
          </button>
          <button onClick={() => setDialog('sharing')} className={btn} title="Who can see your calendar" data-testid="calendar-sharing">
            <Eye size={14} />
            <span className="hidden lg:inline">{VISIBILITY_COPY[visibility].label}</span>
          </button>
          <button onClick={() => setAnchor(startOfDay(new Date()))} className={btn}>
            {t('today')}
          </button>
          <button
            onClick={() => setAnchor((a) => addDays(a, -step))}
            aria-label="Previous"
            className="rounded-lg p-1.5 text-ink-2 hover:bg-hovered"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setAnchor((a) => addDays(a, step))}
            aria-label="Next"
            className="rounded-lg p-1.5 text-ink-2 hover:bg-hovered"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => {
              setDraftStart(null);
              setCreating(true);
            }}
            aria-label={t('new_meeting')}
            className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover"
            data-testid="new-meeting"
          >
            <Plus size={14} /> <span className="hidden sm:inline">{t('new_meeting')}</span>
          </button>
        </>
      }
    >
      {perm === 'default' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent/5 px-4 py-2 text-[12.5px] text-ink-2">
          <BellRing size={14} className="text-accent" />
          <span className="min-w-0 flex-1">Turn on notifications so meeting reminders reach you even when Backstages is in the background.</span>
          <button
            onClick={async () => setPerm(await enableNotifications())}
            className="rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-white hover:bg-accent-hover"
          >
            Turn on
          </button>
        </div>
      )}

      {externalSource !== 'none' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-1 text-[12px] text-ink-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showMine} onChange={(e) => toggleMine(e.target.checked)} data-testid="toggle-my-events" />
            <span className="h-2 w-2 rounded-full bg-ink-3" />
            My {externalSource === 'google' ? 'Google Calendar' : 'calendar feed'} events
          </label>
          {external.data?.unavailable && <span className="text-amber-600">· couldn&apos;t be read right now</span>}
        </div>
      )}

      {people.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-4 py-1.5 text-[12px]" data-testid="calendar-legend">
          <span className="text-ink-3">Showing:</span>
          {people.map((p) => {
            const cal = calendars.data?.find((c) => c.userId === p.userId);
            return (
              <span
                key={p.userId}
                className="flex items-center gap-1 rounded-full border border-line py-0.5 pl-2 pr-1 text-ink"
                title={cal?.externalUnavailable ? `${p.name}'s linked calendar couldn't be read right now` : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                {p.name}
                {cal?.visibility === 'FREE_BUSY' && <span className="text-ink-3">· busy only</span>}
                {cal?.externalUnavailable && <span className="text-amber-600">· partial</span>}
                <button
                  onClick={() => setPicked(picked.filter((id) => id !== p.userId))}
                  aria-label={`Stop showing ${p.name}`}
                  className="rounded-full p-0.5 hover:bg-hovered"
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Day headers */}
      <div className="flex shrink-0 border-b border-line pr-2">
        <div className="w-12 shrink-0" />
        {days.map((d) => {
          const today = isSameDay(d, now);
          return (
            <button
              key={d.toISOString()}
              onClick={() => narrow || setAnchor(d)}
              aria-label={format(d, 'EEEE d MMMM', { locale: dateLocale(lang) })}
              className="flex min-w-0 flex-1 flex-col items-center py-1.5 text-[11.5px] text-ink-3"
            >
              <span className="uppercase tracking-wide">{format(d, 'EEE', { locale: dateLocale(lang) })}</span>
              <span
                className={clsx(
                  'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-semibold',
                  today ? 'bg-accent text-white' : 'text-ink',
                )}
              >
                {format(d, 'd')}
              </span>
              {(allDayByDay.get(format(d, 'yyyy-MM-dd')) ?? []).slice(0, 2).map((t, i) => (
                <span key={i} className="mt-0.5 max-w-full truncate rounded bg-hovered px-1 text-[10px] text-ink-2" title={t}>
                  {t}
                </span>
              ))}
            </button>
          );
        })}
      </div>

      {/* Hour grid */}
      <div ref={scrollRef} className="thin-scrollbar relative min-h-0 flex-1 overflow-y-auto" data-testid="calendar-grid">
        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-12 shrink-0">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="relative text-right text-[10.5px] text-ink-3" style={{ height: HOUR_PX }}>
                {h > 0 && <span className="absolute -top-2 right-1.5">{`${String(h).padStart(2, '0')}:00`}</span>}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutDay(items, d);
            const today = isSameDay(d, now);
            const nowTop = ((now.getTime() - startOfDay(d).getTime()) / 3_600_000) * HOUR_PX;
            return (
              <div
                key={d.toISOString()}
                className={clsx('relative min-w-0 flex-1 border-l border-line', today && 'bg-accent/[0.03]')}
                onClick={(e) => {
                  if (e.target === e.currentTarget) openSlot(d, e);
                }}
                data-testid="calendar-day"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="pointer-events-none border-t border-line/70" style={{ height: HOUR_PX }} />
                ))}
                {today && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: nowTop }}>
                    <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                    <span className="h-px flex-1 bg-red-500" />
                  </div>
                )}
                {placed.map(({ item, top, height, lane, lanes }) => {
                  const pos = {
                    top,
                    height,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  };
                  const start = new Date(item.s);
                  const past = item.e < now.getTime();

                  if (item.kind === 'external') {
                    return (
                      <div
                        key={item.key}
                        className={clsx(
                          'pointer-events-none absolute overflow-hidden rounded-md border border-dashed border-line-strong bg-hovered px-1.5 py-0.5 text-[11px] leading-tight text-ink-2',
                          past && 'opacity-50',
                        )}
                        style={pos}
                        title={`${item.title} · ${format(start, 'HH:mm')}`}
                        data-testid="calendar-external-event"
                      >
                        <span className="block truncate font-medium">{item.title || 'Busy'}</span>
                        {height > 30 && <span className="block truncate opacity-80">{format(start, 'HH:mm')}</span>}
                      </div>
                    );
                  }

                  if (item.kind === 'person') {
                    const { ev, person } = item;
                    const label = ev.title ?? 'Busy';
                    const clickable = !!ev.meetingId;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => clickable && openDetail(ev.meetingId!)}
                        className={clsx(
                          'absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight text-ink',
                          clickable ? 'cursor-pointer hover:brightness-95' : 'cursor-default',
                          ev.tentative && 'opacity-70',
                          past && 'opacity-50',
                        )}
                        style={{ ...pos, borderLeftColor: person.color, background: `${person.color}1f` }}
                        title={`${person.name}: ${label} · ${format(start, 'HH:mm')}–${format(new Date(item.e), 'HH:mm')}${ev.tentative ? ' (maybe)' : ''}`}
                        data-testid="calendar-person-event"
                      >
                        <span className="block truncate font-semibold" style={{ color: person.color }}>
                          {person.name.split(' ')[0]}
                        </span>
                        {height > 30 && <span className={clsx('block truncate', !ev.title && 'italic text-ink-3')}>{label}</span>}
                      </button>
                    );
                  }

                  const m = item.m;
                  const declined = m.myResponse === 'DECLINED';
                  // Solid once it's yours or you said yes/maybe; outlined while unanswered.
                  const answered = m.createdById === myId || m.myResponse === 'ACCEPTED' || m.myResponse === 'TENTATIVE';
                  return (
                    <button
                      key={item.key}
                      onClick={() => openDetail(m.id, m.virtual ? m : null)}
                      className={clsx(
                        'absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11.5px] leading-tight shadow-sm transition-opacity',
                        answered ? 'border-accent bg-accent text-white' : 'border-accent bg-elevated text-ink',
                        declined && 'line-through opacity-50',
                        past && 'opacity-60',
                      )}
                      style={pos}
                      title={`${m.title} · ${format(start, 'HH:mm')}`}
                      data-testid="calendar-event"
                    >
                      <span className="flex items-center gap-1 font-semibold">
                        {m.recurrence !== 'NONE' && <Repeat size={10} className="shrink-0" />}
                        <span className="truncate">{m.title}</span>
                      </span>
                      {height > 30 && (
                        <span className="block truncate opacity-80">
                          {format(start, 'HH:mm')} · {m.channelId ? `#${m.locationName}` : m.locationName}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {meetings.isSuccess && meetings.data.length === 0 && people.length === 0 && (
        <p className="shrink-0 border-t border-line px-4 py-2 text-center text-[12px] text-ink-3">
          Nothing scheduled {narrow ? 'this day' : 'this week'} — click a time slot or “{t('new_meeting')}” to plan one.
        </p>
      )}

      {creating && (
        <ScheduleHuddleDialog workspaceId={workspaceId} initialStart={draftStart ?? undefined} onClose={() => setCreating(false)} />
      )}
      {dialog === 'sharing' && <SharingDialog workspaceId={workspaceId} onClose={() => setDialog('none')} />}
      {dialog === 'people' && (
        <PeoplePicker
          people={shared.data ?? []}
          loading={shared.isLoading}
          picked={picked}
          onChange={setPicked}
          onClose={() => setDialog('none')}
        />
      )}
    </PaneShell>
  );
}

/** Choose who can see your calendar in this workspace. */
function SharingDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const sharing = useCalendarSharing(workspaceId);
  const save = useSetCalendarSharing(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const current = sharing.data?.visibility ?? 'PRIVATE';
  return (
    <Dialog title="Who can see your calendar" onClose={onClose}>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Calendar visibility" data-testid="sharing-dialog">
        {(Object.keys(VISIBILITY_COPY) as CalendarVisibility[]).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={current === v}
            disabled={save.isPending}
            onClick={() =>
              save.mutate(v, {
                onSuccess: () => pushToast(`Calendar visibility: ${VISIBILITY_COPY[v].label}.`, 'success'),
                onError: (e) => pushToast(e instanceof Error ? e.message : 'Could not save.', 'error'),
              })
            }
            className={clsx(
              'rounded-lg border p-3 text-left',
              current === v ? 'border-accent bg-accent/10' : 'border-line-strong hover:bg-hovered',
            )}
            data-testid={`visibility-${v.toLowerCase()}`}
          >
            <span className="block text-[13px] font-semibold text-ink">{VISIBILITY_COPY[v].label}</span>
            <span className="block text-[12px] text-ink-2">{VISIBILITY_COPY[v].hint}</span>
          </button>
        ))}
        <p className="mt-1 text-[11.5px] text-ink-3">
          Applies to this workspace only. Your linked calendar&apos;s address is never shown to anyone.
        </p>
      </div>
    </Dialog>
  );
}

/** Pick up to five teammates whose shared calendars to overlay. */
function PeoplePicker({
  people,
  loading,
  picked,
  onChange,
  onClose,
}: {
  people: SharedCalendarPersonDto[];
  loading: boolean;
  picked: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const shown = people.filter((p) => p.displayName.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) =>
    onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-MAX_PEOPLE));
  return (
    <Dialog title="Teammates' calendars" onClose={onClose}>
      <div className="flex flex-col gap-2" data-testid="people-picker">
        {loading ? (
          <p className="text-[13px] text-ink-3">Loading…</p>
        ) : people.length === 0 ? (
          <p className="text-[13px] text-ink-2">
            No one has shared their calendar yet. Teammates can share theirs from the eye button in their Calendar.
          </p>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people…"
              className="rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
            <ul className="thin-scrollbar max-h-72 overflow-y-auto">
              {shown.map((p) => (
                <li key={p.userId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-hovered">
                    <input type="checkbox" checked={picked.includes(p.userId)} onChange={() => toggle(p.userId)} />
                    <span className="flex-1 text-ink">{p.displayName}</span>
                    <span className="text-[11.5px] text-ink-3">{VISIBILITY_COPY[p.visibility].label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-ink-3">Up to {MAX_PEOPLE} at a time. Only people who chose to share are listed.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
