'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WellbeingLevel } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useWellbeing, useDigestPref, useCalendar, useFocusReport } from '@/hooks/queries';

const DOT: Record<WellbeingLevel, string> = {
  ok: 'text-green-500',
  watch: 'text-amber-500',
  high: 'text-red-500',
};

/** R4: focus & meeting-load recommendations from your activity data (private). */
export function FocusCard({ workspaceId }: { workspaceId: string }) {
  const focus = useFocusReport(workspaceId);
  const data = focus.data;
  if (!data || !data.available) return null;

  return (
    <div className="mb-4 rounded-md border border-line p-2.5 dark:border-line" data-testid="focus-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          Focus &amp; meetings <span className="text-gray-400">(private)</span>
        </span>
        <span className="text-[11px] text-gray-400">{data.daysCovered}d</span>
      </div>
      <div className="mt-2 flex gap-4 text-[12px]">
        <span>
          <span className="font-semibold text-ink">{data.focusHoursPerDay}h</span>
          <span className="text-gray-500">/day focus</span>
        </span>
        <span>
          <span className="font-semibold text-ink">{data.meetingHoursPerDay}h</span>
          <span className="text-gray-500">/day meetings</span>
        </span>
        {data.longestFocusBlockMin > 0 && (
          <span>
            <span className="font-semibold text-ink">{data.longestFocusBlockMin}m</span>
            <span className="text-gray-500"> best block</span>
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {data.recommendations.map((r) => (
          <li key={r.key} className="flex items-start gap-1.5 text-[12px]">
            <span className={DOT[r.level]}>●</span>
            <span>
              <span className="font-medium">{r.title}:</span>{' '}
              <span className="text-gray-500">{r.detail}</span>
              {r.action && <span className="mt-0.5 block text-[11px] font-medium text-accent">→ {r.action}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Private, self-only workload snapshot shown in the profile dialog. */
export function WellbeingCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const wb = useWellbeing(workspaceId);
  const data = wb.data;

  const setOptIn = async (value: boolean) => {
    await api('PATCH', `/workspaces/${workspaceId}/wellbeing/opt-in`, { optIn: value });
    await qc.invalidateQueries({ queryKey: keys.wellbeing(workspaceId) });
  };

  if (!data) return null;

  return (
    <div className="mb-4 rounded-md border border-line p-2.5 dark:border-line">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          Workload & wellbeing <span className="text-gray-400">(private)</span>
        </span>
        {data.optIn ? (
          <button onClick={() => void setOptIn(false)} className="text-xs text-gray-400 hover:text-gray-600">
            Turn off
          </button>
        ) : (
          <button
            onClick={() => void setOptIn(true)}
            className="rounded border border-accent px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent/10"
            data-testid="wellbeing-optin"
          >
            Enable
          </button>
        )}
      </div>
      {data.optIn ? (
        <>
          <ul className="mt-2 space-y-1">
            {data.signals.map((s) => (
              <li key={s.key} className="flex items-start gap-1.5 text-[12px]">
                <span className={DOT[s.level]}>●</span>
                <span>
                  <span className="font-medium">{s.label}:</span>{' '}
                  <span className="text-gray-500">{s.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {data.nudge && (
            <p
              className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              data-testid="wellbeing-nudge"
            >
              💡 {data.nudge}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-[11px] text-gray-400">
          Opt in to see private workload signals derived from your activity. Only you can see this.
        </p>
      )}
    </div>
  );
}

/** Personal opt-in for the daily email digest of unread mentions/notifications. */
export function DigestToggle({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const pref = useDigestPref(workspaceId);
  const optIn = pref.data?.optIn ?? false;

  const toggle = async (value: boolean) => {
    await api('PATCH', `/workspaces/${workspaceId}/digest/opt-in`, {
      optIn: value,
      tzOffsetMin: -new Date().getTimezoneOffset(),
    });
    await qc.invalidateQueries({ queryKey: keys.digest(workspaceId) });
  };

  return (
    <div className="mb-4 rounded-md border border-line p-2.5 dark:border-line">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Daily email digest</span>
        {optIn ? (
          <button onClick={() => void toggle(false)} className="text-xs text-gray-400 hover:text-gray-600">
            Turn off
          </button>
        ) : (
          <button
            onClick={() => void toggle(true)}
            className="rounded border border-accent px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent/10"
            data-testid="digest-optin"
          >
            Enable
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        A once-a-day email summarising your unread mentions and notifications.
      </p>
    </div>
  );
}

/** Link a calendar .ics feed so presence auto-flips to "In a meeting". */
export function CalendarLink() {
  const qc = useQueryClient();
  const cal = useCalendar();
  const linked = cal.data?.linked ?? false;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.calendar });

  const link = async () => {
    if (!/^https?:\/\//.test(url.trim())) return;
    setBusy(true);
    try {
      await api('PUT', '/me/calendar', { icsUrl: url.trim() });
      await api('POST', '/me/calendar/sync', {});
      setUrl('');
      await invalidate();
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    setBusy(true);
    try {
      await api('DELETE', '/me/calendar');
      await invalidate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-md border border-line p-2.5 dark:border-line">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          Calendar {cal.data?.inMeeting && <span className="ml-1 text-accent">· 🗓️ In a meeting</span>}
        </span>
        {linked && (
          <button onClick={() => void unlink()} disabled={busy} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50">
            Unlink
          </button>
        )}
      </div>
      {linked ? (
        <p className="mt-1 truncate text-[11px] text-gray-400" title={cal.data?.icsUrl ?? ''}>
          Linked{cal.data?.lastSyncAt ? ` · synced ${new Date(cal.data.lastSyncAt).toLocaleString()}` : ''}. Your status flips to “In a meeting” during events.
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded-md border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-accent dark:border-line dark:bg-gray-800"
            placeholder="Secret .ics feed URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            data-testid="calendar-ics-url"
          />
          <button
            onClick={() => void link()}
            disabled={busy || !/^https?:\/\//.test(url.trim())}
            className="shrink-0 rounded-md border border-accent px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            {busy ? '…' : 'Link'}
          </button>
        </div>
      )}
    </div>
  );
}
