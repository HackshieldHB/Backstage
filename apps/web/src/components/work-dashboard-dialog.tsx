'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileText,
  Gauge,
  LayoutDashboard,
  Loader2,
  Play,
  Plus,
  Trash2,
  UserX,
  X,
} from 'lucide-react';
import type {
  ChannelDto,
  JiraBucket,
  JiraDashboardIssue,
  JiraDashboardStats,
  MirrorGadgetDto,
  WorkDashboardDto,
} from '@backstages/shared';
import { api } from '@/lib/api';
import {
  keys,
  useJiraAlerts,
  useJiraDashboards,
  useJiraDashboardView,
  useJiraSprint,
  useWorkDashboard,
} from '@/hooks/queries';

const input =
  'w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

const PRIORITY_COLOR: Record<string, string> = {
  Highest: 'bg-red-600',
  High: 'bg-orange-500',
  Medium: 'bg-amber-500',
  Low: 'bg-sky-500',
  Lowest: 'bg-gray-400',
  None: 'bg-gray-300 dark:bg-gray-600',
};
const CAT_COLOR = { todo: 'bg-slate-400', inProgress: 'bg-blue-500', done: 'bg-green-500' } as const;

function ago(iso: string | null): string {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

type Tab = 'dashboard' | 'overview' | 'sprint' | 'confluence' | 'alerts';

/** The full dashboard (tabs + content), reused inside the full-page DashboardPane. */
export function WorkDashboardBody({
  workspaceId,
  channels,
}: {
  workspaceId: string;
  channels: ChannelDto[];
}) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'overview', label: 'Overview' },
    { id: 'sprint', label: 'Sprint' },
    { id: 'confluence', label: 'Confluence' },
    { id: 'alerts', label: 'Alerts' },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'px-3 py-2 text-sm font-medium',
              tab === t.id ? 'border-b-2 border-accent text-accent' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200',
            )}
            data-testid={`dashboard-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab workspaceId={workspaceId} />}
      {tab === 'overview' && <Overview workspaceId={workspaceId} />}
      {tab === 'sprint' && <SprintTab workspaceId={workspaceId} />}
      {tab === 'confluence' && <ConfluenceTab workspaceId={workspaceId} />}
      {tab === 'alerts' && <AlertsTab workspaceId={workspaceId} channels={channels} />}
    </div>
  );
}

// ---------------- Dashboard (mirror of the real Jira dashboards) ----------------

export function DashboardTab({ workspaceId }: { workspaceId: string }) {
  const list = useJiraDashboards(workspaceId);
  const [selected, setSelected] = useState<string>('');
  const dashboards = list.data ?? [];
  const activeId = selected || dashboards[0]?.id || '';
  const view = useJiraDashboardView(workspaceId, activeId, !!activeId);

  if (list.isLoading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading your Jira dashboards…</div>;
  }
  if (dashboards.length === 0) {
    return <p className="rounded-lg border border-dashed border-line-strong py-8 text-center text-sm text-gray-500 dark:border-line">No Jira dashboards found (or this workspace isn&apos;t connected to Atlassian).</p>;
  }

  const v = view.data;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {dashboards.length > 1 ? (
          <select className={input + ' max-w-xs'} value={activeId} onChange={(e) => setSelected(e.target.value)} data-testid="dashboard-select">
            {dashboards.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-semibold">{dashboards[0].name}</span>
        )}
        {v && (
          <a href={v.viewUrl} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            Open in Jira <ExternalLink size={12} />
          </a>
        )}
      </div>

      <p className="mb-3 text-[11px] text-gray-400">
        Mirrors your real Jira dashboard. Gadgets we can recompute (Assigned to Me, filter-based) are
        shown live; the rest open in Jira — Atlassian doesn&apos;t expose their rendered content via API.
      </p>

      {view.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading gadgets…</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(v?.gadgets ?? []).map((g) => <GadgetCard key={g.id} gadget={g} jiraUrl={v!.viewUrl} />)}
        </div>
      )}
    </div>
  );
}

function GadgetCard({ gadget, jiraUrl }: { gadget: MirrorGadgetDto; jiraUrl: string }) {
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-xs font-semibold text-gray-600 dark:border-line dark:text-gray-300">
        <LayoutDashboard size={13} /> {gadget.title}
      </div>
      <div className="p-3">
        {gadget.kind === 'issues' ? (
          <IssueList title="" issues={gadget.issues ?? []} empty="Nothing here." />
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
            <span>{gadget.note ?? 'Viewable in Jira'}</span>
            <a href={jiraUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 rounded border border-accent px-2 py-0.5 font-medium text-accent hover:bg-accent/10">
              Open in Jira <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfluenceTab({ workspaceId }: { workspaceId: string }) {
  const q = useWorkDashboard(workspaceId, 'all');
  if (q.isLoading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading Confluence…</div>;
  }
  if (q.data && !q.data.connected) {
    return <p className="rounded-lg border border-dashed border-line-strong py-8 text-center text-sm text-gray-500 dark:border-line">Not connected to Atlassian.</p>;
  }
  if (!q.data) return null;
  return <ConfluenceSection dash={q.data.confluence} />;
}

// ---------------- Overview ----------------

export function Overview({ workspaceId }: { workspaceId: string }) {
  const [scope, setScope] = useState<'all' | 'me'>('all');
  const q = useWorkDashboard(workspaceId, scope);
  const data = q.data;

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Loading live data from Atlassian…
      </div>
    );
  }
  if (data && !data.connected) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong py-8 text-center text-sm text-gray-500 dark:border-line">
        This workspace isn&apos;t connected to Atlassian yet. A workspace admin can connect it from the
        Workspace menu → Connect Atlassian.
      </p>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-md border border-line p-0.5 text-xs dark:border-line">
          {(['all', 'me'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={clsx('rounded px-2.5 py-1 font-medium', scope === s ? 'bg-accent text-white' : 'text-gray-500')}
              data-testid={`scope-${s}`}
            >
              {s === 'all' ? 'All issues' : 'My issues'}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">{data.jira.projectCount} projects</span>
      </div>

      {scope === 'me' && !data.personalLinked && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Connect your own Atlassian account (Workspace menu → Connect Atlassian) to filter these to
          issues assigned to you.
        </p>
      )}

      <JiraStats workspaceId={workspaceId} scope={scope} dash={data.jira} />
      <Widgets workspaceId={workspaceId} dash={data.jira} scope={scope} />
    </div>
  );
}

function JiraStats({
  workspaceId,
  scope,
  dash,
}: {
  workspaceId: string;
  scope: 'all' | 'me';
  dash: WorkDashboardDto['jira'];
}) {
  const s = dash.stats;
  const [drill, setDrill] = useState<{ bucket: JiraBucket; label: string } | null>(null);
  const tiles: { key: keyof JiraDashboardStats & JiraBucket; label: string; icon: React.ReactNode; tone: string }[] = [
    { key: 'todo', label: 'To Do', icon: <CircleDashed size={15} />, tone: 'text-slate-600 dark:text-slate-300' },
    { key: 'inProgress', label: 'In Progress', icon: <Loader2 size={15} />, tone: 'text-blue-600 dark:text-blue-400' },
    { key: 'overdue', label: 'Overdue', icon: <AlertTriangle size={15} />, tone: 'text-red-600 dark:text-red-400' },
    { key: 'dueThisWeek', label: 'Due this week', icon: <CalendarClock size={15} />, tone: 'text-amber-600 dark:text-amber-400' },
    { key: 'unassigned', label: 'Unassigned', icon: <UserX size={15} />, tone: 'text-purple-600 dark:text-purple-400' },
    { key: 'createdLast7d', label: 'Created (7d)', icon: <Plus size={15} />, tone: 'text-accent' },
    { key: 'resolvedLast7d', label: 'Resolved (7d)', icon: <CheckCircle2 size={15} />, tone: 'text-green-600 dark:text-green-400' },
  ];

  return (
    <section>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => setDrill({ bucket: t.key, label: t.label })}
            className="rounded-lg border border-line p-2.5 text-left hover:border-accent dark:border-line"
            data-testid={`stat-${t.key}`}
          >
            <div className={`flex items-center gap-1 ${t.tone}`}>{t.icon}<span className="text-lg font-bold">{s[t.key]}</span></div>
            <div className="mt-0.5 text-[11px] text-gray-500">{t.label}</div>
          </button>
        ))}
      </div>

      {dash.priorityMix.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-gray-500">Priority mix (recent open issues)</div>
          <div className="flex h-2.5 overflow-hidden rounded-full">
            {dash.priorityMix.map((p) => (
              <div
                key={p.label}
                className={PRIORITY_COLOR[p.label] ?? 'bg-gray-300'}
                style={{ width: `${(p.count / dash.priorityMix.reduce((a, b) => a + b.count, 0)) * 100}%` }}
                title={`${p.label}: ${p.count}`}
              />
            ))}
          </div>
        </div>
      )}

      {drill ? (
        <DrillDown workspaceId={workspaceId} scope={scope} bucket={drill.bucket} label={drill.label} onClose={() => setDrill(null)} />
      ) : (
        <IssueList title="Recently updated" issues={dash.recent} empty="No open issues." />
      )}
    </section>
  );
}

function DrillDown({
  workspaceId,
  scope,
  bucket,
  label,
  onClose,
}: {
  workspaceId: string;
  scope: 'all' | 'me';
  bucket: JiraBucket;
  label: string;
  onClose: () => void;
}) {
  const [issues, setIssues] = useState<JiraDashboardIssue[] | null>(null);
  useEffect(() => {
    let live = true;
    setIssues(null);
    void api<JiraDashboardIssue[]>('GET', `/workspaces/${workspaceId}/atlassian/issues?bucket=${bucket}&scope=${scope}`).then((r) => {
      if (live) setIssues(r);
    });
    return () => {
      live = false;
    };
  }, [workspaceId, bucket, scope]);
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">{label}</span>
        <button onClick={onClose} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600">
          <X size={11} /> back to recent
        </button>
      </div>
      {issues === null ? (
        <div className="flex items-center gap-2 py-4 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" /> Loading…</div>
      ) : (
        <IssueList title="" issues={issues} empty="Nothing here — nice." />
      )}
    </div>
  );
}

function IssueList({ title, issues, empty }: { title: string; issues: JiraDashboardIssue[]; empty: string }) {
  return (
    <div className={title ? 'mt-3' : ''}>
      {title && <div className="mb-1 text-[11px] font-medium text-gray-500">{title}</div>}
      <ul className="space-y-1">
        {issues.map((i) => (
          <li key={i.key}>
            <a
              href={i.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hovered"
            >
              <span className="shrink-0 font-mono text-xs font-semibold text-accent">{i.key}</span>
              <span className="min-w-0 flex-1 truncate">{i.summary}</span>
              {i.priority && <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLOR[i.priority] ?? 'bg-gray-300'}`} title={i.priority} />}
              {i.status && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">{i.status}</span>}
              <ExternalLink size={12} className="shrink-0 text-gray-300 group-hover:text-gray-500" />
            </a>
          </li>
        ))}
        {issues.length === 0 && <li className="px-2 py-2 text-xs text-gray-400">{empty}</li>}
      </ul>
    </div>
  );
}

function Widgets({
  workspaceId,
  dash,
  scope,
}: {
  workspaceId: string;
  dash: WorkDashboardDto['jira'];
  scope: 'all' | 'me';
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [jql, setJql] = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: keys.workDashboard(workspaceId, scope) });
  const add = async () => {
    if (!label.trim() || !jql.trim()) return;
    await api('POST', `/workspaces/${workspaceId}/atlassian/widgets`, { label: label.trim(), jql: jql.trim() });
    setLabel('');
    setJql('');
    setAdding(false);
    await refresh();
  };
  const remove = async (id: string) => {
    await api('DELETE', `/atlassian/widgets/${id}`);
    await refresh();
  };

  return (
    <section className="border-t border-line pt-4 dark:border-line">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Gauge size={14} /> Custom widgets</h3>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <Plus size={13} /> Add
        </button>
      </div>

      {adding && (
        <div className="mb-2 space-y-2 rounded-lg border border-line p-2.5 dark:border-line">
          <input className={input} placeholder="Label (e.g. Blocked bugs)" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="widget-label" />
          <input className={input} placeholder='JQL (e.g. labels = blocked AND statusCategory != Done)' value={jql} onChange={(e) => setJql(e.target.value)} data-testid="widget-jql" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-hovered">Cancel</button>
            <button onClick={() => void add()} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-hover" data-testid="widget-save">Save</button>
          </div>
        </div>
      )}

      {dash.widgets.length === 0 && !adding ? (
        <p className="text-[11px] text-gray-400">Pin a saved JQL query as a live count — like a Jira dashboard gadget.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {dash.widgets.map((w) => (
            <div key={w.id} className="group relative rounded-lg border border-line p-2.5 dark:border-line" title={w.jql}>
              <div className={clsx('text-lg font-bold', w.failed ? 'text-red-500' : 'text-accent')}>{w.failed ? '—' : w.count}</div>
              <div className="mt-0.5 truncate text-[11px] text-gray-500">{w.label}</div>
              {w.failed && <div className="text-[10px] text-red-400">invalid JQL</div>}
              <button onClick={() => void remove(w.id)} className="absolute right-1 top-1 rounded p-0.5 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConfluenceSection({ dash }: { dash: WorkDashboardDto['confluence'] }) {
  return (
    <section className="border-t border-line pt-4 dark:border-line">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Confluence</h3>
        {dash.ready && <span className="text-xs text-gray-400">{dash.spaceCount} spaces</span>}
      </div>
      {!dash.ready ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-3 text-xs text-gray-500 dark:border-line">
          The Atlassian connection is missing Confluence access. A workspace admin can reconnect
          Atlassian to grant Confluence permissions.
        </p>
      ) : (
        <ul className="space-y-1">
          {dash.recentPages.map((p) => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hovered">
                <FileText size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="shrink-0 text-[11px] text-gray-400">{ago(p.updatedAt)}</span>
                <ExternalLink size={12} className="shrink-0 text-gray-300 group-hover:text-gray-500" />
              </a>
            </li>
          ))}
          {dash.recentPages.length === 0 && <li className="px-2 py-2 text-xs text-gray-400">No recent pages.</li>}
        </ul>
      )}
    </section>
  );
}

// ---------------- Sprint ----------------

export function SprintTab({ workspaceId }: { workspaceId: string }) {
  const q = useJiraSprint(workspaceId);
  if (q.isLoading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading sprints…</div>;
  }
  const data = q.data;
  if (!data || !data.hasSprint) {
    return <p className="rounded-lg border border-dashed border-line-strong py-8 text-center text-sm text-gray-500 dark:border-line">No active sprint on the connected boards.</p>;
  }
  return (
    <div className="space-y-4">
      {data.sprints.map((sp, idx) => {
        const total = sp.todo + sp.inProgress + sp.done || 1;
        return (
          <section key={idx} className="rounded-lg border border-line p-3 dark:border-line">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{sp.sprintName}</div>
                <div className="text-[11px] text-gray-400">{sp.boardName}{sp.endDate ? ` · ends ${ago(sp.endDate)}` : ''}</div>
              </div>
              <div className="text-[11px] text-gray-500">{sp.done}/{total} done</div>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full">
              {(['done', 'inProgress', 'todo'] as const).map((c) => (
                <div key={c} className={CAT_COLOR[c]} style={{ width: `${(sp[c] / total) * 100}%` }} title={`${c}: ${sp[c]}`} />
              ))}
            </div>
            <div className="mt-1 flex gap-3 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${CAT_COLOR.todo}`} /> To Do {sp.todo}</span>
              <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${CAT_COLOR.inProgress}`} /> In Progress {sp.inProgress}</span>
              <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${CAT_COLOR.done}`} /> Done {sp.done}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {sp.issues.map((i) => (
                <li key={i.key}>
                  <a href={i.url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-hovered">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${CAT_COLOR[i.statusCategory]}`} />
                    <span className="shrink-0 font-mono text-xs font-semibold text-accent">{i.key}</span>
                    <span className="min-w-0 flex-1 truncate">{i.summary}</span>
                    {i.status && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">{i.status}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ---------------- Alerts ----------------

export function AlertsTab({ workspaceId, channels }: { workspaceId: string; channels: ChannelDto[] }) {
  const qc = useQueryClient();
  const q = useJiraAlerts(workspaceId);
  const rules = q.data ?? [];
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [staleDays, setStaleDays] = useState(7);
  const [timeOfDay, setTimeOfDay] = useState('09:00');

  const refresh = () => qc.invalidateQueries({ queryKey: keys.jiraAlerts(workspaceId) });
  const create = async () => {
    if (!channelId) return;
    await api('POST', `/workspaces/${workspaceId}/atlassian/alerts`, {
      channelId,
      staleDays,
      timeOfDay,
      tzOffsetMin: -new Date().getTimezoneOffset(),
    });
    await refresh();
  };
  const remove = async (id: string) => {
    await api('DELETE', `/atlassian/alerts/${id}`);
    await refresh();
  };
  const run = (id: string) => api('POST', `/atlassian/alerts/${id}/run`);

  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">
        Post a daily digest of overdue, stale and unassigned Jira issues to a channel — so nothing rots
        silently.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line p-3 dark:border-line">
        <label className="text-xs text-gray-500">
          Channel
          <select className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Stale after (days)
          <input type="number" min={1} max={90} className={input} value={staleDays} onChange={(e) => setStaleDays(Number(e.target.value))} />
        </label>
        <label className="text-xs text-gray-500">
          Time
          <input type="time" className={input} value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
        </label>
        <button onClick={() => void create()} className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover" data-testid="create-alert">
          <Plus size={14} /> Add
        </button>
      </div>

      <ul className="space-y-2">
        {rules.map((r) => {
          const channel = channels.find((c) => c.id === r.channelId);
          return (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 dark:border-line">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent"><Bell size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">#{channel?.name ?? 'channel'}</div>
                <div className="text-xs text-gray-500">daily {r.timeOfDay} · stale &gt; {r.staleDays}d{!r.active && ' · paused'}</div>
              </div>
              <button onClick={() => void run(r.id)} title="Send now" className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-accent dark:hover:bg-gray-800"><Play size={14} /></button>
              <button onClick={() => void remove(r.id)} className="rounded p-1 text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
            </li>
          );
        })}
        {q.isSuccess && rules.length === 0 && (
          <li className="rounded-lg border border-dashed border-line-strong py-6 text-center text-sm text-gray-500 dark:border-line">No alert rules yet.</li>
        )}
      </ul>
    </div>
  );
}
