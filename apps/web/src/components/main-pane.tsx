'use client';

import { Hash, Headphones, Info, Lightbulb, Lock, Menu, Pin, Users } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useChannelMembers, useConversations, usePins, type Container } from '@/hooks/queries';
import { useHuddle } from '@/hooks/use-huddle';
import { MessageList } from './message-list';
import { HuddleBar } from './huddle-bar';
import { Composer, TypingIndicator } from './composer';
import { CheatSheetDialog } from './cheat-sheet-dialog';

export function MainPane({
  workspaceId,
  container,
  highlightMessageId,
  clearHighlight,
}: {
  workspaceId: string;
  container: Container;
  highlightMessageId: string | null;
  clearHighlight: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { setRightPanel, toggleSidebar } = useUiStore();
  const [tipsOpen, setTipsOpen] = useState(false);
  const pins = usePins(container.kind === 'channel' ? container.id : null);
  const channelMembers = useChannelMembers(container.kind === 'channel' ? container.id : null);
  const conversations = useConversations(workspaceId);

  const channel = useQuery({
    queryKey: ['channel', container.id],
    queryFn: () => api<{ name: string; topic: string | null; isPrivate: boolean; isDefault: boolean }>('GET', `/channels/${container.id}`),
    enabled: container.kind === 'channel',
  });

  const huddle = useHuddle(container.kind === 'channel' ? container.id : null);

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
        {container.kind === 'channel' && !huddle.joined && (
          <button
            title="Start or join a huddle"
            onClick={() => void huddle.join()}
            className="flex items-center gap-1 rounded p-1.5 text-[12px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="start-huddle"
          >
            <Headphones size={15} />
          </button>
        )}
        {container.kind === 'channel' && (
          <>
            {(pins.data?.length ?? 0) > 0 && (
              <button
                title="Pinned messages"
                onClick={() => setRightPanel({ kind: 'details' })}
                className="flex items-center gap-1 rounded p-1.5 text-[12px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Pin size={14} /> {pins.data?.length}
              </button>
            )}
            <button
              title="Members"
              onClick={() => setRightPanel({ kind: 'details' })}
              className="flex items-center gap-1 rounded p-1.5 text-[12px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              data-testid="member-count"
            >
              <Users size={14} /> {channelMembers.data?.length ?? ''}
            </button>
          </>
        )}
        <button
          title="Tips & shortcuts"
          onClick={() => setTipsOpen(true)}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          data-testid="tips-button"
        >
          <Lightbulb size={16} />
        </button>
        <button
          title="Details"
          onClick={() => setRightPanel({ kind: 'details' })}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          data-testid="details-button"
        >
          <Info size={16} />
        </button>
      </header>

      {tipsOpen && (
        <CheatSheetDialog workspaceId={workspaceId} onClose={() => setTipsOpen(false)} />
      )}

      {container.kind === 'channel' && <HuddleBar huddle={huddle} />}

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
        <p className="mt-1 hidden text-[11px] text-gray-400 md:block">
          <strong>Enter</strong> to send · <strong>Shift+Enter</strong> for a new line
        </p>
      </div>
    </>
  );
}
