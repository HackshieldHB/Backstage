'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2, ExternalLink } from 'lucide-react';
import type { ConfluencePage, ConfluenceSpace } from '@backstages/shared';
import { api } from '@/lib/api';
import { Dialog } from './dialog';

export function ConfluenceDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [spaces, setSpaces] = useState<ConfluenceSpace[] | null>(null);
  const [spaceKey, setSpaceKey] = useState('');
  const [pages, setPages] = useState<ConfluencePage[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [editing, setEditing] = useState<ConfluencePage | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      } else {
        await api('POST', `/workspaces/${workspaceId}/confluence/pages`, {
          spaceKey,
          title: title.trim(),
          body,
        });
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

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800';

  return (
    <Dialog title="Confluence pages" onClose={onClose} wide>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {spaces === null ? (
        <p className="text-sm text-gray-500">Loading spaces…</p>
      ) : spaces.length === 0 ? (
        <p className="text-sm text-gray-500">
          No Confluence spaces found. Make sure the connected site has Confluence and that you
          reconnected after Confluence access was added.
        </p>
      ) : (
        <>
          <label className="mb-1 block text-xs font-medium text-gray-500">Space</label>
          <select
            value={spaceKey}
            onChange={(e) => {
              setSpaceKey(e.target.value);
              resetForm();
            }}
            className={`${inputCls} mb-3`}
            data-testid="confluence-space"
          >
            {spaces.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name} ({s.key})
              </option>
            ))}
          </select>

          <div className="mb-4 max-h-48 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700">
            {loadingPages ? (
              <p className="p-3 text-sm text-gray-500">Loading pages…</p>
            ) : pages.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No pages in this space yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {pages.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-2">
                    <span className="truncate text-sm">{p.title}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {p.url && (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
                          title="Open in Confluence"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <button
                        onClick={() => void startEdit(p)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => void del(p)}
                        disabled={busy}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mb-1 text-xs font-medium text-gray-500">
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
            className={`${inputCls} mb-3 h-28 resize-y`}
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
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
