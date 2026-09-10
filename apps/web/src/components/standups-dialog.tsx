'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarClock, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ChannelDto,
  CreateStandupInput,
  StandupDto,
  StandupPrefillDto,
} from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useMembers, useStandupResponses, useStandups } from '@/hooks/queries';
import { Dialog } from './dialog';
import { Avatar } from './avatar';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scheduleSummary(s: StandupDto): string {
  const days = [...s.days].sort((a, b) => a - b);
  const weekdays = [1, 2, 3, 4, 5];
  const label =
    days.length === 7
      ? 'every day'
      : days.length === weekdays.length && weekdays.every((d) => days.includes(d))
        ? 'weekdays'
        : days.map((d) => DAY_LABELS[d]).join(', ');
  return `${s.timeOfDay} · ${label}`;
}

export function StandupsDialog({
  workspaceId,
  channels,
  onClose,
}: {
  workspaceId: string;
  channels: ChannelDto[];
  onClose: () => void;
}) {
  const standups = useStandups(workspaceId);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Dialog title="Standups" onClose={onClose} wide>
      <p className="mb-3 text-sm text-gray-500">
        Recurring async check-ins. At the scheduled time a prompt is posted to the channel; everyone
        submits their update (activity auto-filled), and you can post a digest.
      </p>

      {creating ? (
        <CreateStandupForm
          workspaceId={workspaceId}
          channels={channels}
          onDone={() => setCreating(false)}
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="mb-3 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          data-testid="new-standup"
        >
          <Plus size={14} /> New standup
        </button>
      )}

      <ul className="space-y-2">
        {(standups.data ?? []).map((s) => (
          <StandupRow
            key={s.id}
            standup={s}
            open={openId === s.id}
            onToggle={() => setOpenId((v) => (v === s.id ? null : s.id))}
            workspaceId={workspaceId}
          />
        ))}
        {standups.isSuccess && standups.data.length === 0 && !creating && (
          <li className="rounded-lg border border-dashed border-line-strong py-6 text-center text-sm text-gray-500 dark:border-line">
            No standups yet. Create one to get your team checking in.
          </li>
        )}
      </ul>
    </Dialog>
  );
}

function StandupRow({
  standup,
  open,
  onToggle,
  workspaceId,
}: {
  standup: StandupDto;
  open: boolean;
  onToggle: () => void;
  workspaceId: string;
}) {
  const qc = useQueryClient();

  const remove = async () => {
    await api('DELETE', `/standups/${standup.id}`);
    await qc.invalidateQueries({ queryKey: keys.standups(workspaceId) });
  };

  return (
    <li className="rounded-lg border border-line">
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <CalendarClock size={16} />
        </span>
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{standup.name}</span>
            {!standup.active && (
              <span className="rounded bg-gray-100 px-1.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800">
                paused
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">{scheduleSummary(standup)}</div>
        </button>
        <span className="flex -space-x-1">
          {standup.members.slice(0, 4).map((m) => (
            <span key={m.id} className="ring-1 ring-white dark:ring-gray-900">
              <Avatar user={m} size="xs" />
            </span>
          ))}
        </span>
        <button
          onClick={() => void remove()}
          title="Delete standup"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
          data-testid="delete-standup"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {open && (
        <div className="border-t border-line p-3 dark:border-line">
          <CheckinPanel standupId={standup.id} workspaceId={workspaceId} />
          <DigestPanel standupId={standup.id} workspaceId={workspaceId} />
        </div>
      )}
    </li>
  );
}

function CheckinPanel({ standupId, workspaceId }: { standupId: string; workspaceId: string }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [yesterday, setYesterday] = useState('');
  const [todayText, setTodayText] = useState('');
  const [blockers, setBlockers] = useState('');
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [saved, setSaved] = useState(false);

  const pull = async () => {
    setPulling(true);
    try {
      const p = await api<StandupPrefillDto>('GET', `/standups/${standupId}/prefill`);
      const lines = [
        ...p.summary,
        ...(p.jiraIssues.length ? [`Worked on: ${p.jiraIssues.join(', ')}`] : []),
      ];
      if (lines.length) setYesterday((v) => (v ? v : lines.join('\n')));
    } finally {
      setPulling(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await api('POST', `/standups/${standupId}/checkin`, {
        yesterday: yesterday,
        today: todayText,
        blockers: blockers || undefined,
      });
      await qc.invalidateQueries({ queryKey: keys.standupResponses(standupId, today) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  const ta =
    'w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500">Your check-in</h4>
        <button
          onClick={() => void pull()}
          disabled={pulling}
          className="flex items-center gap-1 rounded-md border border-accent px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
          data-testid="pull-activity"
        >
          <Sparkles size={12} /> {pulling ? 'Pulling…' : 'Pull my activity'}
        </button>
      </div>
      <label className="mb-1 block text-xs text-gray-500">What did you do?</label>
      <textarea className={clsx(ta, 'mb-2')} rows={2} value={yesterday} onChange={(e) => setYesterday(e.target.value)} />
      <label className="mb-1 block text-xs text-gray-500">What&apos;s next?</label>
      <textarea className={clsx(ta, 'mb-2')} rows={2} value={todayText} onChange={(e) => setTodayText(e.target.value)} />
      <label className="mb-1 block text-xs text-gray-500">Blockers (optional)</label>
      <textarea className={clsx(ta, 'mb-2')} rows={1} value={blockers} onChange={(e) => setBlockers(e.target.value)} />
      <div className="flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="submit-checkin"
        >
          {busy ? 'Saving…' : 'Submit check-in'}
        </button>
        {saved && <span className="text-xs font-medium text-green-600">Saved ✓</span>}
      </div>
    </div>
  );
}

function DigestPanel({ standupId, workspaceId }: { standupId: string; workspaceId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const responses = useStandupResponses(standupId, today);
  const [posting, setPosting] = useState(false);
  const list = responses.data ?? [];

  const post = async () => {
    setPosting(true);
    try {
      await api('POST', `/standups/${standupId}/digest`);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500">
          Today&apos;s responses ({list.length})
        </h4>
        {list.length > 0 && (
          <button
            onClick={() => void post()}
            disabled={posting}
            className="rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-line-strong dark:hover:bg-gray-800"
          >
            {posting ? 'Posting…' : 'Post digest to channel'}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-gray-400">No check-ins yet today.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="flex gap-2 rounded-md bg-gray-50 p-2 dark:bg-gray-800/50">
              <Avatar user={r.user} size="xs" />
              <div className="min-w-0 text-xs">
                <div className="font-semibold">{r.user.displayName}</div>
                {r.yesterday && <div><span className="text-gray-400">Did:</span> {r.yesterday}</div>}
                {r.today && <div><span className="text-gray-400">Next:</span> {r.today}</div>}
                {r.blockers && <div className="text-red-600">⛔ {r.blockers}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateStandupForm({
  workspaceId,
  channels,
  onDone,
}: {
  workspaceId: string;
  channels: ChannelDto[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const members = useMembers(workspaceId);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () => (members.data ?? []).filter((m) => !m.deactivatedAt),
    [members.data],
  );

  const toggleDay = (d: number) =>
    setDays((v) => (v.includes(d) ? v.filter((x) => x !== d) : [...v, d]));
  const toggleMember = (id: string) =>
    setMemberIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const submit = async () => {
    setError(null);
    if (!channelId || days.length === 0 || !name.trim()) {
      setError('Give it a name, a channel, and at least one day.');
      return;
    }
    setBusy(true);
    try {
      const body: CreateStandupInput = {
        name: name.trim(),
        channelId,
        timeOfDay,
        days,
        tzOffsetMin: -new Date().getTimezoneOffset(),
        memberIds,
      };
      await api('POST', `/workspaces/${workspaceId}/standups`, body);
      await qc.invalidateQueries({ queryKey: keys.standups(workspaceId) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

  return (
    <div className="mb-4 rounded-lg border border-line p-3 dark:border-line">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Name</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily standup" data-testid="standup-name" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Channel</label>
          <select className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Time (your timezone)</label>
          <input type="time" className={input} value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Days</label>
          <div className="flex gap-1">
            {DAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={clsx(
                  'h-7 w-8 rounded text-[11px] font-semibold',
                  days.includes(d)
                    ? 'bg-accent text-white'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800',
                )}
              >
                {label[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="mb-1 mt-2 block text-xs text-gray-500">Participants</label>
      <div className="mb-3 max-h-40 overflow-y-auto rounded-md border border-line p-1 dark:border-line">
        {candidates.map((m) => (
          <label key={m.user.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-hovered">
            <input type="checkbox" checked={memberIds.includes(m.user.id)} onChange={() => toggleMember(m.user.id)} />
            <Avatar user={m.user} size="xs" />
            <span>{m.user.displayName}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="create-standup"
        >
          {busy ? 'Creating…' : 'Create standup'}
        </button>
        <button onClick={onDone} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-hovered">
          Cancel
        </button>
      </div>
    </div>
  );
}
