'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { format, isSameDay } from 'date-fns';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import {
  containerPath,
  useMessages,
  usePins,
  useUnreads,
  type Container,
  type PendingMessage,
} from '@/hooks/queries';
import { MessageItem } from './message-item';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function MessageList({
  workspaceId,
  container,
  onOpenThread,
  highlightMessageId,
  clearHighlight,
}: {
  workspaceId: string;
  container: Container;
  onOpenThread: (messageId: string) => void;
  highlightMessageId: string | null;
  clearHighlight: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const query = useMessages(container);
  const pins = usePins(container.kind === 'channel' ? container.id : null);
  const unreads = useUnreads(workspaceId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastMarkedRef = useRef<string | null>(null);

  const messages: PendingMessage[] = useMemo(
    () => (query.data ? [...query.data.pages].reverse().flatMap((p) => p.messages) : []),
    [query.data],
  );

  const pinnedIds = useMemo(() => new Set((pins.data ?? []).map((p) => p.message.id)), [pins.data]);

  const unreadCount =
    unreads.data?.find((u) => (u.channelId ?? u.conversationId) === container.id)?.unread ?? 0;

  // The "new messages" divider goes above the last N unread messages from others.
  const firstUnreadId = useMemo(() => {
    if (unreadCount === 0) return null;
    const others = messages.filter((m) => m.user?.id !== me?.id && !m.pending);
    return others.slice(-unreadCount)[0]?.id ?? null;
  }, [messages, unreadCount, me?.id]);

  const markRead = useCallback(() => {
    const last = [...messages].reverse().find((m) => !m.pending && !m.failed);
    if (!last || lastMarkedRef.current === last.id) return;
    lastMarkedRef.current = last.id;
    void api('POST', `${containerPath(container)}/read`, { messageId: last.id }).catch(() => undefined);
  }, [messages, container]);

  // Mark read when scrolled to bottom while the window has focus.
  useEffect(() => {
    if (messages.length === 0) return;
    if (stickToBottom.current && document.hasFocus() && unreadCount > 0) markRead();
  }, [messages, unreadCount, markRead]);

  useEffect(() => {
    const onFocus = () => {
      if (stickToBottom.current && unreadCount > 0) markRead();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [markRead, unreadCount]);

  // Esc marks read (keyboard shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') markRead();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [markRead]);

  // ArrowUp in an empty composer edits your last message.
  const setEditingMessageId = useUiStore((s) => s.setEditingMessageId);
  useEffect(() => {
    const onEditLast = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== container.id) return;
      const lastOwn = [...messages]
        .reverse()
        .find((m) => m.user?.id === me?.id && !m.isDeleted && !m.pending && !m.failed);
      if (lastOwn) setEditingMessageId(lastOwn.id);
    };
    window.addEventListener('bs:edit-last', onEditLast);
    return () => window.removeEventListener('bs:edit-last', onEditLast);
  }, [messages, me?.id, container.id, setEditingMessageId]);

  // Keep pinned to bottom when new messages arrive (unless reading history).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Jump-to-message from search: load older pages until present, then scroll.
  useEffect(() => {
    if (!highlightMessageId) return;
    const present = messages.some((m) => m.id === highlightMessageId);
    if (!present) {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      return;
    }
    const node = scrollRef.current?.querySelector(`[data-message-id="${highlightMessageId}"]`);
    if (node) {
      node.scrollIntoView({ block: 'center' });
      node.classList.add('bg-amber-100', 'dark:bg-amber-900/40');
      setTimeout(() => {
        node.classList.remove('bg-amber-100', 'dark:bg-amber-900/40');
        clearHighlight();
      }, 2500);
    }
  }, [highlightMessageId, messages, query, clearHighlight]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 120 && query.hasNextPage && !query.isFetchingNextPage) {
      const prevHeight = el.scrollHeight;
      void query.fetchNextPage().then(() => {
        // Preserve viewport position after prepending older messages.
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevHeight + el.scrollTop;
        });
      });
    }
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="thin-scrollbar flex-1 overflow-y-auto pb-3" data-testid="message-list">
      {query.isFetchingNextPage && (
        <p className="py-2 text-center text-xs text-gray-500 dark:text-gray-400">Loading older messages…</p>
      )}
      {!query.hasNextPage && messages.length > 0 && (
        <p className="px-5 pt-6 text-xs text-gray-500 dark:text-gray-400">This is the very beginning of the conversation.</p>
      )}
      {messages.map((message, i) => {
        const prev = messages[i - 1];
        const showDateDivider = !prev || !isSameDay(new Date(prev.createdAt), new Date(message.createdAt));
        const grouped =
          !showDateDivider &&
          !!prev &&
          !prev.isDeleted &&
          prev.user?.id === message.user?.id &&
          message.user !== null &&
          !message.parentId === !prev.parentId &&
          new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;

        return (
          <div key={message.id}>
            {showDateDivider && (
              <div className="relative my-3 flex items-center px-5" data-testid="date-divider">
                <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                <span className="mx-2 rounded-full border border-gray-200 px-3 py-0.5 text-[11px] font-semibold dark:border-gray-700">
                  {format(new Date(message.createdAt), 'EEEE, MMMM d')}
                </span>
                <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              </div>
            )}
            {message.id === firstUnreadId && (
              <div className="relative my-1 flex items-center px-5" data-testid="new-divider">
                <span className="h-px flex-1 bg-red-400" />
                <span className="mx-2 text-[11px] font-bold text-red-500">New</span>
              </div>
            )}
            <MessageItem
              message={message}
              grouped={grouped}
              isPinned={pinnedIds.has(message.id)}
              onOpenThread={onOpenThread}
            />
          </div>
        );
      })}
      {messages.length === 0 && query.isSuccess && (
        <p className="px-5 pt-8 text-sm text-gray-500 dark:text-gray-400">No messages yet. Say hello!</p>
      )}
    </div>
  );
}
