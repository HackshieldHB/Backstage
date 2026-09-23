'use client';

import { useState } from 'react';
import { CalendarClock, Headphones, X } from 'lucide-react';
import type { Container } from '@/hooks/queries';
import {
  useCancelScheduledHuddle,
  useScheduleHuddle,
  useScheduledHuddles,
} from '@/hooks/queries';
import type { HuddleController } from '@/hooks/use-huddle';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

/** Default the picker to the next round half-hour, formatted for datetime-local. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  d.setMinutes(d.getMinutes() >= 30 ? 60 : 30, 0, 0);
  // datetime-local wants local time without a timezone suffix.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
  if (diffMin <= 0 && diffMin > -60) return 'starting now';
  if (diffMin > 0 && diffMin < 60) return `in ${diffMin} min`;
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Dialog to plan a huddle for later in this channel/DM. */
export function ScheduleHuddleDialog({ container, onClose }: { container: Container; onClose: () => void }) {
  const schedule = useScheduleHuddle(container);
  const pushToast = useUiStore((s) => s.pushToast);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(defaultWhen);
  const [duration, setDuration] = useState(30);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const at = new Date(when);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      pushToast('Pick a time in the future.', 'error');
      return;
    }
    schedule.mutate(
      { title: t, scheduledFor: at.toISOString(), durationMins: duration },
      {
        onSuccess: () => {
          pushToast('Huddle scheduled — members will be reminded when it starts.', 'success');
          onClose();
        },
        onError: (e) => pushToast(e instanceof Error ? e.message : 'Could not schedule the huddle.', 'error'),
      },
    );
  };

  return (
    <Dialog title="Schedule a huddle" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-ink-2">
          Title
          <input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sprint planning"
            className="rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink-2">
          Starts
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center justify-between text-[13px] text-ink-2">
          Length
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="rounded-lg border border-line-strong bg-elevated px-2 py-1.5 text-[13px] text-ink"
          >
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 hover:bg-hovered">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || schedule.isPending}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {schedule.isPending ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** A compact banner listing upcoming (and just-started) huddles for a container. */
export function UpcomingHuddles({ container, huddle }: { container: Container; huddle: HuddleController }) {
  const myId = useAuthStore((s) => s.user?.id);
  const upcoming = useScheduledHuddles(container);
  const cancel = useCancelScheduledHuddle(container);
  const rows = upcoming.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="border-b border-line bg-amber-50 px-4 py-1.5 dark:bg-amber-950/30" data-testid="upcoming-huddles">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-1">
        {rows.map((h) => (
          <div key={h.id} className="flex items-center gap-2 text-[12.5px] text-amber-800 dark:text-amber-200">
            <CalendarClock size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              <strong className="font-semibold">{h.title}</strong>
              <span className="text-amber-700/70 dark:text-amber-200/60"> · {whenLabel(h.scheduledFor)} · {h.createdByName}</span>
            </span>
            <button
              onClick={() => void huddle.join(container)}
              className="flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[11.5px] font-semibold text-white hover:bg-amber-600"
              data-testid="join-scheduled-huddle"
            >
              <Headphones size={12} /> Join
            </button>
            {h.createdById === myId && (
              <button
                onClick={() => cancel.mutate(h.id)}
                title="Cancel this scheduled huddle"
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
