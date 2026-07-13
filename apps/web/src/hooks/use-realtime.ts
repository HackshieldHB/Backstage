'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  SOCKET_EVENTS,
  type MessageDeletedPayload,
  type MessageNewPayload,
  type MessageUpdatedPayload,
  type NotificationNewPayload,
  type PresenceChangedPayload,
  type ReactionChangedPayload,
  type ThreadReplyPayload,
  type TypingPayload,
  type UnreadUpdatedPayload,
  type MessageDto,
  type MessagePage,
} from '@backstages/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import { useUiStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { appendMessage, keys, patchMessage, replaceMessage } from './queries';

/**
 * Bridges socket events into the TanStack Query cache. Mounted once inside the
 * authenticated app shell.
 */
export function useRealtime(workspaceId: string | null) {
  const qc = useQueryClient();
  const upsertTyping = useUiStore((s) => s.upsertTyping);
  const removeTyping = useUiStore((s) => s.removeTyping);
  const me = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!workspaceId || !me) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const containerIdOf = (p: { channelId: string | null; conversationId: string | null }) =>
      p.channelId ?? p.conversationId ?? '';

    const onMessageNew = ({ message }: MessageNewPayload) => {
      const containerId = containerIdOf(message);
      if (message.parentId) {
        // Thread reply: update the open thread panel if it is loaded.
        qc.setQueryData<{ parent: MessageDto; replies: MessageDto[] }>(
          keys.thread(message.parentId),
          (old) =>
            old && !old.replies.some((r) => r.id === message.id)
              ? { ...old, replies: [...old.replies, message] }
              : old,
        );
        if (!message.showInChannel) return;
      }
      appendMessage(qc, containerId, message);
    };

    const onMessageUpdated = ({ message }: MessageUpdatedPayload) => {
      replaceMessage(qc, containerIdOf(message), message);
      if (message.parentId) {
        qc.setQueryData<{ parent: MessageDto; replies: MessageDto[] }>(
          keys.thread(message.parentId),
          (old) =>
            old
              ? { ...old, replies: old.replies.map((r) => (r.id === message.id ? message : r)) }
              : old,
        );
      } else {
        qc.setQueryData<{ parent: MessageDto; replies: MessageDto[] }>(
          keys.thread(message.id),
          (old) => (old ? { ...old, parent: message } : old),
        );
      }
    };

    const onMessageDeleted = (p: MessageDeletedPayload) => {
      patchMessage(qc, containerIdOf(p), p.id, {
        isDeleted: true,
        contentText: '',
        contentJson: null,
        reactions: [],
        attachments: [],
      });
      if (p.parentId) {
        qc.setQueryData<{ parent: MessageDto; replies: MessageDto[] }>(
          keys.thread(p.parentId),
          (old) =>
            old
              ? {
                  ...old,
                  replies: old.replies.map((r) =>
                    r.id === p.id
                      ? { ...r, isDeleted: true, contentText: '', contentJson: null, reactions: [] }
                      : r,
                  ),
                }
              : old,
        );
      }
    };

    const onReaction = (p: ReactionChangedPayload) => {
      patchMessage(qc, containerIdOf(p), p.messageId, { reactions: p.reactions });
      // Also patch thread caches that may contain this message.
      qc.setQueriesData<{ parent: MessageDto; replies: MessageDto[] }>(
        { queryKey: ['thread'] },
        (old) => {
          if (!old) return old;
          const fix = (m: MessageDto) => (m.id === p.messageId ? { ...m, reactions: p.reactions } : m);
          return { parent: fix(old.parent), replies: old.replies.map(fix) };
        },
      );
    };

    const onThreadReply = (p: ThreadReplyPayload) => {
      patchMessage(qc, containerIdOf(p), p.parentId, {
        replyCount: p.replyCount,
        lastReplyAt: p.lastReplyAt,
      });
    };

    const onUnread = (p: UnreadUpdatedPayload) => {
      qc.setQueryData<UnreadUpdatedPayload[]>(keys.unreads(workspaceId), (old) => {
        if (!old) return old;
        const key = p.channelId ?? p.conversationId;
        const idx = old.findIndex((u) => (u.channelId ?? u.conversationId) === key);
        if (idx === -1) return [...old, p];
        const copy = [...old];
        copy[idx] = p;
        return copy;
      });
    };

    const onNotification = (p: NotificationNewPayload) => {
      qc.invalidateQueries({ queryKey: keys.notifications });
      // Desktop notification when the tab is not focused.
      if (
        typeof document !== 'undefined' &&
        !document.hasFocus() &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        const pl = (p.payload ?? {}) as { source?: string; issueKey?: string; direction?: string };
        const title =
          pl.source === 'jira'
            ? pl.direction === 'out'
              ? `Jira: ${pl.issueKey ?? 'an issue'} unassigned from you`
              : `Jira: ${pl.issueKey ?? 'an issue'} assigned to you`
            : p.type === 'MENTION'
              ? `${p.actor?.displayName ?? 'Someone'} mentioned you`
              : p.type === 'THREAD_REPLY'
                ? `${p.actor?.displayName ?? 'Someone'} replied in a thread`
                : p.type === 'DM'
                  ? `New message from ${p.actor?.displayName ?? 'someone'}`
                  : 'New activity in Backstages';
        const n = new Notification(title, { tag: p.id });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    };

    const onPresence = (p: PresenceChangedPayload & { statusEmoji?: string; statusText?: string }) => {
      qc.setQueryData<Record<string, string>>(keys.presence(workspaceId), (old) => ({
        ...(old ?? {}),
        [p.userId]: p.state,
      }));
      if (p.statusEmoji !== undefined) {
        qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
      }
    };

    const onTypingStart = (p: TypingPayload) => {
      if (p.user.id === me.id) return;
      const containerId = p.channelId ?? p.conversationId ?? '';
      upsertTyping(containerId, {
        userId: p.user.id,
        displayName: p.user.displayName,
        expiresAt: Date.now() + 4000,
      });
    };
    const onTypingStop = (p: TypingPayload) => {
      removeTyping(p.channelId ?? p.conversationId ?? '', p.user.id);
    };

    const onChannelsChanged = () => {
      qc.invalidateQueries({ queryKey: keys.channels(workspaceId) });
      qc.invalidateQueries({ queryKey: keys.browse(workspaceId) });
    };

    socket.on(SOCKET_EVENTS.MESSAGE_NEW, onMessageNew);
    socket.on(SOCKET_EVENTS.MESSAGE_UPDATED, onMessageUpdated);
    socket.on(SOCKET_EVENTS.MESSAGE_DELETED, onMessageDeleted);
    socket.on(SOCKET_EVENTS.REACTION_ADDED, onReaction);
    socket.on(SOCKET_EVENTS.REACTION_REMOVED, onReaction);
    socket.on(SOCKET_EVENTS.THREAD_REPLY, onThreadReply);
    socket.on(SOCKET_EVENTS.UNREAD_UPDATED, onUnread);
    socket.on(SOCKET_EVENTS.NOTIFICATION_NEW, onNotification);
    socket.on(SOCKET_EVENTS.PRESENCE_CHANGED, onPresence);
    socket.on(SOCKET_EVENTS.TYPING_START, onTypingStart);
    socket.on(SOCKET_EVENTS.TYPING_STOP, onTypingStop);
    socket.on(SOCKET_EVENTS.CHANNEL_CREATED, onChannelsChanged);
    socket.on(SOCKET_EVENTS.CHANNEL_UPDATED, onChannelsChanged);
    socket.on(SOCKET_EVENTS.MEMBER_JOINED, onChannelsChanged);
    socket.on(SOCKET_EVENTS.MEMBER_LEFT, onChannelsChanged);

    return () => {
      socket.off(SOCKET_EVENTS.MESSAGE_NEW, onMessageNew);
      socket.off(SOCKET_EVENTS.MESSAGE_UPDATED, onMessageUpdated);
      socket.off(SOCKET_EVENTS.MESSAGE_DELETED, onMessageDeleted);
      socket.off(SOCKET_EVENTS.REACTION_ADDED, onReaction);
      socket.off(SOCKET_EVENTS.REACTION_REMOVED, onReaction);
      socket.off(SOCKET_EVENTS.THREAD_REPLY, onThreadReply);
      socket.off(SOCKET_EVENTS.UNREAD_UPDATED, onUnread);
      socket.off(SOCKET_EVENTS.NOTIFICATION_NEW, onNotification);
      socket.off(SOCKET_EVENTS.PRESENCE_CHANGED, onPresence);
      socket.off(SOCKET_EVENTS.TYPING_START, onTypingStart);
      socket.off(SOCKET_EVENTS.TYPING_STOP, onTypingStop);
      socket.off(SOCKET_EVENTS.CHANNEL_CREATED, onChannelsChanged);
      socket.off(SOCKET_EVENTS.CHANNEL_UPDATED, onChannelsChanged);
      socket.off(SOCKET_EVENTS.MEMBER_JOINED, onChannelsChanged);
      socket.off(SOCKET_EVENTS.MEMBER_LEFT, onChannelsChanged);
    };
  }, [workspaceId, me, qc, upsertTyping, removeTyping]);
}

/** Prune expired typing entries on an interval. */
export function useTypingJanitor() {
  const typing = useUiStore((s) => s.typing);
  const removeTyping = useUiStore((s) => s.removeTyping);
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      for (const [containerId, entries] of Object.entries(typing)) {
        for (const e of entries) {
          if (e.expiresAt < now) removeTyping(containerId, e.userId);
        }
      }
    }, 1500);
    return () => clearInterval(t);
  }, [typing, removeTyping]);
}
