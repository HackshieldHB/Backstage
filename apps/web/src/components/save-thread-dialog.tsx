'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import type { ConfluencePage } from '@backstages/shared';
import { api } from '@/lib/api';
import { useConfluenceSpaces } from '@/hooks/queries';
import { Dialog } from './dialog';

/**
 * Captures the open thread as a Confluence page. The server builds the page
 * body from the thread itself, so this only collects the destination space and
 * an optional title override.
 */
export function SaveThreadDialog({
  workspaceId,
  messageId,
  defaultTitle,
  onClose,
}: {
  workspaceId: string;
  messageId: string;
  defaultTitle: string;
  onClose: () => void;
}) {
  const spaces = useConfluenceSpaces(workspaceId, true);
  const [spaceKey, setSpaceKey] = useState('');
  const [title, setTitle] = useState(defaultTitle.slice(0, 120));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ConfluencePage | null>(null);

  const submit = async () => {
    if (!spaceKey) return;
    setBusy(true);
    setError(null);
    try {
      const page = await api<ConfluencePage>('POST', `/messages/${messageId}/confluence-page`, {
        spaceKey,
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      setSaved(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the thread');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Save thread to Confluence" onClose={onClose}>
      <div className="space-y-3 p-4">
        {saved ? (
          <>
            <p className="text-sm">Saved as <span className="font-semibold">{saved.title}</span>.</p>
            {saved.url && (
              <a
                href={saved.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Open in Confluence <ExternalLink size={14} />
              </a>
            )}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="block text-xs font-semibold uppercase text-gray-500">Space</label>
            {spaces.isLoading ? (
              <p className="text-sm text-gray-400">Loading spaces…</p>
            ) : spaces.data && spaces.data.length > 0 ? (
              <select
                value={spaceKey}
                onChange={(e) => setSpaceKey(e.target.value)}
                data-testid="save-thread-space"
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
              >
                <option value="">Choose a space…</option>
                {spaces.data.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-400">No Confluence spaces available.</p>
            )}

            <label className="block text-xs font-semibold uppercase text-gray-500">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              placeholder="Defaults to the first line of the thread"
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            />

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !spaceKey}
                data-testid="save-thread-submit"
                className={clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium text-white',
                  busy || !spaceKey ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700',
                )}
              >
                {busy ? 'Saving…' : 'Save page'}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
