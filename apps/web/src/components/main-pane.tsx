'use client';

import { Hash, Headphones, Info, Lightbulb, Lock, Menu, NotebookPen, Pin, Sparkles, Users } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useAiStatus, useChannelMembers, useConversations, usePins, type Container } from '@/hooks/queries';
import type { HuddleController } from '@/hooks/use-huddle';
import { MessageList } from './message-list';
import { Composer, TypingIndicator } from './composer';
import { CheatSheetDialog } from './cheat-sheet-dialog';
import { Tooltip } from './tooltip';
import { Dialog } from './dialog';

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
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const pins = usePins(container.kind === 'channel' ? container.id : null);
  const channelMembers = useChannelMembers(container.kind === 'channel' ? container.id : null);
  const conversations = useConversations(workspaceId);

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

  const title =
    container.kind === 'channel'
      ? channel.data?.name ?? '…'
      : dmOthers.map((o) => o.displayName).join(', ') || 'You';

  const placeholder =
    container.kind === 'channel' ? `Message #${channel.data?.name ?? ''}` : `Message ${title}`;

  return (
    <>
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-700">
        <button className="mr-1 rounded p-1 hover:bg-gray-100 md:hidden dark:hover:bg-gray-800" onClick={() => toggleSidebar()}>
          <Menu size={18} />
        </button>
        <h1 className="flex items-center gap-1.5 text-[15px] font-bold" data-testid="channel-title">
          {container.kind === 'channel' ? (
            channel.data?.isPrivate ? <Lock size={15} /> : <Hash size={15} />
          ) : null}
          {title}
        </h1>
        {channel.data?.topic && (
          <span className="hidden truncate text-[13px] text-gray-500 md:inline">{channel.data.topic}</span>
        )}
        <span className="flex-1" />
        {/* When a huddle is already running here, the persistent huddle bar shows
            the controls — so the header button only offers to start or join. */}
        {!activeHere &&
          (ongoingHere ? (
            <button
              onClick={() => void huddle.join(container)}
              className="flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[12px] font-semibold text-white hover:bg-indigo-700"
              data-testid="join-huddle"
            >
              <Headphones size={14} /> Join huddle
            </button>
          ) : (
            <Tooltip label="Start a huddle">
              <button
                onClick={() => void huddle.join(container)}
                className="flex items-center gap-1 rounded p-1.5 text-[12px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                data-testid="start-huddle"
                aria-label="Start a huddle"
              >
                <Headphones size={15} />
              </button>
            </Tooltip>
          ))}
        {container.kind === 'channel' && (
          <>
            {(pins.data?.length ?? 0) > 0 && (
              <Tooltip label="Pinned messages">
                <button
                  onClick={() => setRightPanel({ kind: 'details' })}
                  className="flex items-center gap-1 rounded p-1.5 text-[12px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label="Pinned messages"
                >
                  <Pin size={14} /> {pins.data?.length}
                </button>
              </Tooltip>
            )}
            <Tooltip label="Members">
              <button
                onClick={() => setRightPanel({ kind: 'details' })}
                className="flex items-center gap-1 rounded p-1.5 text-[12px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                data-testid="member-count"
                aria-label="Members"
              >
                <Users size={14} /> {channelMembers.data?.length ?? ''}
              </button>
            </Tooltip>
          </>
        )}
        {container.kind === 'channel' && (
          <Tooltip label="Channel canvas (shared notes)">
            <button
              onClick={() => setRightPanel({ kind: 'canvas' })}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
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
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
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
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="tips-button"
            aria-label="Tips & shortcuts"
          >
            <Lightbulb size={16} />
          </button>
        </Tooltip>
        <Tooltip label="Details">
          <button
            onClick={() => setRightPanel({ kind: 'details' })}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="details-button"
            aria-label="Details"
          >
            <Info size={16} />
          </button>
        </Tooltip>
      </header>

      {tipsOpen && (
        <CheatSheetDialog workspaceId={workspaceId} onClose={() => setTipsOpen(false)} />
      )}

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

      <div className="shrink-0 px-4 pb-3">
        <TypingIndicator containerId={container.id} />
        <Composer workspaceId={workspaceId} container={container} placeholder={placeholder} />
        <p className="mt-1 hidden text-[11px] text-gray-500 dark:text-gray-400 md:block">
          <strong>Enter</strong> to send · <strong>Shift+Enter</strong> for a new line
        </p>
      </div>
    </>
  );
}
