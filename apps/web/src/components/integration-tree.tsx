'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, FileText, Search, SquareKanban, UserCheck } from 'lucide-react';
import {
  useConfluencePages,
  useConfluenceSpaces,
  useJiraIssues,
  useJiraProjects,
  useMyJiraIssues,
} from '@/hooks/queries';

function openUrl(url?: string | null) {
  if (url) window.open(url, '_blank', 'noopener');
}

/** Case-insensitive "does any field contain the query" match. */
function match(query: string, ...fields: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

function SectionCaret({ open }: { open: boolean }) {
  return <ChevronDown size={12} className={clsx('shrink-0 transition-transform', !open && '-rotate-90')} />;
}

function Header({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="mt-4 flex w-full items-center gap-1 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted hover:text-white"
    >
      <SectionCaret open={open} />
      {label}
    </button>
  );
}

function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2 py-1">
      <Search size={12} className="shrink-0 text-sidebar-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[12px] text-gray-100 placeholder:text-sidebar-muted focus:outline-none"
      />
    </div>
  );
}

const rowCls =
  'group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] text-sidebar-muted hover:bg-sidebar-hover hover:text-gray-100';

// ---------- Jira: projects → issues ----------

export function JiraTree({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const projects = useJiraProjects(workspaceId, open);
  const visible = (projects.data ?? []).filter((p) => match(filter, p.key, p.name));

  return (
    <div data-testid="jira-tree">
      <Header label="Jira" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <>
          <FilterInput value={filter} onChange={setFilter} placeholder="Search projects & issues" />
          <ul>
            <MyIssuesRow workspaceId={workspaceId} filter={filter} />
            {projects.isLoading && <li className="px-4 py-1 text-[12px] text-sidebar-muted">Loading…</li>}
            {visible.map((p) => (
              <JiraProjectRow
                key={p.id}
                workspaceId={workspaceId}
                projectKey={p.key}
                name={p.name}
                filter={filter}
              />
            ))}
            {!projects.isLoading && visible.length === 0 && (
              <li className="px-4 py-1 text-[12px] text-sidebar-muted">No matches</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/** "Assigned to me" — the daily work queue, pinned above the project list. */
function MyIssuesRow({ workspaceId, filter }: { workspaceId: string; filter: string }) {
  const [open, setOpen] = useState(true);
  const mine = useMyJiraIssues(workspaceId, open);
  const visible = (mine.data ?? []).filter((i) => match(filter, i.key, i.summary));

  return (
    <li data-testid="jira-my-issues">
      <button onClick={() => setOpen((v) => !v)} className={clsx(rowCls, 'pl-2')}>
        <SectionCaret open={open} />
        <UserCheck size={13} className="shrink-0 text-[#2684FF]" />
        <span className="truncate font-medium">Assigned to me</span>
        {mine.data && mine.data.length > 0 && (
          <span className="ml-auto shrink-0 rounded bg-white/10 px-1 text-[10px]">
            {mine.data.length}
          </span>
        )}
      </button>
      {open && (
        <ul>
          {mine.isLoading && <li className="py-1 pl-9 text-[12px] text-sidebar-muted">Loading…</li>}
          {/* Not linked yet is the common case here, not a failure. */}
          {mine.isError && (
            <li className="py-1 pl-9 pr-2 text-[12px] text-sidebar-muted">
              Connect your Atlassian account to see your issues.
            </li>
          )}
          {visible.map((i) => (
            <li key={i.key}>
              <button onClick={() => openUrl(i.url)} className={clsx(rowCls, 'pl-9')} title={i.summary}>
                <span className="shrink-0 font-mono text-[11px] text-sidebar-muted">{i.key}</span>
                <span className="truncate">{i.summary}</span>
                {i.overdue && (
                  <span className="ml-auto shrink-0 rounded bg-red-500/20 px-1 text-[10px] font-bold uppercase text-red-300">
                    Overdue
                  </span>
                )}
                {!i.overdue && i.status && (
                  <span className="ml-auto shrink-0 rounded bg-white/10 px-1 text-[10px] uppercase">
                    {i.status}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!mine.isLoading && !mine.isError && visible.length === 0 && (
            <li className="py-1 pl-9 text-[12px] text-sidebar-muted">
              {filter ? 'No matching issues' : 'Nothing assigned to you'}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function JiraProjectRow({
  workspaceId,
  projectKey,
  name,
  filter,
}: {
  workspaceId: string;
  projectKey: string;
  name: string;
  filter: string;
}) {
  const [open, setOpen] = useState(false);
  const issues = useJiraIssues(workspaceId, projectKey, open);
  const visible = (issues.data ?? []).filter((i) => match(filter, i.key, i.summary));
  return (
    <li>
      <button onClick={() => setOpen((v) => !v)} className={clsx(rowCls, 'pl-2')} title={name}>
        <SectionCaret open={open} />
        <SquareKanban size={13} className="shrink-0 text-[#2684FF]" />
        <span className="truncate font-medium">{projectKey}</span>
        <span className="truncate text-sidebar-muted">· {name}</span>
      </button>
      {open && (
        <ul>
          {issues.isLoading && <li className="py-1 pl-9 text-[12px] text-sidebar-muted">Loading…</li>}
          {visible.map((i) => (
            <li key={i.key}>
              <button onClick={() => openUrl(i.url)} className={clsx(rowCls, 'pl-9')} title={i.summary}>
                <span className="shrink-0 font-mono text-[11px] text-sidebar-muted">{i.key}</span>
                <span className="truncate">{i.summary}</span>
                {i.status && (
                  <span className="ml-auto shrink-0 rounded bg-white/10 px-1 text-[10px] uppercase">
                    {i.status}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!issues.isLoading && visible.length === 0 && (
            <li className="py-1 pl-9 text-[12px] text-sidebar-muted">
              {filter ? 'No matching issues' : 'No issues'}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

// ---------- Confluence: spaces → pages ----------

export function ConfluenceTree({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const spaces = useConfluenceSpaces(workspaceId, open);
  const visible = (spaces.data ?? []).filter((s) => match(filter, s.key, s.name));

  return (
    <div data-testid="confluence-tree">
      <Header label="Confluence" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <>
          <FilterInput value={filter} onChange={setFilter} placeholder="Search spaces & pages" />
          <ul>
            {spaces.isLoading && <li className="px-4 py-1 text-[12px] text-sidebar-muted">Loading…</li>}
            {visible.map((s) => (
              <ConfluenceSpaceRow
                key={s.key}
                workspaceId={workspaceId}
                spaceKey={s.key}
                name={s.name}
                filter={filter}
              />
            ))}
            {!spaces.isLoading && visible.length === 0 && (
              <li className="px-4 py-1 text-[12px] text-sidebar-muted">No matches</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function ConfluenceSpaceRow({
  workspaceId,
  spaceKey,
  name,
  filter,
}: {
  workspaceId: string;
  spaceKey: string;
  name: string;
  filter: string;
}) {
  const [open, setOpen] = useState(false);
  const pages = useConfluencePages(workspaceId, spaceKey, open);
  const visible = (pages.data ?? []).filter((p) => match(filter, p.title));
  return (
    <li>
      <button onClick={() => setOpen((v) => !v)} className={clsx(rowCls, 'pl-2')} title={name}>
        <SectionCaret open={open} />
        <FileText size={13} className="shrink-0 text-[#2684FF]" />
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-sidebar-muted">· {spaceKey}</span>
      </button>
      {open && (
        <ul>
          {pages.isLoading && <li className="py-1 pl-9 text-[12px] text-sidebar-muted">Loading…</li>}
          {visible.map((p) => (
            <li key={p.id}>
              <button onClick={() => openUrl(p.url)} className={clsx(rowCls, 'pl-9')} title={p.title}>
                <FileText size={12} className="shrink-0 text-sidebar-muted" />
                <span className="truncate">{p.title}</span>
              </button>
            </li>
          ))}
          {!pages.isLoading && visible.length === 0 && (
            <li className="py-1 pl-9 text-[12px] text-sidebar-muted">
              {filter ? 'No matching pages' : 'No pages'}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
