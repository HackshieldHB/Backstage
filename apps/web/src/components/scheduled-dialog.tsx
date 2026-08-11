'use client';

import { format } from 'date-fns';
import { Clock, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, useScheduledMessages, type ChannelWithMeta } from '@/hooks/queries';
import type { ConversationDto } from '@backstages/shared';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

/** Manage pending scheduled sends (queued messages that will auto-deliver). */
export function ScheduledDialog({
  workspaceId,
  channels,
  conversations,
  onClose,
}: {
  workspaceId: string;
  channels: ChannelWithMeta[];
  conversations: ConversationDto[];
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const qc = useQueryClient();
  const scheduled = useScheduledMessages(workspaceId);
  // The manager covers queued sends; personal /remind reminders live in "Later".
  const items = (scheduled.data ?? []).filter((s) => !s.isReminder);

  const labelFor = (channelId: string | null, conversationId: string | null) => {
    if (channelId) return `#${channels.find((c) => c.id === channelId)?.name ?? 'channel'}`;
    const dm = conversations.find((c) => c.id === conversationId);
    const others = dm?.members.filter((m) => m.id !== me?.id).map((m) => m.displayName) ?? [];
    return others.length ? others.join(', ') : 'Direct message';
  };

  const cancel = async (id: string) => {
    try {
      await api('DELETE', `/scheduled/${id}`);
      await qc.invalidateQueries({ queryKey: keys.scheduled(workspaceId) });
      pushToast('Scheduled message cancelled.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not cancel.', 'error');
    }
  };

  return (
    <Dialog title="Scheduled messages" onClose={onClose}>
      {scheduled.isLoading && <p className="p-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
      {!scheduled.isLoading && items.length === 0 && (
        <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
          No scheduled messages. Use the clock icon in the composer to send one later.
        </p>
      )}
      <ul className="space-y-2">
        {items.map((s) => (
          <li
            key={s.id}
            className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            data-testid="scheduled-row"
          >
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-accent">
                <Clock size={13} />
                {format(new Date(s.scheduledFor), 'EEE, MMM d · HH:mm')}
                <span className="text-gray-500 dark:text-gray-400">
                  → {labelFor(s.channelId, s.conversationId)}
                </span>
              </div>
              <p className="truncate text-[13px] text-gray-700 dark:text-gray-200">{s.contentText}</p>
            </div>
            <button
              onClick={() => void cancel(s.id)}
              title="Cancel"
              className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
              data-testid="scheduled-cancel"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
