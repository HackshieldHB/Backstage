'use client';

import { ArrowLeftRight, CalendarClock, ChevronDown, FileText, Hash, Headphones, Info, Lightbulb, Lock, Menu, NotebookPen, Pin, Sparkles, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useAiStatus, useChannelMembers, useChannels, useConversations, useMembers, usePins, usePresence, type Container } from '@/hooks/queries';
import { emojiChar } from '@/lib/emoji';
import { presenceLabel } from '@/lib/presence';
import type { HuddleController } from '@/hooks/use-huddle';
import { MessageList } from './message-list';
import { Composer, TypingIndicator } from './composer';
import { CheatSheetDialog } from './cheat-sheet-dialog';
import { Tooltip } from './tooltip';
import { Dialog } from './dialog';
import { ScheduleHuddleDialog, UpcomingHuddles } from './schedule-huddle';
import { MeetingHistoryDialog } from './meeting-history-dialog';
import { BookmarksBar } from './bookmarks-bar';
import { Avatar } from './avatar';

export function MainPane({
  workspaceId,
  container,
  huddle,
  highlightMessageId,
  clearHighlight,
}: {
  workspaceId: string;
  container: Container;
  huddle: HuddleController;
  highlightMessageId: string | null;
  clearHighlight: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { setRightPanel, toggleSidebar } = useUiStore();
  const pushToast = useUiStore((s) => s.pushToast);
  const ai = useAiStatus();
  const [tipsOpen, setTipsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const pins = usePins(container.kind === 'channel' ? container.id : null);
  const channelMembers = useChannelMembers(container.kind === 'channel' ? container.id : null);
  const conversations = useConversations(workspaceId);
  const presence = usePresence(workspaceId);
  const members = useMembers(workspaceId);
  // Share info comes with the sidebar list (already cached), not the channel itself.
  const sidebarChannel = useChannels(workspaceId).data?.find((c) => c.id === container.id);

  const channel = useQuery({
    queryKey: ['channel', container.id],
    queryFn: () => api<{ name: string; topic: string | null; isPrivate: boolean; isDefault: boolean }>('GET', `/channels/${container.id}`),
    enabled: container.kind === 'channel',
  });

  // Huddle state relative to *this* container (the huddle itself lives at the
  // app shell, so it survives navigating between channels/DMs).
  const activeHere = huddle.activeTarget?.id === container.id;
  const ongoingHere = (huddle.participantsByContainer[container.id]?.length ?? 0) > 0;

  const dm = conversations.data?.find((c) => c.id === container.id);
  const dmOthers = dm?.members.filter((m) => m.id !== me?.id) ?? [];
  // The other person's current status (incl. automatic 🎧 / 🗓️), kept fresh by realtime.
  const dmMember = dmOthers.length === 1 ? members.data?.find((m) => m.user.id === dmOthers[0].id) : undefined;
  const dmStatus = dmMember?.user;

  const title =
    container.kind === 'channel'
      ? channel.data?.name ?? '…'
      : dmOthers.map((o) => o.displayName).join(', ') || 'You';

  const placeholder =
    container.kind === 'channel' ? `Message #${channel.data?.name ?? ''}` : `Message ${title}`;

  return (
    <>
      {/* header: the channel's "playbill" — cover, title, topic, then actions */}
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-[1000px] items-center gap-3 px-3 py-2.5 sm:px-5">
        <button className="icon-btn -mr-1 md:hidden" aria-label="Open sidebar" onClick={() => toggleSidebar()}>
          <Menu size={18} />
        </button>
        {container.kind === 'channel' ? (
          <span
            aria-hidden
            className="playbill-cover flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-accent"
          >
            {channel.data?.isPrivate ? <Lock size={18} /> : <Hash size={18} />}
          </span>
        ) : (
          <Avatar user={dmOthers[0] ?? me} size="md" className="hidden sm:inline-block" />
        )}
        {/* The title keeps a readable minimum; on narrow stages the actions scroll instead. */}
        <div className="min-w-[7.5rem] flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1
              className="flex min-w-0 items-center gap-1 truncate font-display text-[19px] font-bold leading-tight tracking-tight text-ink"
              data-testid="channel-title"
            >
              {container.kind === 'channel' && (
                <span className="font-medium text-ink-3" aria-hidden>
                  #
                </span>
              )}
              <span className="truncate">{title}</span>
            </h1>
            {container.kind === 'channel' && (sidebarChannel?.sharedFrom || sidebarChannel?.isShared) && (
              <span
                className="flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
                data-testid="channel-shared-badge"
              >
                <ArrowLeftRight size={11} />
                {sidebarChannel.sharedFrom ? `From ${sidebarChannel.sharedFrom.name}` : 'Shared'}
              </span>
            )}
          </div>
          <p className="truncate text-[12.5px] text-ink-3" data-testid="channel-subtitle">
            {container.kind === 'channel'
              ? channel.data?.topic ||
                (channelMembers.data
                  ? `${channelMembers.data.length} ${channelMembers.data.length === 1 ? 'member' : 'members'}`
                  : ' ')
              : dmOthers.length === 1
                ? [
                    dmMember?.role === 'GUEST' ? 'Guest' : '',
                    presenceLabel(presence.data?.[dmOthers[0].id]),
                    dmStatus ? `${dmStatus.statusEmoji ? `${emojiChar(dmStatus.statusEmoji)} ` : ''}${dmStatus.statusText ?? ''}`.trim() : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : dmOthers.length > 1
                  ? `${dmOthers.length + 1} people`
                  : 'Notes to yourself'}
          </p>
        </div>
        <div className="no-scrollbar flex min-w-0 shrink items-center gap-1 overflow-x-auto">
        {/* Huddle: one split button — start/join, plus ▾ for scheduling and past
            meetings. When a huddle is already running here, the persistent huddle
            bar shows the controls, so the main part only offers to start or join. */}
        <div className="flex shrink-0 items-center">
          {!activeHere &&
            (ongoingHere ? (
              <button
                onClick={() => void huddle.join(container)}
                className="btn-primary shrink-0 whitespace-nowrap rounded-r-none px-2.5 py-1 text-[12px]"
                data-testid="join-huddle"
              >
                <Headphones size={14} /> Join huddle
              </button>
            ) : (
              <Tooltip label="Start a huddle">
                <button
                  onClick={() => void huddle.join(container)}
                  className="icon-btn gap-1 rounded-r-none text-[12px]"
                  data-testid="start-huddle"
                  aria-label="Start a huddle"
                >
                  <Headphones size={15} />
                </button>
              </Tooltip>
            ))}
          <HuddleMenu
            attached={!activeHere}
            onSchedule={() => setScheduleOpen(true)}
            onHistory={() => setHistoryOpen(true)}
          />
        </div>
        {container.kind === 'channel' && (
          <Tooltip label="Channel canvas (shared notes)">
            <button
              onClick={() => setRightPanel({ kind: 'canvas' })}
              className="icon-btn"
              data-testid="canvas-button"
              aria-label="Channel canvas"
            >
              <NotebookPen size={16} />
            </button>
          </Tooltip>
        )}
        {ai.data?.enabled && container.kind === 'channel' && (
          <Tooltip label="Summarize this channel (AI)">
            <button
              onClick={async () => {
                setSummarizing(true);
                setSummary(null);
                try {
                  const r = await api<{ summary: string }>(
                    'POST',
                    `/ai/channels/${container.id}/summarize`,
                  );
                  setSummary(r.summary);
                } catch (err) {
                  pushToast(err instanceof Error ? err.message : 'Summary failed', 'error');
                } finally {
                  setSummarizing(false);
                }
              }}
              className="icon-btn"
              data-testid="ai-summarize"
              aria-label="Summarize channel"
            >
              <Sparkles size={16} className={summarizing ? 'animate-pulse text-accent' : undefined} />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Tips & shortcuts">
          <button
            onClick={() => setTipsOpen(true)}
            className="icon-btn"
            data-testid="tips-button"
            aria-label="Tips & shortcuts"
          >
            <Lightbulb size={16} />
          </button>
        </Tooltip>
        {/* Details: members, pinned messages, files and settings in one panel. */}
        {container.kind === 'channel' && (
          <Tooltip label="Details, members & pinned">
            <button
              onClick={() => setRightPanel({ kind: 'details' })}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hovered hover:text-ink"
              data-testid="details-button"
              aria-label={`Details: ${channelMembers.data?.length ?? 0} members${
                (pins.data?.length ?? 0) > 0 ? `, ${pins.data?.length} pinned` : ''
              }`}
            >
              <span className="flex items-center gap-1" data-testid="member-count">
                <Users size={14} /> {channelMembers.data?.length ?? ''}
              </span>
              {(pins.data?.length ?? 0) > 0 && (
                <span className="flex items-center gap-1 border-l border-line pl-2" data-testid="pin-count">
                  <Pin size={13} /> {pins.data?.length}
                </span>
              )}
              <Info size={14} className="text-ink-3" />
            </button>
          </Tooltip>
        )}
        </div>
        </div>
        {container.kind === 'channel' && <BookmarksBar channelId={container.id} />}
      </header>

      {tipsOpen && (
        <CheatSheetDialog workspaceId={workspaceId} onClose={() => setTipsOpen(false)} />
      )}

      {scheduleOpen && (
        <ScheduleHuddleDialog container={container} onClose={() => setScheduleOpen(false)} />
      )}

      {historyOpen && (
        <MeetingHistoryDialog
          container={container}
          workspaceId={workspaceId}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <UpcomingHuddles container={container} huddle={huddle} />

      {(summary !== null || summarizing) && (
        <Dialog title="Channel summary" onClose={() => setSummary(null)}>
          {summarizing ? (
            <p className="text-sm text-gray-500">Summarizing…</p>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">{summary}</p>
          )}
        </Dialog>
      )}

      <MessageList
        workspaceId={workspaceId}
        container={container}
        onOpenThread={(messageId) => setRightPanel({ kind: 'thread', messageId })}
        highlightMessageId={highlightMessageId}
        clearHighlight={clearHighlight}
      />

      <div className="shrink-0 px-4 pb-4 pt-1">
        <div className="mx-auto w-full max-w-[1000px]">
          <TypingIndicator containerId={container.id} />
          <Composer workspaceId={workspaceId} container={container} placeholder={placeholder} />
          <p className="mt-1.5 hidden px-1 text-[11px] text-ink-3 md:block">
            <kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd> + <kbd className="kbd">Enter</kbd> for a new line
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * The ▾ beside the huddle button: schedule a huddle for later, or open past
 * meetings and their minutes. The menu is fixed-positioned so the header's
 * scrolling action row can't clip it.
 */
function HuddleMenu({
  attached,
  onSchedule,
  onHistory,
}: {
  /** Joined to the start/join button on its left (square left corners). */
  attached: boolean;
  onSchedule: () => void;
  onHistory: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) {
      setPos(null);
      return;
    }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };
  const pick = (fn: () => void) => () => {
    setPos(null);
    fn();
  };

  return (
    <>
      <Tooltip label="Schedule or see past huddles">
        <button
          ref={buttonRef}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={!!pos}
          aria-label="More huddle options"
          data-testid="huddle-menu"
          className={clsx('icon-btn px-1', attached && 'rounded-l-none')}
        >
          <ChevronDown size={14} />
        </button>
      </Tooltip>
      {pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-64 rounded-xl border border-line bg-overlay p-1.5 text-[13px] shadow-pop animate-fade-in"
        >
          <button
            role="menuitem"
            onClick={pick(onSchedule)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-ink-2 hover:bg-hovered hover:text-ink"
            data-testid="schedule-huddle"
          >
            <CalendarClock size={15} className="text-ink-3" /> Schedule a huddle
          </button>
          <button
            role="menuitem"
            onClick={pick(onHistory)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-ink-2 hover:bg-hovered hover:text-ink"
            data-testid="meeting-history"
          >
            <FileText size={15} className="text-ink-3" /> Meeting history & minutes
          </button>
        </div>
      )}
    </>
  );
}
