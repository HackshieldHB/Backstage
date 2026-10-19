'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import {
  Bell,
  CalendarPlus,
  Check,
  Clock,
  Download,
  Hash,
  Headphones,
  HelpCircle,
  MessageSquare,
  Pencil,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import type { MeetingResponse, ScheduledHuddleDto } from '@backstages/shared';
import {
  useCancelScheduledHuddle,
  useMeetingDetail,
  useRespondMeeting,
  type Container,
} from '@/hooks/queries';
import type { HuddleController } from '@/hooks/use-huddle';
import { downloadIcs, googleCalendarUrl } from '@/lib/calendar-export';
import { track } from '@/lib/usage';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Avatar } from './avatar';
import { Dialog } from './dialog';
import { RECURRENCE_LABELS, ScheduleHuddleDialog, reminderLabel } from './schedule-huddle';

const RESPONSES: { value: MeetingResponse; label: string; icon: typeof Check }[] = [
  { value: 'ACCEPTED', label: 'Yes', icon: Check },
  { value: 'TENTATIVE', label: 'Maybe', icon: HelpCircle },
  { value: 'DECLINED', label: 'No', icon: X },
];

function containerOf(m: Pick<ScheduledHuddleDto, 'channelId' | 'conversationId'>): Container | null {
  if (m.channelId) return { kind: 'channel', id: m.channelId };
  if (m.conversationId) return { kind: 'conversation', id: m.conversationId };
  return null;
}

/** Can people join now? From 10 min before the start until it should be over. */
export function isJoinable(m: Pick<ScheduledHuddleDto, 'scheduledFor' | 'durationMins'>, now = Date.now()): boolean {
  const start = new Date(m.scheduledFor).getTime();
  return now >= start - 10 * 60_000 && now <= start + (m.durationMins ?? 30) * 60_000;
}

/**
 * Details of one meeting, opened from the calendar, a channel's upcoming banner
 * or a meeting notification (via `meetingDetailId` in the UI store). Rendered
 * once at the app shell so it can start the huddle wherever you are.
 */
export function MeetingDetailDialog({
  huddle,
  onNavigate,
}: {
  huddle: HuddleController;
  onNavigate: (c: Container) => void;
}) {
  const id = useUiStore((s) => s.meetingDetailId);
  // A projected occurrence (calendar) is shown from the series' stored row.
  const preview = useUiStore((s) => s.meetingPreview);
  const close = useUiStore((s) => s.setMeetingDetailId);
  const pushToast = useUiStore((s) => s.pushToast);
  const me = useAuthStore((s) => s.user);
  const sourceId = id?.split('@')[0] ?? null;
  const detail = useMeetingDetail(sourceId);
  const respond = useRespondMeeting();
  const cancel = useCancelScheduledHuddle();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!id) return null;
  const onClose = () => {
    setEditing(false);
    setConfirmCancel(false);
    close(null);
  };

  if (detail.isError) {
    return (
      <Dialog title="Meeting" onClose={onClose}>
        <p className="text-[13px] text-ink-2">This meeting was cancelled or you no longer have access to it.</p>
      </Dialog>
    );
  }
  const d = detail.data;
  if (!d) {
    return (
      <Dialog title="Meeting" onClose={onClose}>
        <p className="animate-pulse text-[13px] text-ink-3">Loading…</p>
      </Dialog>
    );
  }

  // A projected future occurrence shows its own time but the series' details.
  const virtual = id.includes('@') && preview?.id === id ? preview : null;
  const m: ScheduledHuddleDto = virtual ? { ...d, ...virtual } : d;
  const start = new Date(m.scheduledFor);
  const end = new Date(start.getTime() + (m.durationMins ?? 30) * 60_000);
  const organizer = d.createdById === me?.id;
  const where = containerOf(m);
  const joinable = !virtual && isJoinable(m);
  const counts = { ACCEPTED: 0, TENTATIVE: 0, DECLINED: 0 } as Record<MeetingResponse, number>;
  for (const g of d.guests) if (g.response) counts[g.response]++;
  const awaiting = d.guests.filter((g) => !g.response && !g.isOrganizer).length;

  if (editing) {
    return <ScheduleHuddleDialog meeting={d} onClose={() => setEditing(false)} />;
  }

  const doCancel = async (scope: 'series' | 'occurrence') => {
    try {
      const res = await cancel.mutateAsync({ id: d.sourceId, scope });
      if (!res.ok) throw new Error('Could not cancel — it may have just started.');
      pushToast(scope === 'occurrence' ? 'This occurrence was skipped.' : 'Meeting cancelled — guests were notified.', 'success');
      onClose();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not cancel the meeting.', 'error');
    }
  };

  return (
    <Dialog title={m.title} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-[13px]" data-testid="meeting-detail">
        <div className="flex flex-col gap-1.5 text-ink-2">
          <div className="flex items-center gap-2">
            <Clock size={14} className="shrink-0 text-ink-3" />
            <span>
              {format(start, 'EEEE d MMMM yyyy')} · {format(start, 'HH:mm')}–{format(end, 'HH:mm')}
            </span>
          </div>
          {m.recurrence !== 'NONE' && (
            <div className="flex items-center gap-2">
              <Repeat size={14} className="shrink-0 text-ink-3" /> {RECURRENCE_LABELS[m.recurrence]}
            </div>
          )}
          <div className="flex items-center gap-2">
            {m.channelId ? (
              <Hash size={14} className="shrink-0 text-ink-3" />
            ) : (
              <MessageSquare size={14} className="shrink-0 text-ink-3" />
            )}
            <span className="truncate">{m.channelId ? m.locationName : `Group DM · ${m.locationName}`}</span>
          </div>
          <div className="flex items-center gap-2">
            <Bell size={14} className="shrink-0 text-ink-3" /> Reminder: {reminderLabel(m.reminderMins)}, and at the start
          </div>
        </div>

        {m.description && (
          <p className="whitespace-pre-wrap rounded-lg bg-hovered px-3 py-2 text-ink">{m.description}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {joinable && where && (
            <button
              onClick={() => {
                void huddle.join(where);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 font-semibold text-white hover:bg-accent-hover"
              data-testid="meeting-join"
            >
              <Headphones size={14} /> Join now
            </button>
          )}
          {where && (
            <button
              onClick={() => {
                onNavigate(where);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-ink hover:bg-hovered"
            >
              <MessageSquare size={14} /> Open {m.channelId ? 'channel' : 'chat'}
            </button>
          )}
          <a
            href={googleCalendarUrl(m)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-ink hover:bg-hovered"
          >
            <CalendarPlus size={14} /> Google Calendar
          </a>
          <button
            onClick={() => downloadIcs(m)}
            className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-ink hover:bg-hovered"
            title="Download an .ics file for Outlook, Apple Calendar…"
          >
            <Download size={14} /> .ics
          </button>
        </div>

        {!organizer && !virtual && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-2">Going?</span>
            {RESPONSES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() =>
                  respond.mutate(
                    { id: d.sourceId, response: value },
                    {
                      onSuccess: () => track('meeting:rsvp'),
                      onError: (e) => pushToast(e instanceof Error ? e.message : 'Could not save your answer.', 'error'),
                    },
                  )
                }
                disabled={respond.isPending}
                aria-pressed={d.myResponse === value}
                className={clsx(
                  'flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px] font-medium',
                  d.myResponse === value
                    ? value === 'DECLINED'
                      ? 'border-red-500 bg-red-500/10 text-red-600 dark:text-red-400'
                      : 'border-accent bg-accent/10 text-accent'
                    : 'border-line-strong text-ink-2 hover:bg-hovered',
                )}
                data-testid={`rsvp-${value.toLowerCase()}`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        )}
        {virtual && !organizer && (
          <p className="text-[12px] text-ink-3">
            A future occurrence of a repeating meeting — you can answer once it&apos;s the next one up.
          </p>
        )}

        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Guests · {d.guests.length}
            {/* Answers belong to the next occurrence, not to a projected later one. */}
            {!virtual && (
              <span className="ml-2 font-normal normal-case tracking-normal">
                {counts.ACCEPTED} yes · {counts.TENTATIVE} maybe · {counts.DECLINED} no · {awaiting} awaiting
              </span>
            )}
          </p>
          <ul className="thin-scrollbar flex max-h-48 flex-col gap-1 overflow-y-auto">
            {d.guests.map((g) => (
              <li key={g.userId} className="flex items-center gap-2">
                <Avatar user={{ id: g.userId, displayName: g.displayName, avatarUrl: g.avatarUrl }} size="sm" />
                <span className="min-w-0 flex-1 truncate text-ink">
                  {g.displayName}
                  {g.isOrganizer && <span className="ml-1 text-[11.5px] text-ink-3">organiser</span>}
                </span>
                <span
                  className={clsx(
                    'text-[11.5px]',
                    g.response === 'ACCEPTED' && 'text-emerald-600 dark:text-emerald-400',
                    g.response === 'DECLINED' && 'text-red-600 dark:text-red-400',
                    g.response === 'TENTATIVE' && 'text-amber-600 dark:text-amber-400',
                    !g.response && 'text-ink-3',
                  )}
                >
                  {g.isOrganizer || virtual
                    ? ''
                    : g.response === 'ACCEPTED'
                      ? 'Yes'
                      : g.response === 'DECLINED'
                        ? 'No'
                        : g.response === 'TENTATIVE'
                          ? 'Maybe'
                          : 'Awaiting'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {organizer && !m.notified && !virtual && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
            {confirmCancel ? (
              <>
                <span className="mr-auto text-ink-2">Cancel this meeting? Guests will be told.</span>
                {m.recurrence !== 'NONE' && (
                  <button
                    onClick={() => void doCancel('occurrence')}
                    className="rounded-lg border border-line-strong px-3 py-1.5 text-ink hover:bg-hovered"
                  >
                    Only this one
                  </button>
                )}
                <button
                  onClick={() => void doCancel('series')}
                  className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700"
                  data-testid="meeting-cancel-confirm"
                >
                  {m.recurrence !== 'NONE' ? 'All future' : 'Cancel meeting'}
                </button>
                <button onClick={() => setConfirmCancel(false)} className="rounded-lg px-3 py-1.5 text-ink-2 hover:bg-hovered">
                  Keep
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setConfirmCancel(true)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  data-testid="meeting-cancel"
                >
                  <Trash2 size={14} /> Cancel meeting
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-ink hover:bg-hovered"
                  data-testid="meeting-edit"
                >
                  <Pencil size={14} /> Edit
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
