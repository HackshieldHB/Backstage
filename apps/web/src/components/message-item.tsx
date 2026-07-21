'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import {
  Bookmark,
  MessageSquareText,
  Pencil,
  Pin,
  SmilePlus,
  SquareKanban,
  Trash2,
} from 'lucide-react';
import type {
  JiraActionInput,
  JiraAssignableUser,
  JiraTransition,
  MessageDto,
} from '@backstages/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { keys, usePresence, type PendingMessage } from '@/hooks/queries';
import { emojiChar } from '@/lib/emoji';
import { Avatar } from './avatar';
import { UserProfileDialog } from './user-profile-dialog';
import { MessageBody } from './message-body';
import { AttachmentView } from './attachment-view';
import { EmojiPickerPopover } from './emoji-picker';
import { EditMessageEditor } from './composer';
import { CreateJiraIssueDialog } from './create-jira-issue-dialog';
import { useAtlassianStatus } from './atlassian-dialog';

const QUICK_EMOJI = ['thumbsup', 'heart', 'joy', 'eyes', 'tada'];

// Re-exported for callers that already import it from here (e.g. right-panel).
export { emojiChar };

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
  const [jiraOpen, setJiraOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [localEditing, setLocalEditing] = useState(false);
  const presence = usePresence(message.workspaceId);
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

  const atlassian = useAtlassianStatus(message.workspaceId);

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
      ) : message.kind === 'INTEGRATION' ? (
        <JiraAvatar className="mt-0.5" />
      ) : message.user ? (
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="mt-0.5 shrink-0"
          title={`View ${message.user.displayName}'s profile`}
          data-testid="author-avatar"
        >
          <Avatar user={message.user} size="md" />
        </button>
      ) : (
        <Avatar user={message.user} size="md" className="mt-0.5" />
      )}

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-bold">
              {message.kind === 'INTEGRATION'
                ? 'Jira'
                : (message.user?.displayName ?? (message.pending ? me?.displayName : 'Unknown user'))}
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
        <UnfurlCards message={message} />

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
          {message.channelId && atlassian.data?.connected && (
            <ToolbarButton
              title="Create Jira issue from message"
              onClick={() => setJiraOpen(true)}
              testId="create-jira-issue"
            >
              <SquareKanban size={15} className="text-[#2684FF]" />
            </ToolbarButton>
          )}
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

      {jiraOpen && (
        <CreateJiraIssueDialog
          workspaceId={message.workspaceId}
          defaultSummary={message.contentText.slice(0, 100)}
          onCreate={(input) =>
            api<{ key: string; url: string }>('POST', `/messages/${message.id}/create-jira-issue`, input)
          }
          onClose={() => setJiraOpen(false)}
        />
      )}

      {profileOpen && message.user && (
        <UserProfileDialog
          user={message.user}
          presence={presence.data?.[message.user.id]}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </div>
  );
}

/** App identity for INTEGRATION messages — Jira mark instead of a user avatar. */
function JiraAvatar({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-gray-200 dark:ring-gray-700',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" role="img" aria-label="Jira">
        <path
          fill="#2684FF"
          d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.215V6.758a1.001 1.001 0 0 0-1-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z"
        />
      </svg>
    </span>
  );
}

function UnfurlCards({ message }: { message: MessageDto }) {
  const atlassian = useAtlassianStatus(message.workspaceId);
  const unfurls = message.unfurls;
  if (!Array.isArray(unfurls) || unfurls.length === 0) return null;
  const cards = unfurls as Array<{
    type: string;
    url: string;
    key?: string;
    title: string;
    status?: string;
    issueType?: string | null;
    priority?: string | null;
  }>;
  const canAct = Boolean(message.channelId) && Boolean(atlassian.data?.connected);
  return (
    <div className="mt-1.5 space-y-1.5">
      {cards.map((card) => (
        <div
          key={card.url}
          data-testid="unfurl-card"
          className="max-w-md overflow-hidden rounded-lg border-l-4 border border-gray-200 border-l-[#2684FF] bg-gray-50 dark:border-gray-700 dark:border-l-[#2684FF] dark:bg-gray-800"
        >
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">
                {card.key ? `${card.key} · ` : ''}
                {card.title}
              </span>
              <span className="block text-[11px] text-gray-500">
                {card.type === 'jira'
                  ? [card.status, card.issueType, card.priority].filter(Boolean).join(' · ')
                  : card.type === 'bitbucket'
                    ? ['Bitbucket', card.status].filter(Boolean).join(' · ')
                    : 'Confluence'}
              </span>
            </span>
            {card.status && (
              <span className="ml-auto shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                {card.status}
              </span>
            )}
          </a>
          {card.type === 'jira' && card.key && canAct && (
            <JiraCardActions messageId={message.id} issueKey={card.key} />
          )}
        </div>
      ))}
    </div>
  );
}

function JiraActionChip({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      {children}
    </button>
  );
}

function JiraCardActions({ messageId, issueKey }: { messageId: string; issueKey: string }) {
  const [busy, setBusy] = useState(false);
  const [transitions, setTransitions] = useState<JiraTransition[] | null>(null);
  const [assignees, setAssignees] = useState<JiraAssignableUser[] | null>(null);

  const act = async (body: JiraActionInput) => {
    setBusy(true);
    try {
      await api('POST', `/messages/${messageId}/jira/action`, body);
      setTransitions(null);
      setAssignees(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const openMove = async () => {
    setAssignees(null);
    setBusy(true);
    try {
      const list = await api<JiraTransition[]>(
        'GET',
        `/messages/${messageId}/jira/transitions?issueKey=${encodeURIComponent(issueKey)}`,
      );
      setTransitions(list);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not load statuses');
    } finally {
      setBusy(false);
    }
  };

  const openAssign = async () => {
    setTransitions(null);
    setBusy(true);
    try {
      const list = await api<JiraAssignableUser[]>(
        'GET',
        `/messages/${messageId}/jira/assignable?issueKey=${encodeURIComponent(issueKey)}`,
      );
      setAssignees(list);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not load members');
    } finally {
      setBusy(false);
    }
  };

  const comment = () => {
    const text = window.prompt(`Comment on ${issueKey}:`)?.trim();
    if (text) void act({ issueKey, action: 'comment', text });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-200 px-3 py-1.5 dark:border-gray-700">
      <JiraActionChip disabled={busy} onClick={() => void act({ issueKey, action: 'assign_me' })}>
        Assign to me
      </JiraActionChip>
      <JiraActionChip disabled={busy} onClick={() => void openAssign()}>
        Assign…
      </JiraActionChip>
      <JiraActionChip disabled={busy} onClick={() => void openMove()}>
        Move
      </JiraActionChip>
      <JiraActionChip disabled={busy} onClick={comment}>
        Comment
      </JiraActionChip>
      {transitions && (
        <div className="flex basis-full flex-wrap items-center gap-1.5 pt-1">
          {transitions.length === 0 ? (
            <span className="text-[11px] text-gray-500">No transitions available</span>
          ) : (
            transitions.map((t) => (
              <JiraActionChip
                key={t.id}
                disabled={busy}
                onClick={() => void act({ issueKey, action: 'transition', transitionId: t.id })}
              >
                {t.name}
              </JiraActionChip>
            ))
          )}
        </div>
      )}
      {assignees && (
        <div className="flex basis-full flex-wrap items-center gap-1.5 pt-1">
          {assignees.length === 0 ? (
            <span className="text-[11px] text-gray-500">No linked members to assign</span>
          ) : (
            assignees.map((u) => (
              <JiraActionChip
                key={u.accountId}
                disabled={busy}
                onClick={() => void act({ issueKey, action: 'assign', assigneeAccountId: u.accountId })}
              >
                {u.displayName}
              </JiraActionChip>
            ))
          )}
        </div>
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
