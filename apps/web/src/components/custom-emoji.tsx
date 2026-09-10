'use client';

import { useState, type ChangeEvent } from 'react';
import { Trash2, UploadCloud } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, fileUrl } from '@/lib/api';
import { emojiChar } from '@/lib/emoji';
import { keys, useCustomEmoji } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

/**
 * Renders an emoji token: a workspace custom emoji as an <img>, otherwise the
 * native unicode character. Used anywhere reactions are shown.
 */
export function Emoji({
  code,
  workspaceId,
  className,
}: {
  code: string;
  workspaceId: string;
  className?: string;
}) {
  const custom = useCustomEmoji(workspaceId);
  const match = custom.data?.find((e) => e.name === code);
  if (match) {
    return (
      <img
        src={fileUrl(match.url)}
        alt={`:${code}:`}
        className={className ?? 'inline-block h-[1.25em] w-[1.25em] align-text-bottom object-contain'}
      />
    );
  }
  return <>{emojiChar(code)}</>;
}

/** Upload / browse / delete a workspace's custom emoji. */
export function EmojiManagerDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const emoji = useCustomEmoji(workspaceId);
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-'));
  };

  const upload = async () => {
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('file', file);
      await api('POST', `/workspaces/${workspaceId}/emoji`, undefined, { formData: fd });
      await qc.invalidateQueries({ queryKey: keys.customEmoji(workspaceId) });
      setName('');
      setFile(null);
      pushToast('Custom emoji added.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: string) => {
    try {
      await api('DELETE', `/workspaces/${workspaceId}/emoji/${encodeURIComponent(n)}`);
      await qc.invalidateQueries({ queryKey: keys.customEmoji(workspaceId) });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not remove', 'error');
    }
  };

  return (
    <Dialog title="Custom emoji" onClose={onClose}>
      <div className="mb-4 rounded-lg border border-line p-3 dark:border-line">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">:</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            placeholder="party-parrot"
            className="w-40 rounded-md border border-line-strong px-2 py-1 text-sm outline-none focus:border-accent dark:border-line-strong dark:bg-gray-800"
            data-testid="emoji-name"
          />
          <span className="text-gray-400">:</span>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800">
            <UploadCloud size={14} />
            {file ? 'Change' : 'Image'}
            <input type="file" accept="image/*" hidden onChange={onPickFile} data-testid="emoji-file" />
          </label>
        </div>
        {file && (
          <p className="mt-2 truncate text-xs text-gray-500">
            {file.name} ({Math.round(file.size / 1024)} KB)
          </p>
        )}
        <button
          onClick={() => void upload()}
          disabled={busy || !file || !name.trim()}
          className="mt-3 w-full rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="emoji-upload"
        >
          {busy ? 'Uploading…' : 'Add emoji'}
        </button>
        <p className="mt-1 text-[11px] text-gray-400">PNG/GIF, under 256 KB. Use in reactions as :{name || 'name'}:</p>
      </div>

      <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto">
        {(emoji.data ?? []).map((e) => (
          <div
            key={e.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hovered"
            data-testid="emoji-row"
          >
            <img src={fileUrl(e.url)} alt={e.name} className="h-6 w-6 object-contain" />
            <span className="text-sm">:{e.name}:</span>
            <button
              onClick={() => void remove(e.name)}
              title="Remove"
              className="ml-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {(emoji.data ?? []).length === 0 && (
          <p className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">No custom emoji yet.</p>
        )}
      </div>
    </Dialog>
  );
}
