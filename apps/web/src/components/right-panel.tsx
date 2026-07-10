'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { format, formatDistanceToNow } from 'date-fns';
import { AtSign, Bell, FileText, Hash, MessageSquareText, Reply, Smile, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, fileUrl } from '@/lib/api';
import { useUiStore, type RightPanel } from '@/stores/ui-store';
import {
  keys,
  useChannelMembers,
  useNotifications,
  usePins,
  usePresence,
  useSaved,
  useSearch,
  useThread,
  type Container,
} from '@/hooks/queries';
import { useQuery } from '@tanstack/react-query';
import { MessageItem, emojiChar } from './message-item';
import { Composer } from './composer';
import { Avatar } from './avatar';
import { MessageBody } from './message-body';

export function RightPanelView({
  workspaceId,
  container,
  panel,
  onNavigate,
}: {
  workspaceId: string;
  container: Container;
  panel: RightPanel;
  onNavigate: (c: Container, highlight?: string) => void;
}) {
  const setRightPanel = useUiStore((s) => s.setRightPanel);

  return (
    <aside className="flex w-full max-w-md shrink-0 flex-col border-l border-gray-200 bg-white md:w-96 dark:border-gray-700 dark:bg-gray-900 absolute inset-y-0 right-0 z-30 md:static">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4 dark:border-gray-700">
        <h2 className="text-[15px] font-bold">
          {panel.kind === 'thread' && 'Thread'}
          {panel.kind === 'details' && 'Details'}
          {panel.kind === 'activity' && 'Activity'}
          {panel.kind === 'saved' && 'Saved items'}
        </h2>
        <button onClick={() => setRightPanel({ kind: 'none' })} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close panel">
          <X size={16} />
        </button>
      </header>
      <div className="thin-scrollbar flex-1 overflow-y-auto">
        {panel.kind === 'thread' && (
          <ThreadPanel workspaceId={workspaceId} container={container} messageId={panel.messageId} />
        )}
        {panel.kind === 'details' && container.kind === 'channel' && (
          <DetailsPanel workspaceId={workspaceId} channelId={container.id} onNavigate={onNavigate} />
        )}
        {panel.kind === 'activity' && <ActivityPanel onNavigate={onNavigate} />}
        {panel.kind === 'saved' && <SavedPanel workspaceId={workspaceId} onNavigate={onNavigate} />}
      </div>
    </aside>
  );
}

// ---------- thread ----------

function ThreadPanel({
  workspaceId,
  container,
  messageId,
}: {
  workspaceId: string;
  container: Container;
  messageId: string;
}) {
  const thread = useThread(messageId);

  if (!thread.data) {
    return <p className="p-4 text-sm text-gray-400">Loading thread…</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <div className="pt-3" data-testid="thread-parent">
          <MessageItem message={thread.data.parent} grouped={false} inThread />
        </div>
        <div className="mx-5 my-2 flex items-center gap-2 text-xs text-gray-400">
          <span>{thread.data.replies.length} {thread.data.replies.length === 1 ? 'reply' : 'replies'}</span>
          <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        </div>
        <div data-testid="thread-replies">
          {thread.data.replies.map((reply, i) => (
            <MessageItem
              key={reply.id}
              message={reply}
              inThread
              grouped={
                i > 0 &&
                thread.data.replies[i - 1].user?.id === reply.user?.id &&
                new Date(reply.createdAt).getTime() - new Date(thread.data.replies[i - 1].createdAt).getTime() < 5 * 60 * 1000
              }
            />
          ))}
        </div>
      </div>
      <div className="shrink-0 p-3">
        <Composer
          workspaceId={workspaceId}
          container={container}
          placeholder="Reply in thread…"
          parentId={messageId}
        />
      </div>
    </div>
  );
}

// ---------- channel details ----------

function DetailsPanel({
  workspaceId,
  channelId,
  onNavigate,
}: {
  workspaceId: string;
  channelId: string;
  onNavigate: (c: Container, highlight?: string) => void;
}) {
  const [tab, setTab] = useState<'about' | 'members' | 'pinned' | 'files'>('about');
  const qc = useQueryClient();
  const members = useChannelMembers(channelId);
  const pins = usePins(channelId);
  const presence = usePresence(workspaceId);
  const channel = useQuery({
    queryKey: ['channel', channelId],
    queryFn: () =>
      api<{ name: string; topic: string | null; description: string | null; isPrivate: boolean; isDefault: boolean; notificationPref: string }>(
        'GET',
        `/channels/${channelId}`,
      ),
  });
  const files = useSearch(workspaceId, `in:${channel.data?.name ?? ''} has:file`);

  return (
    <div>
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['about', 'members', 'pinned', 'files'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'flex-1 py-2 text-[13px] font-medium capitalize',
              tab === t ? 'border-b-2 border-accent text-accent' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200',
            )}
            data-testid={`details-tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'about' && channel.data && (
        <div className="space-y-4 p-4 text-sm">
          <div>
            <h3 className="mb-1 font-semibold">Topic</h3>
            <p className="text-gray-600 dark:text-gray-300">{channel.data.topic ?? 'No topic set'}</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Description</h3>
            <p className="text-gray-600 dark:text-gray-300">{channel.data.description ?? 'No description'}</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Notifications</h3>
            <select
              value={channel.data.notificationPref}
              onChange={async (e) => {
                await api('PATCH', `/channels/${channelId}/notifications`, { pref: e.target.value });
                await qc.invalidateQueries({ queryKey: ['channel', channelId] });
              }}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
              data-testid="notification-pref"
            >
              <option value="ALL">All messages</option>
              <option value="MENTIONS">Mentions only</option>
              <option value="MUTED">Muted</option>
            </select>
          </div>
          {!channel.data.isDefault && (
            <button
              onClick={async () => {
                await api('POST', `/channels/${channelId}/leave`);
                await qc.invalidateQueries({ queryKey: keys.channels(workspaceId) });
                window.location.href = `/app?ws=${workspaceId}`;
              }}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Leave channel
            </button>
          )}
        </div>
      )}

      {tab === 'members' && (
        <ul className="p-2">
          {(members.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Avatar user={m} size="sm" presence={presence.data?.[m.id]} />
              <span className="text-sm">{m.displayName}</span>
              {m.isProvisional && (
                <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                  provisional
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'pinned' && (
        <div className="p-2" data-testid="pinned-list">
          {(pins.data ?? []).map((p) => (
            <button
              key={p.message.id}
              onClick={() => onNavigate({ kind: 'channel', id: channelId }, p.message.id)}
              className="mb-2 block w-full rounded-lg border border-gray-200 p-3 text-left hover:border-accent dark:border-gray-700"
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                <Avatar user={p.message.user} size="xs" />
                {p.message.user?.displayName} · {format(new Date(p.message.createdAt), 'MMM d')}
              </div>
              <MessageBody contentJson={p.message.contentJson} contentText={p.message.contentText} />
            </button>
          ))}
          {(pins.data ?? []).length === 0 && <p className="p-3 text-sm text-gray-400">Nothing pinned yet.</p>}
        </div>
      )}

      {tab === 'files' && (
        <ul className="p-2">
          {(files.data?.files ?? []).map((f) => (
            <li key={f.id}>
              <a
                href={`${fileUrl(f.url)}&download=1`}
                className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <FileText size={18} className="text-accent" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{f.filename}</span>
                  <span className="block text-xs text-gray-500">
                    {f.uploader?.displayName} · {format(new Date(f.createdAt), 'MMM d')}
                  </span>
                </span>
              </a>
            </li>
          ))}
          {(files.data?.files ?? []).length === 0 && <p className="p-3 text-sm text-gray-400">No files yet.</p>}
        </ul>
      )}
    </div>
  );
}

// ---------- activity ----------

function ActivityPanel({ onNavigate }: { onNavigate: (c: Container, highlight?: string) => void }) {
  const notifications = useNotifications();
  const qc = useQueryClient();

  const iconFor = (type: string) =>
    type === 'MENTION' ? <AtSign size={14} className="text-accent" />
    : type === 'THREAD_REPLY' ? <Reply size={14} className="text-emerald-600" />
    : type === 'REACTION' ? <Smile size={14} className="text-amber-500" />
    : type === 'DM' ? <MessageSquareText size={14} className="text-blue-500" />
    : <Bell size={14} className="text-gray-400" />;

  return (
    <div className="p-2" data-testid="activity-list">
      <div className="flex justify-end px-2 pb-1">
        <button
          className="text-xs font-medium text-accent hover:underline"
          onClick={async () => {
            await api('POST', '/me/notifications/read', {});
            await qc.invalidateQueries({ queryKey: keys.notifications });
          }}
        >
          Mark all read
        </button>
      </div>
      {(notifications.data?.notifications ?? []).map((n) => (
        <button
          key={n.id}
          onClick={() => {
            if (n.channelId) onNavigate({ kind: 'channel', id: n.channelId }, n.messageId ?? undefined);
            else if (n.conversationId) onNavigate({ kind: 'conversation', id: n.conversationId }, n.messageId ?? undefined);
          }}
          className={clsx(
            'mb-1 flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800',
            !n.readAt && 'bg-accent/5',
          )}
        >
          <span className="mt-0.5">{iconFor(n.type)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px]">
              <strong>{n.actor?.displayName ?? 'Someone'}</strong>{' '}
              {n.type === 'MENTION' && 'mentioned you'}
              {n.type === 'THREAD_REPLY' && 'replied to a thread'}
              {n.type === 'REACTION' &&
                `reacted ${emojiChar(String((n.payload as { emoji?: string } | null)?.emoji ?? ''))}`}
              {n.type === 'DM' && 'sent you a message'}
              {n.channelName && <span className="text-gray-400"> in #{n.channelName}</span>}
            </span>
            {n.preview && <span className="block truncate text-xs text-gray-500">{n.preview}</span>}
            <span className="block text-[11px] text-gray-400">
              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
            </span>
          </span>
          {!n.readAt && <span className="mt-1.5 h-2 w-2 rounded-full bg-accent" />}
        </button>
      ))}
      {(notifications.data?.notifications ?? []).length === 0 && (
        <p className="p-3 text-sm text-gray-400">No activity yet.</p>
      )}
    </div>
  );
}

// ---------- saved ----------

function SavedPanel({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate: (c: Container, highlight?: string) => void;
}) {
  const saved = useSaved(workspaceId);
  return (
    <div className="p-2" data-testid="saved-list">
      {(saved.data ?? []).map((s) => (
        <button
          key={s.message.id}
          onClick={() => {
            if (s.message.channelId) onNavigate({ kind: 'channel', id: s.message.channelId }, s.message.id);
            else if (s.message.conversationId) onNavigate({ kind: 'conversation', id: s.message.conversationId }, s.message.id);
          }}
          className="mb-2 block w-full rounded-lg border border-gray-200 p-3 text-left hover:border-accent dark:border-gray-700"
        >
          <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
            <Avatar user={s.message.user} size="xs" />
            {s.message.user?.displayName} · saved {formatDistanceToNow(new Date(s.savedAt), { addSuffix: true })}
          </div>
          <MessageBody contentJson={s.message.contentJson} contentText={s.message.contentText} />
        </button>
      ))}
      {(saved.data ?? []).length === 0 && <p className="p-3 text-sm text-gray-400">Nothing saved yet.</p>}
    </div>
  );
}
