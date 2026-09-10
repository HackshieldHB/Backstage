'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, SquareKanban, Timer, UserCheck } from 'lucide-react';
import clsx from 'clsx';
import { useChannels, useJiraIssues, useJiraProjects, useMyJiraIssues } from '@/hooks/queries';
import { LogTimeDialog } from './log-time-dialog';
import { PaneShell } from './pane-shell';
import { AlertsTab, DashboardTab, Overview, SprintTab } from './work-dashboard-dialog';

type JiraTab = 'issues' | 'dashboard' | 'overview' | 'sprint' | 'alerts';

/** The Jira home: browse issues, plus the mirrored Jira dashboard, overview,
 *  sprint and alert rules — all under one tabbed pane. */
export function JiraPane({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<JiraTab>('issues');
  const channels = useChannels(workspaceId);
  const tabs: { id: JiraTab; label: string }[] = [
    { id: 'issues', label: 'Issues' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'overview', label: 'Overview' },
    { id: 'sprint', label: 'Sprint' },
    { id: 'alerts', label: 'Alerts' },
  ];

  return (
    <PaneShell icon={<SquareKanban size={18} className="text-[#2684FF]" />} title="Jira">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex gap-1 border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'px-3 py-2 text-sm font-medium',
                tab === t.id ? 'border-b-2 border-accent text-accent' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200',
              )}
              data-testid={`jira-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'issues' && <IssuesBrowser workspaceId={workspaceId} />}
        {tab === 'dashboard' && <DashboardTab workspaceId={workspaceId} />}
        {tab === 'overview' && <Overview workspaceId={workspaceId} />}
        {tab === 'sprint' && <SprintTab workspaceId={workspaceId} />}
        {tab === 'alerts' && <AlertsTab workspaceId={workspaceId} channels={channels.data ?? []} />}
      </div>
    </PaneShell>
  );
}

/** The classic issue browser: source picker on the left, issue list on the right. */
function IssuesBrowser({ workspaceId }: { workspaceId: string }) {
  const [selected, setSelected] = useState<'mine' | string>('mine');
  const [filter, setFilter] = useState('');
  const projects = useJiraProjects(workspaceId, true);

  return (
    <div className="flex gap-4">
      {/* Left rail: source selector */}
      <div className="w-52 shrink-0">
        <button
          onClick={() => setSelected('mine')}
          className={clsx(
            'mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]',
            selected === 'mine'
              ? 'bg-accent/10 font-medium text-accent'
              : 'hover:bg-hovered',
          )}
        >
          <UserCheck size={14} /> Assigned to me
        </button>
        <p className="mb-1 mt-3 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Projects
        </p>
        {projects.isLoading && <p className="px-2.5 text-[12px] text-gray-400">Loading…</p>}
        {projects.data?.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.key)}
            title={p.name}
            className={clsx(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]',
              selected === p.key
                ? 'bg-accent/10 font-medium text-accent'
                : 'hover:bg-hovered',
            )}
          >
            <span className="shrink-0 font-mono text-[11px] text-gray-400">{p.key}</span>
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        {projects.data?.length === 0 && (
          <p className="px-2.5 text-[12px] text-gray-400">No projects</p>
        )}
      </div>

      {/* Right: issue list */}
      <div className="min-w-0 flex-1">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter issues…"
          className="mb-3 w-full rounded-md border border-line-strong px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800"
        />
        {selected === 'mine' ? (
          <MyIssues workspaceId={workspaceId} filter={filter} />
        ) : (
          <ProjectIssues workspaceId={workspaceId} projectKey={selected} filter={filter} />
        )}
      </div>
    </div>
  );
}

function MyIssues({ workspaceId, filter }: { workspaceId: string; filter: string }) {
  const mine = useMyJiraIssues(workspaceId, true);
  const rows = useMemo(
    () => (mine.data ?? []).filter((i) => match(filter, i.key, i.summary)),
    [mine.data, filter],
  );
  if (mine.isLoading) return <Empty>Loading…</Empty>;
  if (mine.isError)
    return <Empty>Connect your Atlassian account (Workspace menu → Connect Atlassian) to see your issues.</Empty>;
  if (rows.length === 0) return <Empty>{filter ? 'No matching issues' : 'Nothing assigned to you 🎉'}</Empty>;
  return (
    <ul className="divide-y divide-line dark:divide-line">
      {rows.map((i) => (
        <IssueRow
          key={i.key}
          workspaceId={workspaceId}
          issueKey={i.key}
          summary={i.summary}
          status={i.status}
          url={i.url}
          overdue={i.overdue}
        />
      ))}
    </ul>
  );
}

function ProjectIssues({
  workspaceId,
  projectKey,
  filter,
}: {
  workspaceId: string;
  projectKey: string;
  filter: string;
}) {
  const issues = useJiraIssues(workspaceId, projectKey, true);
  const rows = useMemo(
    () => (issues.data ?? []).filter((i) => match(filter, i.key, i.summary)),
    [issues.data, filter],
  );
  if (issues.isLoading) return <Empty>Loading…</Empty>;
  if (rows.length === 0) return <Empty>{filter ? 'No matching issues' : 'No issues in this project'}</Empty>;
  return (
    <ul className="divide-y divide-line dark:divide-line">
      {rows.map((i) => (
        <IssueRow
          key={i.key}
          workspaceId={workspaceId}
          issueKey={i.key}
          summary={i.summary}
          status={i.status}
          url={i.url}
        />
      ))}
    </ul>
  );
}

function IssueRow({
  workspaceId,
  issueKey,
  summary,
  status,
  url,
  overdue,
}: {
  workspaceId: string;
  issueKey: string;
  summary: string;
  status: string | null;
  url: string;
  overdue?: boolean;
}) {
  const [logOpen, setLogOpen] = useState(false);
  return (
    <li className="group flex items-center gap-2 py-2 text-sm">
      <span className="shrink-0 font-mono text-[11px] text-gray-400">{issueKey}</span>
      <span className="truncate">{summary}</span>
      {overdue ? (
        <span className="ml-auto shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">
          Overdue
        </span>
      ) : status ? (
        <span className="ml-auto shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {status}
        </span>
      ) : (
        <span className="ml-auto" />
      )}
      <button
        onClick={() => setLogOpen(true)}
        className="flex shrink-0 items-center gap-1 rounded border border-line-strong px-2 py-0.5 text-[11px] font-medium text-gray-600 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100 dark:border-line-strong dark:text-gray-300 dark:hover:bg-gray-800"
        title="Log time to this issue"
      >
        <Timer size={12} /> Log time
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
        title="Open in Jira"
      >
        <ExternalLink size={13} />
      </a>
      {logOpen && (
        <LogTimeDialog workspaceId={workspaceId} issueKey={issueKey} onClose={() => setLogOpen(false)} />
      )}
    </li>
  );
}

function match(filter: string, ...fields: string[]): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f.toLowerCase().includes(q));
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-gray-500">{children}</div>;
}
