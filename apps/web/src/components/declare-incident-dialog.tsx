'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { IncidentResult } from '@backstages/shared';
import { api } from '@/lib/api';
import { useConfluenceSpaces, useJiraProjects } from '@/hooks/queries';
import { Dialog } from './dialog';

const SEVERITIES = ['sev1', 'sev2', 'sev3'] as const;
type Severity = (typeof SEVERITIES)[number];

/**
 * `/incident <title>` — spins up the coordination channel, the tracking Jira
 * issue and (optionally) a postmortem page in one submit.
 */
export function DeclareIncidentDialog({
  workspaceId,
  defaultTitle,
  onDeclared,
  onClose,
}: {
  workspaceId: string;
  defaultTitle: string;
  onDeclared: (result: IncidentResult) => void;
  onClose: () => void;
}) {
  const projects = useJiraProjects(workspaceId, true);
  const spaces = useConfluenceSpaces(workspaceId, true);
  const [title, setTitle] = useState(defaultTitle);
  const [projectKey, setProjectKey] = useState('');
  const [spaceKey, setSpaceKey] = useState('');
  const [severity, setSeverity] = useState<Severity>('sev2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectKey && projects.data && projects.data.length > 0) {
      setProjectKey(projects.data[0].key);
    }
  }, [projects.data, projectKey]);

  const submit = async () => {
    const key = projectKey.trim().toUpperCase();
    if (!key || title.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<IncidentResult>('POST', `/workspaces/${workspaceId}/incident`, {
        title: title.trim(),
        projectKey: key,
        severity,
        ...(spaceKey ? { spaceKey } : {}),
      });
      onDeclared(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to declare the incident');
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';
  const hasProjects = (projects.data?.length ?? 0) > 0;

  return (
    <Dialog title="Declare incident" onClose={onClose}>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <label className="mb-1 block text-xs font-medium text-gray-500">What is happening?</label>
      <input
        className={clsx(inputCls, 'mb-3')}
        placeholder="e.g. Checkout returning 500s"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        data-testid="incident-title"
      />

      <label className="mb-1 block text-xs font-medium text-gray-500">Severity</label>
      <select
        className={clsx(inputCls, 'mb-3')}
        value={severity}
        onChange={(e) => setSeverity(e.target.value as Severity)}
        data-testid="incident-severity"
      >
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s.toUpperCase()}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-xs font-medium text-gray-500">Jira project</label>
      {hasProjects ? (
        <select
          className={clsx(inputCls, 'mb-3')}
          value={projectKey}
          onChange={(e) => setProjectKey(e.target.value)}
          data-testid="incident-project"
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
          data-testid="incident-project-key"
        />
      )}

      <label className="mb-1 block text-xs font-medium text-gray-500">
        Postmortem space <span className="font-normal text-gray-500 dark:text-gray-400">(optional)</span>
      </label>
      <select
        className={clsx(inputCls, 'mb-3')}
        value={spaceKey}
        onChange={(e) => setSpaceKey(e.target.value)}
        data-testid="incident-space"
      >
        <option value="">No postmortem page</option>
        {(spaces.data ?? []).map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </select>

      <p className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
        Creates a channel, a tracking issue, and a draft postmortem — each linking to the others.
      </p>
      <button
        onClick={() => void submit()}
        disabled={busy || !projectKey.trim() || title.trim().length < 3}
        className="w-full rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        data-testid="incident-declare"
      >
        {busy ? 'Declaring…' : 'Declare incident'}
      </button>
    </Dialog>
  );
}
