'use client';

import { useState } from 'react';
import { useAvailability, useSetAvailability } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toTime(min: number | null): string {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fromTime(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
/** datetime-local default: tomorrow 09:00 local. */
function defaultOooUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AvailabilityDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const prefs = useAvailability(workspaceId);
  const save = useSetAvailability(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const d = prefs.data;

  const [hoursOn, setHoursOn] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [oooOn, setOooOn] = useState(false);
  const [oooUntil, setOooUntil] = useState(defaultOooUntil);
  const [oooMessage, setOooMessage] = useState('');
  const [ready, setReady] = useState(false);

  // Seed once the prefs load.
  if (d && !ready) {
    setReady(true);
    if (d.workStartMin != null && d.workEndMin != null) {
      setHoursOn(true);
      setStart(toTime(d.workStartMin));
      setEnd(toTime(d.workEndMin));
    }
    if (d.workDays?.length) setDays(d.workDays);
    if (d.oooUntil) {
      setOooOn(true);
      setOooMessage(d.oooMessage ?? '');
    }
  }

  const submit = () => {
    const startMin = hoursOn ? fromTime(start) : null;
    const endMin = hoursOn ? fromTime(end) : null;
    if (hoursOn && (startMin == null || endMin == null || endMin <= startMin)) {
      pushToast('Enter a valid start and end time.', 'error');
      return;
    }
    let ooo: string | null = null;
    if (oooOn) {
      const at = new Date(oooUntil);
      if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
        pushToast('Out-of-office end time must be in the future.', 'error');
        return;
      }
      ooo = at.toISOString();
    }
    save.mutate(
      {
        workStartMin: startMin,
        workEndMin: endMin,
        workDays: hoursOn ? days : null,
        oooUntil: ooo,
        oooMessage: oooOn ? oooMessage.trim() || null : null,
      },
      {
        onSuccess: () => {
          pushToast('Availability saved.', 'success');
          onClose();
        },
        onError: (e) => pushToast(e instanceof Error ? e.message : 'Could not save.', 'error'),
      },
    );
  };

  return (
    <Dialog title="Availability & focus hours" onClose={onClose}>
      <div className="flex min-w-[320px] flex-col gap-4">
        {/* Working hours */}
        <div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <input type="checkbox" checked={hoursOn} onChange={(e) => setHoursOn(e.target.checked)} />
            Mute my alerts outside working hours
          </label>
          {hoursOn && (
            <div className="mt-2 space-y-2 pl-6">
              <div className="flex items-center gap-2 text-[13px] text-ink-2">
                From
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-line-strong bg-elevated px-2 py-1 text-ink" />
                to
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-line-strong bg-elevated px-2 py-1 text-ink" />
              </div>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((label, i) => {
                  const on = days.includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() => setDays((s) => (on ? s.filter((x) => x !== i) : [...s, i].sort()))}
                      className={`rounded-md px-2 py-1 text-[12px] font-medium ${on ? 'bg-accent text-white' : 'bg-hovered text-ink-2'}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Out of office */}
        <div className="border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <input type="checkbox" checked={oooOn} onChange={(e) => setOooOn(e.target.checked)} />
            I’m out of office
          </label>
          {oooOn && (
            <div className="mt-2 space-y-2 pl-6">
              <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                Until
                <input type="datetime-local" value={oooUntil} onChange={(e) => setOooUntil(e.target.value)} className="rounded-lg border border-line-strong bg-elevated px-2 py-1.5 text-[13px] text-ink" />
              </label>
              <input
                value={oooMessage}
                onChange={(e) => setOooMessage(e.target.value)}
                placeholder="Optional message, e.g. Back Monday — ping @alex for urgent"
                maxLength={280}
                className="w-full rounded-lg border border-line-strong bg-elevated px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
              />
              <p className="text-[11px] text-ink-3">Sets a 🌴 status and pauses your notifications until then.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 hover:bg-hovered">Cancel</button>
          <button
            onClick={submit}
            disabled={save.isPending}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
