'use client';

import { useMemo, useState } from 'react';
import { Hash, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useChannels, useConversations } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

/** Pick a channel or DM to forward a message into. */
export function ForwardDialog({
  workspaceId,
  messageId,
  onClose,
}: {
  workspaceId: string;
  messageId: string;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const channels = useChannels(workspaceId);
  const conversations = useConversations(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const targets = useMemo(() => {
    type Target = {
      key: string;
      label: string;
      isPrivate: boolean;
      body: { channelId?: string; conversationId?: string };
    };
    const chs: Target[] = (channels.data ?? []).map((c) => ({
      key: `ch:${c.id}`,
      label: `#${c.name}`,
      isPrivate: c.isPrivate,
      body: { channelId: c.id },
    }));
    const dms: Target[] = (conversations.data ?? []).map((c) => {
      const others = c.members.filter((m) => m.id !== me?.id).map((m) => m.displayName);
      return {
        key: `dm:${c.id}`,
        label: others.length ? others.join(', ') : 'You',
        isPrivate: false,
        body: { conversationId: c.id },
      };
    });
    return [...chs, ...dms].filter((t) => t.label.toLowerCase().includes(filter.toLowerCase()));
  }, [channels.data, conversations.data, me?.id, filter]);

  const forward = async (body: { channelId?: string; conversationId?: string }, label: string) => {
    setBusy(true);
    try {
      await api('POST', `/messages/${messageId}/forward`, body);
      pushToast(`Forwarded to ${label}`, 'success');
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not forward', 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Forward message" onClose={onClose}>
      <input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search channels & people"
        className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
      />
      <ul className="max-h-72 overflow-y-auto">
        {targets.map((t) => (
          <li key={t.key}>
            <button
              disabled={busy}
              onClick={() => void forward(t.body, t.label)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800"
              data-testid="forward-target"
            >
              {t.body.channelId ? (
                t.isPrivate ? (
                  <Lock size={14} />
                ) : (
                  <Hash size={14} />
                )
              ) : null}
              {t.label}
            </button>
          </li>
        ))}
        {targets.length === 0 && <li className="p-3 text-sm text-gray-500">No matches.</li>}
      </ul>
    </Dialog>
  );
}
