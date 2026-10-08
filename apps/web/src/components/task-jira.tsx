'use client';

import { useState } from 'react';
import { AlertTriangle, SquareKanban, X } from 'lucide-react';
import type { TaskDto } from '@backstages/shared';
import { useJiraProjects, useTaskJira } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { useAtlassianStatus } from './atlassian-dialog';
import { Dialog } from './dialog';

const input =
  'w-full rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';

/**
 * A task's Jira link: the linked issue (key · status, opens Jira), a way to
 * create/link one when the workspace is connected, and any sync problem.
 */
export function TaskJira({ task, workspaceId }: { task: TaskDto; workspaceId: string }) {
  const atlassian = useAtlassianStatus(workspaceId);
  const { unlink } = useTaskJira(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [open, setOpen] = useState(false);

  if (task.jira) {
    return (
      <>
        <span className="flex items-center gap-1">
          <a
            href={task.jira.url ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-[#2684FF] hover:underline"
            title="Open in Jira — its status stays in sync with this task"
          >
            <SquareKanban size={12} />
            {task.jira.key}
            {task.jira.status && <span className="text-ink-3">· {task.jira.status}</span>}
          </a>
          <button
            onClick={() =>
              unlink.mutate(task.id, {
                onError: () => pushToast('Could not unlink the Jira issue.', 'error'),
              })
            }
            aria-label={`Unlink ${task.jira.key}`}
            title="Unlink from Jira"
            className="rounded text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100"
          >
            <X size={11} />
          </button>
        </span>
        {task.jiraSyncError && (
          <span
            className="flex basis-full items-center gap-1 text-amber-500"
            data-testid="jira-sync-error"
          >
            <AlertTriangle size={12} /> {task.jiraSyncError}
          </span>
        )}
      </>
    );
  }

  if (!atlassian.data?.connected) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 opacity-0 hover:text-[#2684FF] focus:opacity-100 group-hover:opacity-100"
        title="Create or link a Jira issue"
      >
        <SquareKanban size={12} /> Jira
      </button>
      {open && (
        <TaskJiraDialog task={task} workspaceId={workspaceId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function TaskJiraDialog({
  task,
  workspaceId,
  onClose,
}: {
  task: TaskDto;
  workspaceId: string;
  onClose: () => void;
}) {
  const projects = useJiraProjects(workspaceId, true);
  const { create, link } = useTaskJira(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [projectKey, setProjectKey] = useState('');
  const [issueKey, setIssueKey] = useState('');
  const busy = create.isPending || link.isPending;
  const project = projectKey || projects.data?.[0]?.key || '';

  const onDone = (t: TaskDto) => {
    pushToast(`Linked to ${t.jira?.key ?? 'Jira'} — status now syncs both ways.`, 'success');
    onClose();
  };
  const onError = (err: unknown) =>
    pushToast(err instanceof Error ? err.message : 'Jira request failed.', 'error');

  return (
    <Dialog title="Link to Jira" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[12px] text-ink-3">“{task.title}”</p>
        <div className="flex gap-1 rounded-lg bg-hovered p-1 text-[13px]" role="tablist">
          {(['create', 'link'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md px-2 py-1 ${mode === m ? 'bg-elevated font-medium text-ink shadow-sm' : 'text-ink-2'}`}
            >
              {m === 'create' ? 'Create a new issue' : 'Link an existing issue'}
            </button>
          ))}
        </div>
        {mode === 'create' ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (project)
                create.mutate({ id: task.id, projectKey: project }, { onSuccess: onDone, onError });
            }}
          >
            <label className="block text-[12px] font-medium text-ink-2">
              Project
              <select
                className={`${input} mt-1`}
                value={project}
                onChange={(e) => setProjectKey(e.target.value)}
                disabled={!projects.data?.length}
              >
                {(projects.data ?? []).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </label>
            {projects.isError && (
              <p className="text-[12px] text-red-500">Could not load Jira projects.</p>
            )}
            <button
              type="submit"
              disabled={!project || busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Create issue
            </button>
          </form>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (issueKey.trim())
                link.mutate(
                  { id: task.id, issueKey: issueKey.trim() },
                  { onSuccess: onDone, onError },
                );
            }}
          >
            <label className="block text-[12px] font-medium text-ink-2">
              Issue key
              <input
                className={`${input} mt-1`}
                placeholder="PROJ-123"
                value={issueKey}
                onChange={(e) => setIssueKey(e.target.value)}
                autoFocus
              />
            </label>
            <button
              type="submit"
              disabled={!issueKey.trim() || busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Link issue
            </button>
          </form>
        )}
        <p className="text-[11px] text-ink-3">
          Completing or reopening the task updates the issue in Jira (as you), and Jira status
          changes update the task.
        </p>
      </div>
    </Dialog>
  );
}
