'use client';

import { useState } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { useLogTime } from '@/hooks/queries';
import { Dialog } from './dialog';

const PRESETS = [
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
];

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800';

/** Log time against a Jira issue — pushed to Jira as a native worklog. If
 * `issueKey` is supplied (e.g. from a Jira card) it is locked; otherwise the
 * user types it. */
export function LogTimeDialog({
  workspaceId,
  issueKey: fixedKey,
  onClose,
}: {
  workspaceId: string;
  issueKey?: string;
  onClose: () => void;
}) {
  const pushToast = useUiStore((s) => s.pushToast);
  const logTime = useLogTime(workspaceId);
  const [issueKey, setIssueKey] = useState(fixedKey ?? '');
  const [minutes, setMinutes] = useState(30);
  const [comment, setComment] = useState('');
  const [when, setWhen] = useState<'now' | 'custom'>('now');
  const [startedAt, setStartedAt] = useState('');

  const submit = async () => {
    const key = issueKey.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
      pushToast('Enter a valid issue key like PROJ-123.', 'error');
      return;
    }
    if (minutes < 1) {
      pushToast('Time spent must be at least 1 minute.', 'error');
      return;
    }
    try {
      const entry = await logTime.mutateAsync({
        issueKey: key,
        minutes,
        ...(when === 'custom' && startedAt ? { startedAt: new Date(startedAt).toISOString() } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      pushToast(
        entry.synced ? `Logged ${fmt(minutes)} to ${key} in Jira.` : `Saved locally — retry sync from the timeline.`,
        entry.synced ? 'success' : 'info',
      );
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not log time', 'error');
    }
  };

  return (
    <Dialog title="Log time to Jira" onClose={onClose}>
      <label className="mb-1 block text-xs font-medium text-gray-500">Issue key</label>
      <input
        className={`${inputCls} mb-3 ${fixedKey ? 'opacity-70' : ''}`}
        placeholder="PROJ-123"
        value={issueKey}
        onChange={(e) => setIssueKey(e.target.value)}
        readOnly={!!fixedKey}
        autoFocus={!fixedKey}
        data-testid="logtime-issue"
      />

      <label className="mb-1 block text-xs font-medium text-gray-500">Time spent</label>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setMinutes(p.minutes)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
              minutes === p.minutes
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={1440}
          className={`${inputCls} w-28`}
          value={minutes}
          onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 0))}
          data-testid="logtime-minutes"
        />
        <span className="text-sm text-gray-500">minutes ({fmt(minutes)})</span>
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-500">When</label>
      <div className="mb-3 flex items-center gap-3 text-sm">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Now
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="radio" checked={when === 'custom'} onChange={() => setWhen('custom')} /> Custom
        </label>
        {when === 'custom' && (
          <input
            type="datetime-local"
            className={`${inputCls} flex-1`}
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        )}
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-500">Comment (optional)</label>
      <textarea
        className={`${inputCls} mb-4 h-16 resize-none`}
        placeholder="What did you work on?"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      <button
        onClick={() => void submit()}
        disabled={logTime.isPending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        data-testid="logtime-submit"
      >
        {logTime.isPending ? 'Logging…' : 'Log time'}
      </button>
    </Dialog>
  );
}

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
}
