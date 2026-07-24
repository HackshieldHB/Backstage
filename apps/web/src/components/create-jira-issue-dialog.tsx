'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useJiraProjects } from '@/hooks/queries';
import { Dialog } from './dialog';

const JIRA_PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'] as const;
export type JiraPriority = (typeof JIRA_PRIORITIES)[number];

export interface CreateIssueInput {
  projectKey: string;
  summary: string;
  priority: JiraPriority;
}

/** Shared create-issue form: project dropdown (from the workspace's Jira
 * projects), editable summary, and priority. The caller supplies `onCreate`,
 * so the same dialog drives both "create from message" and "/jira create". */
export function CreateJiraIssueDialog({
  workspaceId,
  defaultSummary,
  onCreate,
  onClose,
}: {
  workspaceId: string;
  defaultSummary: string;
  onCreate: (input: CreateIssueInput) => Promise<{ url: string }>;
  onClose: () => void;
}) {
  const projects = useJiraProjects(workspaceId, true);
  const [projectKey, setProjectKey] = useState('');
  const [summary, setSummary] = useState(defaultSummary);
  const [priority, setPriority] = useState<JiraPriority>('Medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect the first project once the list loads.
  useEffect(() => {
    if (!projectKey && projects.data && projects.data.length > 0) {
      setProjectKey(projects.data[0].key);
    }
  }, [projects.data, projectKey]);

  const submit = async () => {
    const key = projectKey.trim().toUpperCase();
    if (!key || !summary.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onCreate({ projectKey: key, summary: summary.trim(), priority });
      window.open(res.url, '_blank', 'noopener');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create issue');
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800';
  const hasProjects = (projects.data?.length ?? 0) > 0;

  return (
    <Dialog title="Create Jira issue" onClose={onClose}>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <label className="mb-1 block text-xs font-medium text-gray-500">Project</label>
      {hasProjects ? (
        <select
          className={clsx(inputCls, 'mb-3')}
          value={projectKey}
          onChange={(e) => setProjectKey(e.target.value)}
          data-testid="jira-issue-project"
        >
          {projects.data!.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={clsx(inputCls, 'mb-3')}
          placeholder={projects.isLoading ? 'Loading projects…' : 'e.g. PROJ'}
          value={projectKey}
          onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
          autoFocus
          data-testid="jira-issue-project-key"
        />
      )}

      <label className="mb-1 block text-xs font-medium text-gray-500">Summary</label>
      <input
        className={clsx(inputCls, 'mb-3')}
        placeholder="Issue summary"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        autoFocus={hasProjects}
        data-testid="jira-issue-summary"
      />

      <label className="mb-1 block text-xs font-medium text-gray-500">Priority</label>
      <select
        className={clsx(inputCls, 'mb-3')}
        value={priority}
        onChange={(e) => setPriority(e.target.value as JiraPriority)}
        data-testid="jira-issue-priority"
      >
        {JIRA_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <p className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
        Reporter will be you when your Jira account is connected (otherwise the workspace connection).
      </p>
      <button
        onClick={() => void submit()}
        disabled={busy || !projectKey.trim() || !summary.trim()}
        className="w-full rounded-md bg-[#2684FF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f6fd6] disabled:opacity-50"
        data-testid="jira-issue-create"
      >
        {busy ? 'Creating…' : 'Create issue'}
      </button>
    </Dialog>
  );
}
