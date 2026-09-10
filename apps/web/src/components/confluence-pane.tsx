'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ConfluencePage, ConfluenceSpace } from '@backstages/shared';
import { api } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
import { PaneShell } from './pane-shell';
import { ConfluenceTab } from './work-dashboard-dialog';

const inputCls =
  'w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

/** A dedicated Confluence workspace: spaces + pages on the left, an editor on
 *  the right. Create / edit / delete pages inline (writes need a linked account). */
export function ConfluencePane({ workspaceId }: { workspaceId: string }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [spaces, setSpaces] = useState<ConfluenceSpace[] | null>(null);
  const [spaceKey, setSpaceKey] = useState('');
  const [pages, setPages] = useState<ConfluencePage[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [editing, setEditing] = useState<ConfluencePage | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pages' | 'overview'>('pages');

  useEffect(() => {
    api<ConfluenceSpace[]>('GET', `/workspaces/${workspaceId}/confluence/spaces`)
      .then((s) => {
        setSpaces(s);
        if (s[0]) setSpaceKey(s[0].key);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load spaces'));
  }, [workspaceId]);

  useEffect(() => {
    if (!spaceKey) return;
    setLoadingPages(true);
    api<ConfluencePage[]>('GET', `/workspaces/${workspaceId}/confluence/spaces/${spaceKey}/pages`)
      .then(setPages)
      .catch(() => setPages([]))
      .finally(() => setLoadingPages(false));
  }, [workspaceId, spaceKey]);

  const reload = async () => {
    const p = await api<ConfluencePage[]>(
      'GET',
      `/workspaces/${workspaceId}/confluence/spaces/${spaceKey}/pages`,
    );
    setPages(p);
  };

  const resetForm = () => {
    setEditing(null);
    setTitle('');
    setBody('');
  };

  const startEdit = async (page: ConfluencePage) => {
    setError(null);
    try {
      const full = await api<ConfluencePage & { body: string }>(
        'GET',
        `/workspaces/${workspaceId}/confluence/pages/${page.id}`,
      );
      setEditing(full);
      setTitle(full.title);
      setBody(full.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load page');
    }
  };

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api('PATCH', `/workspaces/${workspaceId}/confluence/pages/${editing.id}`, {
          title: title.trim(),
          body,
          version: editing.version,
        });
        pushToast('Page updated.', 'success');
      } else {
        await api('POST', `/workspaces/${workspaceId}/confluence/pages`, {
          spaceKey,
          title: title.trim(),
          body,
        });
        pushToast('Page created.', 'success');
      }
      resetForm();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const del = async (page: ConfluencePage) => {
    if (!window.confirm(`Delete "${page.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/workspaces/${workspaceId}/confluence/pages/${page.id}`);
      if (editing?.id === page.id) resetForm();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PaneShell
      icon={<FileText size={18} className="text-[#2684FF]" />}
      title="Confluence"
      subtitle={spaces && spaces.length > 0 ? undefined : 'Connected Atlassian site with Confluence access'}
      actions={
        <button
          onClick={resetForm}
          className="flex items-center gap-1 rounded-md bg-[#2684FF] px-2.5 py-1 text-[13px] font-semibold text-white hover:bg-[#1f6fd6]"
        >
          <Plus size={14} /> New page
        </button>
      }
    >
      <div className="mb-4 flex gap-1 border-b border-line">
        {(['pages', 'overview'] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={clsx(
              'px-3 py-2 text-sm font-medium capitalize',
              tab === tb ? 'border-b-2 border-accent text-accent' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200',
            )}
            data-testid={`confluence-tab-${tb}`}
          >
            {tb}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="mx-auto max-w-5xl">
          <ConfluenceTab workspaceId={workspaceId} />
        </div>
      ) : (
        <>
          {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

          {spaces === null ? (
        <p className="text-sm text-gray-500">Loading spaces…</p>
      ) : spaces.length === 0 ? (
        <p className="text-sm text-gray-500">
          No Confluence spaces found. Make sure the connected site has Confluence and that a workspace
          admin reconnected Atlassian after Confluence access was added.
        </p>
      ) : (
        <div className="mx-auto flex max-w-5xl gap-4">
          {/* Left: space selector + page list */}
          <div className="w-64 shrink-0">
            <select
              value={spaceKey}
              onChange={(e) => {
                setSpaceKey(e.target.value);
                resetForm();
              }}
              className={`${inputCls} mb-2`}
              data-testid="confluence-space"
            >
              {spaces.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name} ({s.key})
                </option>
              ))}
            </select>
            <div className="thin-scrollbar max-h-[60vh] overflow-y-auto rounded-md border border-line">
              {loadingPages ? (
                <p className="p-3 text-sm text-gray-500">Loading pages…</p>
              ) : pages.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">No pages in this space yet.</p>
              ) : (
                <ul className="divide-y divide-line dark:divide-line">
                  {pages.map((p) => (
                    <li
                      key={p.id}
                      className={clsx(
                        'group flex items-center justify-between gap-1 px-3 py-2',
                        editing?.id === p.id && 'bg-accent/5',
                      )}
                    >
                      <button
                        onClick={() => void startEdit(p)}
                        className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent"
                        title={p.title}
                      >
                        {p.title}
                      </button>
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                            title="Open in Confluence"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                        <button
                          onClick={() => void startEdit(p)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => void del(p)}
                          disabled={busy}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right: editor */}
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[13px] font-medium text-gray-600 dark:text-gray-300">
              {editing ? `Editing: ${editing.title}` : 'New page'}
            </p>
            <input
              className={`${inputCls} mb-2`}
              placeholder="Page title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="confluence-title"
            />
            <textarea
              className={`${inputCls} mb-3 h-[45vh] resize-y`}
              placeholder="Page content (plain text)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              data-testid="confluence-body"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void submit()}
                disabled={busy || !title.trim()}
                className="rounded-md bg-[#2684FF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f6fd6] disabled:opacity-50"
                data-testid="confluence-save"
              >
                {busy ? 'Saving…' : editing ? 'Update page' : 'Create page'}
              </button>
              {editing && (
                <button
                  onClick={resetForm}
                  className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </PaneShell>
  );
}
