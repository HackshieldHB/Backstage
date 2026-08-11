'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, SquareKanban, Timer, UserCheck } from 'lucide-react';
import clsx from 'clsx';
import { useJiraIssues, useJiraProjects, useMyJiraIssues } from '@/hooks/queries';
import { LogTimeDialog } from './log-time-dialog';
import { PaneShell } from './pane-shell';

/** A dedicated Jira workspace: pick "Assigned to me" or a project on the left,
 *  browse its issues on the right with open-in-Jira and Log time inline. */
export function JiraPane({ workspaceId }: { workspaceId: string }) {
  const [selected, setSelected] = useState<'mine' | string>('mine');
  const [filter, setFilter] = useState('');
  const projects = useJiraProjects(workspaceId, true);

  return (
    <PaneShell icon={<SquareKanban size={18} className="text-[#2684FF]" />} title="Jira">
      <div className="mx-auto flex max-w-5xl gap-4">
        {/* Left rail: source selector */}
        <div className="w-52 shrink-0">
          <button
            onClick={() => setSelected('mine')}
            className={clsx(
              'mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]',
              selected === 'mine'
                ? 'bg-accent/10 font-medium text-accent'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800',
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
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800',
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
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
          />
          {selected === 'mine' ? (
            <MyIssues workspaceId={workspaceId} filter={filter} />
          ) : (
            <ProjectIssues workspaceId={workspaceId} projectKey={selected} filter={filter} />
          )}
        </div>
      </div>
    </PaneShell>
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
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
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
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
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
        className="flex shrink-0 items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-600 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
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
