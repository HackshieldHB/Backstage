'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import {
  Bookmark,
  MessageSquareText,
  Pencil,
  Pin,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import type { MessageDto } from '@backstages/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { keys, type PendingMessage } from '@/hooks/queries';
import { Avatar } from './avatar';
import { MessageBody } from './message-body';
import { AttachmentView } from './attachment-view';
import { EmojiPickerPopover } from './emoji-picker';
import { EditMessageEditor } from './composer';

const QUICK_EMOJI = ['thumbsup', 'heart', 'joy', 'eyes', 'tada'];

const EMOJI_MAP: Record<string, string> = {
  thumbsup: '👍', '+1': '👍', heart: '❤️', joy: '😂', eyes: '👀', tada: '🎉', rocket: '🚀',
  fire: '🔥', pray: '🙏', smile: '😄', wave: '👋', thinking_face: '🤔', check: '✅',
  white_check_mark: '✅', x: '❌', clap: '👏', raised_hands: '🙌', sob: '😭', ghost: '👻',
};

export function emojiChar(code: string): string {
  return EMOJI_MAP[code] ?? `:${code}:`;
}

export function MessageItem({
  message,
  grouped,
  inThread,
  isPinned,
  onOpenThread,
}: {
  message: PendingMessage;
  grouped: boolean;
  inThread?: boolean;
  isPinned?: boolean;
  onOpenThread?: (messageId: string) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [hovered, setHovered] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [localEditing, setLocalEditing] = useState(false);
  const editingMessageId = useUiStore((s) => s.editingMessageId);
  const setEditingMessageId = useUiStore((s) => s.setEditingMessageId);
  const editing = localEditing || editingMessageId === message.id;
  const setEditing = (v: boolean) => {
    setLocalEditing(v);
    if (!v && editingMessageId === message.id) setEditingMessageId(null);
  };

  const mine = message.user?.id === me?.id || (message.pending && !message.user);
  const time = format(new Date(message.createdAt), 'HH:mm');

  const toggleReaction = async (emoji: string) => {
    setEmojiOpen(false);
    await api('POST', `/messages/${message.id}/reactions`, { emoji });
  };

  const remove = async () => {
    await api('DELETE', `/messages/${message.id}`);
  };

  const togglePin = async () => {
    if (isPinned) await api('DELETE', `/messages/${message.id}/pin`);
    else await api('POST', `/messages/${message.id}/pin`);
    if (message.channelId) await qc.invalidateQueries({ queryKey: keys.pins(message.channelId) });
  };

  const save = async () => {
    await api('POST', `/messages/${message.id}/save`);
    await qc.invalidateQueries({ queryKey: keys.saved(message.workspaceId) });
  };

  if (message.isDeleted) {
    return (
      <div className={clsx('group relative flex gap-2.5 px-5 py-0.5', !grouped && 'mt-2')} data-message-id={message.id}>
        <span className="w-9 shrink-0" />
        <p className="text-[14px] italic text-gray-400 dark:text-gray-500">This message was deleted</p>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'group relative flex gap-2.5 px-5 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800/50',
        !grouped && 'mt-2',
        message.failed && 'opacity-70',
      )}
      data-message-id={message.id}
      data-testid="message-item"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {grouped ? (
        <span className="w-9 shrink-0 pt-0.5 text-right text-[10px] leading-5 text-gray-400 opacity-0 group-hover:opacity-100">
          {time}
        </span>
      ) : (
        <Avatar user={message.user} size="md" className="mt-0.5" />
      )}

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-bold">
              {message.user?.displayName ?? (message.pending ? me?.displayName : 'Unknown user')}
            </span>
            <span className="text-[11px] text-gray-400">{time}</span>
            {message.kind === 'INTEGRATION' && (
              <span className="rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-500 dark:bg-gray-800">APP</span>
            )}
          </div>
        )}

        {editing ? (
          <EditMessageEditor
            message={message}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            <MessageBody contentJson={message.contentJson} contentText={message.contentText} />
            {message.isEdited && <span className="ml-1 text-[11px] text-gray-400">(edited)</span>}
            {message.pending && <span className="ml-1 text-[11px] text-gray-400">sending…</span>}
            {message.failed && (
              <button
                className="ml-1 text-[11px] font-medium text-red-500 hover:underline"
                onClick={() => window.dispatchEvent(new CustomEvent('bs:retry-message', { detail: message.clientMsgId }))}
              >
                failed — retry
              </button>
            )}
          </>
        )}

        <AttachmentView attachments={message.attachments} />

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => void toggleReaction(r.emoji)}
                data-testid={`reaction-${r.emoji}`}
                className={clsx(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]',
                  me && r.userIds.includes(me.id)
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800',
                )}
              >
                <span>{emojiChar(r.emoji)}</span>
                <span className="font-semibold">{r.count}</span>
              </button>
            ))}
            <button
              onClick={() => setEmojiOpen(true)}
              className="flex items-center rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600"
              title="Add reaction"
            >
              <SmilePlus size={13} />
            </button>
          </div>
        )}

        {/* Thread summary */}
        {!inThread && message.replyCount > 0 && (
          <button
            onClick={() => onOpenThread?.(message.id)}
            data-testid="thread-summary"
            className="mt-1 flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-[12px] font-medium text-accent hover:border-gray-200 hover:bg-white dark:hover:border-gray-700 dark:hover:bg-gray-800"
          >
            <span className="flex -space-x-1">
              {message.threadParticipants.slice(0, 3).map((p) => (
                <Avatar key={p.id} user={p} size="xs" />
              ))}
            </span>
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            {message.lastReplyAt && (
              <span className="font-normal text-gray-400">
                · last {format(new Date(message.lastReplyAt), 'MMM d, HH:mm')}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Hover toolbar */}
      {hovered && !editing && !message.pending && !message.failed && (
        <div className="absolute -top-3 right-4 flex items-center rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {QUICK_EMOJI.slice(0, 3).map((e) => (
            <ToolbarButton key={e} title={`:${e}:`} onClick={() => void toggleReaction(e)}>
              <span className="text-[14px] leading-none">{emojiChar(e)}</span>
            </ToolbarButton>
          ))}
          <ToolbarButton title="Add reaction" onClick={() => setEmojiOpen(true)} testId="add-reaction">
            <SmilePlus size={15} />
          </ToolbarButton>
          {!inThread && !message.parentId && (
            <ToolbarButton title="Reply in thread" onClick={() => onOpenThread?.(message.id)} testId="reply-in-thread">
              <MessageSquareText size={15} />
            </ToolbarButton>
          )}
          {message.channelId && (
            <ToolbarButton title={isPinned ? 'Unpin' : 'Pin to channel'} onClick={() => void togglePin()}>
              <Pin size={15} className={isPinned ? 'text-accent' : undefined} />
            </ToolbarButton>
          )}
          <ToolbarButton title="Save for later" onClick={() => void save()} testId="save-message">
            <Bookmark size={15} />
          </ToolbarButton>
          {mine && (
            <>
              <ToolbarButton title="Edit message" onClick={() => setEditing(true)} testId="edit-message">
                <Pencil size={15} />
              </ToolbarButton>
              <ToolbarButton title="Delete message" onClick={() => void remove()} testId="delete-message">
                <Trash2 size={15} className="text-red-500" />
              </ToolbarButton>
            </>
          )}
        </div>
      )}

      {emojiOpen && (
        <EmojiPickerPopover onPick={(code) => void toggleReaction(code)} onClose={() => setEmojiOpen(false)} />
      )}
    </div>
  );
}

function ToolbarButton({
  title,
  onClick,
  children,
  testId,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      title={title}
      data-testid={testId}
      onClick={onClick}
      className="p-1.5 text-gray-500 first:rounded-l-md last:rounded-r-md hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
    >
      {children}
    </button>
  );
}
