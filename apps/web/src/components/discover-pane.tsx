'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Compass, Hash, MessageSquarePlus, Sparkles, UserPlus, X, ClipboardCheck, ArrowRight } from 'lucide-react';
import {
  useRecommendedPeople,
  useRecommendedChannels,
  useFollowups,
  useCatchupPicks,
  useRecommendationFeedback,
  keys,
  type Container,
} from '@/hooks/queries';
import { api } from '@/lib/api';
import { Avatar } from './avatar';
import { PaneShell } from './pane-shell';

/** "Discover": recommendation home — people to meet, channels to join, work to
 *  follow up on, and where to catch up. Backed by the recommendation engine. */
export function DiscoverPane({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate: (c: Container, messageId?: string) => void;
}) {
  const qc = useQueryClient();
  const people = useRecommendedPeople(workspaceId);
  const channels = useRecommendedChannels(workspaceId);
  const followups = useFollowups(workspaceId);
  const catchup = useCatchupPicks(workspaceId);
  const feedback = useRecommendationFeedback(workspaceId);
  const [busy, setBusy] = useState<string | null>(null);

  const peopleRows = people.data ?? [];
  const channelRows = channels.data ?? [];
  const followupRows = followups.data?.items ?? [];
  const catchupRows = catchup.data?.picks ?? [];

  const openDm = async (userId: string) => {
    setBusy(userId);
    try {
      const dm = await api<{ id: string }>('POST', `/workspaces/${workspaceId}/conversations`, {
        memberIds: [userId],
      });
      await qc.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
      feedback.mutate({ kind: 'PERSON', refId: userId, action: 'ACTED' });
      onNavigate({ kind: 'conversation', id: dm.id });
    } finally {
      setBusy(null);
    }
  };

  const joinChannel = async (channelId: string) => {
    setBusy(channelId);
    try {
      await api('POST', `/channels/${channelId}/join`);
      await qc.invalidateQueries({ queryKey: keys.channels(workspaceId) });
      feedback.mutate({ kind: 'CHANNEL', refId: channelId, action: 'ACTED' });
      onNavigate({ kind: 'channel', id: channelId });
    } finally {
      setBusy(null);
    }
  };

  const nothing =
    !people.isLoading &&
    !channels.isLoading &&
    peopleRows.length === 0 &&
    channelRows.length === 0 &&
    followupRows.length === 0 &&
    catchupRows.length === 0;

  return (
    <PaneShell
      icon={<Compass size={18} className="text-accent" />}
      title="Discover"
      subtitle="People, channels and work picked for you"
    >
      <div className="mx-auto max-w-3xl space-y-7">
        {nothing && (
          <p className="rounded-xl border border-line bg-hovered px-4 py-8 text-center text-sm text-ink-3">
            Nothing to recommend yet — as you chat, react and collaborate, suggestions will appear here.
          </p>
        )}

        {/* R7: catch up */}
        {catchupRows.length > 0 && (
          <Section icon={<Sparkles size={14} />} title="Catch up first" count={catchupRows.length}>
            {catchupRows.map((p) => (
              <button
                key={p.channelId ?? p.conversationId ?? p.label}
                onClick={() =>
                  onNavigate(
                    p.channelId
                      ? { kind: 'channel', id: p.channelId }
                      : { kind: 'conversation', id: p.conversationId! },
                    p.latestMessageId ?? undefined,
                  )
                }
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-hovered"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.label}</span>
                <span className="shrink-0 text-xs text-ink-3">{p.reason}</span>
                <ArrowRight size={14} className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </Section>
        )}

        {/* R1: people */}
        <Section icon={<UserPlus size={14} />} title="People to connect with" count={peopleRows.length}>
          {people.isLoading && <Skeleton />}
          {!people.isLoading && peopleRows.length === 0 && <Empty>No suggestions right now.</Empty>}
          {peopleRows.map((p) => (
            <div key={p.userId} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-hovered">
              <Avatar user={{ id: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl }} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink">{p.displayName}</span>
                  {p.isProvisional && (
                    <span className="shrink-0 rounded bg-hovered px-1 py-0.5 text-[9px] font-semibold uppercase text-ink-3">
                      Atlassian
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-ink-3">{p.reason}</p>
              </div>
              <button
                disabled={busy === p.userId}
                onClick={() => openDm(p.userId)}
                className="shrink-0 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                <MessageSquarePlus size={13} className="mr-1 inline" />
                Message
              </button>
              <DismissButton onClick={() => feedback.mutate({ kind: 'PERSON', refId: p.userId, action: 'DISMISSED' })} />
            </div>
          ))}
        </Section>

        {/* R2: channels */}
        <Section icon={<Hash size={14} />} title="Channels to join" count={channelRows.length}>
          {channels.isLoading && <Skeleton />}
          {!channels.isLoading && channelRows.length === 0 && <Empty>You're in all the busy channels.</Empty>}
          {channelRows.map((c) => (
            <div key={c.channelId} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-hovered">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-hovered text-ink-3">
                <Hash size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                <p className="truncate text-xs text-ink-3">
                  {c.reason} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
                </p>
              </div>
              <button
                disabled={busy === c.channelId}
                onClick={() => joinChannel(c.channelId)}
                className="shrink-0 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                Join
              </button>
              <DismissButton onClick={() => feedback.mutate({ kind: 'CHANNEL', refId: c.channelId, action: 'DISMISSED' })} />
            </div>
          ))}
        </Section>

        {/* R9: follow-ups */}
        {followupRows.length > 0 && (
          <Section icon={<ClipboardCheck size={14} />} title="Follow-ups" count={followupRows.length}>
            {followupRows.map((f) => (
              <button
                key={f.id}
                onClick={() => f.channelId && onNavigate({ kind: 'channel', id: f.channelId })}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-hovered"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.title}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    f.overdue ? 'bg-red-500/15 text-red-500' : 'bg-hovered text-ink-3'
                  }`}
                >
                  {f.reason}
                </span>
              </button>
            ))}
          </Section>
        )}
      </div>
    </PaneShell>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Dismiss suggestion"
      title="Not interested"
      className="shrink-0 rounded p-1 text-ink-3 opacity-0 hover:bg-hovered hover:text-ink group-hover:opacity-100"
    >
      <X size={14} />
    </button>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2 px-3 text-[13px] font-semibold text-ink-2">
        <span className="text-ink-3">{icon}</span>
        {title}
        {count > 0 && <span className="text-ink-3">· {count}</span>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-sm text-ink-3">{children}</p>;
}

function Skeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-hovered" />
      ))}
    </div>
  );
}
