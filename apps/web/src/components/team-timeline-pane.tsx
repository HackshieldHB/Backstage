'use client';

import { useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import type { ActivityKind, MeetingInsightsDto, TimelineMemberDto, UtilizationRowDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
import { useMeetingInsights, useMyTimesheet, useTeamTimeline, useUtilization } from '@/hooks/queries';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from './avatar';
import { LogTimeDialog } from './log-time-dialog';
import { PaneShell } from './pane-shell';

/** Colour + label for each activity kind (works in light and dark). */
const KIND_META: Record<ActivityKind, { label: string; color: string; swatch: string }> = {
  MEETING: { label: 'Meeting', color: 'bg-blue-500', swatch: '#3b82f6' },
  IMPLEMENTATION: { label: 'Implementation', color: 'bg-emerald-500', swatch: '#10b981' },
  DOCUMENTATION: { label: 'Documentation', color: 'bg-violet-500', swatch: '#8b5cf6' },
  COLLABORATION: { label: 'Collaboration', color: 'bg-amber-500', swatch: '#f59e0b' },
  AWAY: { label: 'Away', color: 'bg-gray-400', swatch: '#9ca3af' },
  ONLINE: { label: 'No tracked activity', color: 'bg-gray-200 dark:bg-gray-700', swatch: '#e5e7eb' },
  WORK_LOGGED: { label: 'Logged', color: 'bg-teal-500', swatch: '#14b8a6' },
};

const UTIL_KINDS: Array<{ key: keyof UtilizationRowDto; kind: ActivityKind }> = [
  { key: 'meetingSec', kind: 'MEETING' },
  { key: 'implementationSec', kind: 'IMPLEMENTATION' },
  { key: 'documentationSec', kind: 'DOCUMENTATION' },
  { key: 'collaborationSec', kind: 'COLLABORATION' },
  { key: 'idleSec', kind: 'ONLINE' },
];

type RangeKey = 'today' | '24h' | '7d';

function rangeFor(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  if (key === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  const ms = key === '24h' ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
  return { from: new Date(now.getTime() - ms).toISOString(), to: now.toISOString() };
}

function fmtDuration(sec: number): string {
  if (sec <= 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
}

const segBtn = (active: boolean) =>
  `rounded px-2.5 py-1 text-[13px] font-medium ${
    active ? 'bg-white shadow-sm dark:bg-gray-900' : 'text-gray-500 hover:text-gray-700'
  }`;

export function TeamTimelinePane({ workspaceId }: { workspaceId: string }) {
  const [range, setRange] = useState<RangeKey>('today');
  const [tab, setTab] = useState<'timeline' | 'utilization' | 'meetings' | 'mine'>('timeline');
  const [mDays, setMDays] = useState(7);
  const { from, to } = useMemo(() => rangeFor(range), [range]);

  const timeline = useTeamTimeline(workspaceId, from, to, tab === 'timeline');
  const utilization = useUtilization(workspaceId, from, to, tab === 'utilization');
  const meetings = useMeetingInsights(workspaceId, mDays, tab === 'meetings');

  return (
    <PaneShell icon={<Timer size={18} className="text-accent" />} title="Team timeline & utilization">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800">
            {(['timeline', 'utilization', 'meetings', 'mine'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`${segBtn(tab === t)} capitalize`}
                data-testid={`timeline-tab-${t}`}
              >
                {t === 'mine' ? 'My timesheet' : t}
              </button>
            ))}
          </div>
          {(tab === 'timeline' || tab === 'utilization') && (
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800">
              {(['today', '24h', '7d'] as const).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={segBtn(range === r)}>
                  {r === 'today' ? 'Today' : r === '24h' ? '24h' : '7 days'}
                </button>
              ))}
            </div>
          )}
          {tab === 'meetings' && (
            <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800">
              {[7, 30].map((d) => (
                <button key={d} onClick={() => setMDays(d)} className={segBtn(mDays === d)}>
                  {d} days
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === 'timeline' && (
          <TimelineView
            members={timeline.data?.members ?? []}
            from={new Date(from).getTime()}
            to={new Date(to).getTime()}
            loading={timeline.isLoading}
            error={timeline.isError}
          />
        )}
        {tab === 'utilization' && (
          <UtilizationView
            rows={utilization.data?.rows ?? []}
            loading={utilization.isLoading}
            error={utilization.isError}
          />
        )}
        {tab === 'meetings' && (
          <MeetingsView data={meetings.data} loading={meetings.isLoading} error={meetings.isError} />
        )}
        {tab === 'mine' && <MyTimesheet workspaceId={workspaceId} />}

        <p className="mt-6 border-t border-line pt-3 text-[11px] leading-snug text-gray-400 dark:border-line">
          Timeline reflects activity that leaves a trace in Backstages, Jira &amp; Confluence. Gaps mean
          “no tracked activity”, not necessarily idle time — work in other tools isn’t captured. Use
          “My timesheet” to log that manually.
        </p>
      </div>
    </PaneShell>
  );
}

function TimelineView({
  members,
  from,
  to,
  loading,
  error,
}: {
  members: TimelineMemberDto[];
  from: number;
  to: number;
  loading: boolean;
  error: boolean;
}) {
  const span = Math.max(1, to - from);
  if (error) return <Empty>Couldn’t load the timeline.</Empty>;
  if (loading) return <Empty>Loading timeline…</Empty>;
  if (members.length === 0) return <Empty>No members yet.</Empty>;

  return (
    <div>
      <div className="thin-scrollbar overflow-x-auto">
        <div className="min-w-[520px] space-y-1.5">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-2">
              <div className="flex w-40 shrink-0 items-center gap-2">
                <Avatar user={{ id: m.userId, displayName: m.displayName, avatarUrl: m.avatarUrl }} size="xs" />
                <span className="truncate text-[13px]">{m.displayName}</span>
              </div>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-hovered">
                {m.segments.map((s, i) => {
                  const start = new Date(s.startedAt).getTime();
                  const end = new Date(s.endedAt).getTime();
                  const left = ((start - from) / span) * 100;
                  const width = ((end - start) / span) * 100;
                  if (width <= 0) return null;
                  const meta = KIND_META[s.kind];
                  return (
                    <div
                      key={i}
                      className={`absolute top-0 h-full ${meta.color}`}
                      style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100, width)}%` }}
                      title={`${meta.label} · ${fmtDuration((end - start) / 1000)}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Legend kinds={['MEETING', 'IMPLEMENTATION', 'DOCUMENTATION', 'COLLABORATION', 'AWAY', 'ONLINE']} />
    </div>
  );
}

function UtilizationView({
  rows,
  loading,
  error,
}: {
  rows: UtilizationRowDto[];
  loading: boolean;
  error: boolean;
}) {
  if (error) return <Empty>Couldn’t load utilization.</Empty>;
  if (loading) return <Empty>Loading utilization…</Empty>;
  if (rows.length === 0) return <Empty>No members yet.</Empty>;

  return (
    <div>
      <div className="space-y-3">
        {rows.map((r) => {
          const active = r.meetingSec + r.implementationSec + r.documentationSec + r.collaborationSec;
          const denom = Math.max(1, r.onlineSec);
          const utilPct = Math.round((active / denom) * 100);
          return (
            <div key={r.userId}>
              <div className="mb-1 flex items-center gap-2">
                <Avatar user={{ id: r.userId, displayName: r.displayName, avatarUrl: r.avatarUrl }} size="xs" />
                <span className="text-[13px] font-medium">{r.displayName}</span>
                <span className="ml-auto text-[12px] text-gray-500">
                  {utilPct}% active · {fmtDuration(r.onlineSec)} online
                  {r.loggedSec > 0 && ` · ${fmtDuration(r.loggedSec)} logged`}
                </span>
              </div>
              <div className="flex h-5 w-full overflow-hidden rounded bg-hovered">
                {UTIL_KINDS.map(({ key, kind }) => {
                  const sec = r[key] as number;
                  const pct = (sec / denom) * 100;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={kind}
                      className={KIND_META[kind].color}
                      style={{ width: `${Math.min(100, pct)}%` }}
                      title={`${KIND_META[kind].label} · ${fmtDuration(sec)}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <Legend kinds={['MEETING', 'IMPLEMENTATION', 'DOCUMENTATION', 'COLLABORATION', 'ONLINE']} />
    </div>
  );
}

function MyTimesheet({ workspaceId }: { workspaceId: string }) {
  const timesheet = useMyTimesheet(workspaceId);
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [logOpen, setLogOpen] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);

  const retry = async (id: string) => {
    setSyncing(id);
    try {
      await api('POST', `/timesheet/entries/${id}/sync`);
      await qc.invalidateQueries({ queryKey: ['timesheet', workspaceId] });
      pushToast('Synced to Jira.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Sync failed', 'error');
    } finally {
      setSyncing(null);
    }
  };

  const entries = timesheet.data ?? [];
  return (
    <div className="max-w-2xl">
      <button
        onClick={() => setLogOpen(true)}
        className="mb-3 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
        data-testid="open-log-time"
      >
        Log time
      </button>
      {timesheet.isLoading ? (
        <Empty>Loading…</Empty>
      ) : entries.length === 0 ? (
        <Empty>No time logged yet. Use “Log time” to record work against a Jira issue.</Empty>
      ) : (
        <ul className="divide-y divide-line dark:divide-line">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="font-medium">{e.issueKey}</span>
              <span className="text-gray-500">{fmtDuration(e.minutes * 60)}</span>
              <span className="text-[12px] text-gray-400">{new Date(e.startedAt).toLocaleString()}</span>
              {e.comment && <span className="truncate text-[12px] text-gray-400">— {e.comment}</span>}
              <span className="ml-auto shrink-0">
                {e.synced ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                    In Jira
                  </span>
                ) : (
                  <button
                    onClick={() => void retry(e.id)}
                    disabled={syncing === e.id}
                    className="rounded border border-amber-400 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-50 dark:hover:bg-amber-950"
                  >
                    {syncing === e.id ? 'Syncing…' : 'Retry sync'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {logOpen && <LogTimeDialog workspaceId={workspaceId} onClose={() => setLogOpen(false)} />}
    </div>
  );
}

function MeetingsView({
  data,
  loading,
  error,
}: {
  data?: MeetingInsightsDto;
  loading: boolean;
  error: boolean;
}) {
  if (error) return <Empty>Couldn’t load meeting analytics.</Empty>;
  if (loading || !data) return <Empty>Loading meeting analytics…</Empty>;
  if (data.totalMeetings === 0) return <Empty>No huddles in this window yet.</Empty>;

  const maxMember = Math.max(1, ...data.byMember.map((m) => m.minutes));
  const maxDay = Math.max(1, ...data.byDay.map((d) => d.minutes));

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Meetings" value={String(data.totalMeetings)} sub={`in ${data.rangeDays} days`} />
        <Kpi label="Total time" value={fmtDuration(data.totalMinutes * 60)} sub="participant-time" />
        <Kpi label="Avg length" value={fmtDuration(data.avgMeetingMinutes * 60)} sub="per meeting" />
      </div>

      {/* Per-day meeting minutes */}
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Meeting time per day</h3>
        <div className="flex items-end gap-1.5" style={{ height: 96 }}>
          {data.byDay.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${fmtDuration(d.minutes * 60)} · ${d.meetings} meeting(s)`}>
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-blue-500/80"
                  style={{ height: `${(d.minutes / maxDay) * 100}%`, minHeight: d.minutes > 0 ? 3 : 0 }}
                />
              </div>
              <span className="text-[9px] text-gray-400">{d.date.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-member load */}
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Meeting load by person</h3>
        <div className="space-y-2">
          {data.byMember.map((m) => (
            <div key={m.userId} className="flex items-center gap-2">
              <div className="flex w-40 shrink-0 items-center gap-2">
                <Avatar user={{ id: m.userId, displayName: m.displayName, avatarUrl: m.avatarUrl }} size="xs" />
                <span className="truncate text-[13px]">{m.displayName}</span>
              </div>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-hovered">
                <div className="absolute left-0 top-0 h-full rounded bg-blue-500/80" style={{ width: `${(m.minutes / maxMember) * 100}%` }} />
              </div>
              <span className="w-28 shrink-0 text-right text-[12px] text-gray-500">
                {fmtDuration(m.minutes * 60)} · {m.meetings}×
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-snug text-gray-400">
        Counts time spent in huddles (voice/video). “Participant-time” sums everyone’s minutes, so a
        30-min call with 4 people is 2h of meeting load — useful for spotting meeting overload.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold text-ink">{value}</div>
      <div className="text-[11px] text-gray-400">{sub}</div>
    </div>
  );
}

function Legend({ kinds }: { kinds: ActivityKind[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
      {kinds.map((k) => (
        <span key={k} className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: KIND_META[k].swatch }} />
          {KIND_META[k].label}
        </span>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-gray-500">{children}</div>;
}
