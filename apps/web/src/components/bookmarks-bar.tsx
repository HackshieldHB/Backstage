'use client';

import { useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreateChannelBookmarkSchema, type ChannelBookmarkDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

const key = (channelId: string) => ['bookmarks', channelId] as const;

/**
 * A channel's pinned links, shown under its header. Any member can add one; the
 * creator or a workspace admin can remove it (the server enforces this).
 */
export function BookmarksBar({ channelId }: { channelId: string }) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const [adding, setAdding] = useState(false);
  const bookmarks = useQuery({
    queryKey: key(channelId),
    queryFn: () => api<ChannelBookmarkDto[]>('GET', `/channels/${channelId}/bookmarks`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/bookmarks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(channelId) }),
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not remove the bookmark.', 'error'),
  });

  const items = bookmarks.data ?? [];
  return (
    <div
      className="mx-auto flex w-full max-w-[1000px] items-center gap-1.5 overflow-x-auto px-5 pb-1.5 text-[12px]"
      data-testid="bookmarks-bar"
    >
      {items.map((b) => (
        <span
          key={b.id}
          className="group flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-0.5 text-ink-2 hover:border-accent"
        >
          <Link2 size={11} className="text-ink-3" />
          <a href={b.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent" title={b.url}>
            {b.title}
          </a>
          <button
            onClick={() => remove.mutate(b.id)}
            className="text-ink-3 opacity-0 hover:text-red-500 group-hover:opacity-100"
            aria-label={`Remove bookmark ${b.title}`}
            title={b.createdBy.id === me?.id ? 'Remove' : `Added by ${b.createdBy.displayName}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <button
        onClick={() => setAdding(true)}
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-3 hover:bg-hovered hover:text-ink"
        data-testid="add-bookmark"
      >
        <Plus size={12} /> {items.length ? '' : 'Add a bookmark'}
      </button>
      {adding && <AddBookmarkDialog channelId={channelId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddBookmarkDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('https://');
  const add = useMutation({
    mutationFn: (body: { title: string; url: string }) =>
      api<ChannelBookmarkDto>('POST', `/channels/${channelId}/bookmarks`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(channelId) });
      onClose();
    },
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not add the bookmark.', 'error'),
  });
  const input =
    'mt-1 w-full rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';

  return (
    <Dialog title="Add a bookmark" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = CreateChannelBookmarkSchema.safeParse({ title, url });
          if (!parsed.success) {
            pushToast(parsed.error.issues[0].message, 'error');
            return;
          }
          add.mutate(parsed.data);
        }}
      >
        <label className="block text-[12px] font-medium text-ink-2">
          Link
          <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
        </label>
        <label className="block text-[12px] font-medium text-ink-2">
          Name
          <input className={input} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Runbook" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-ink-2 hover:bg-hovered">
            Cancel
          </button>
          <button
            type="submit"
            disabled={add.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}
