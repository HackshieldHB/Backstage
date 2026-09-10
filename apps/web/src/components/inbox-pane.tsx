'use client';

import { formatDistanceToNow } from 'date-fns';
import { AtSign, ExternalLink, Inbox, MessagesSquare, SquareKanban, Zap } from 'lucide-react';
import {
  useMyJiraIssues,
  useMyThreads,
  useNotifications,
  usePriorityInbox,
  type Container,
} from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { useAtlassianStatus } from './atlassian-dialog';
import { MessageBody } from './message-body';
import { Avatar } from './avatar';
import { PaneShell } from './pane-shell';

const ago = (iso: string) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

/** Unified, prioritized inbox: what needs you (Jira) → conversations you're in
 *  (threads) → everything else (activity). Composed from existing feeds. */
export function InboxPane({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate: (c: Container, messageId?: string) => void;
}) {
  const atlassian = useAtlassianStatus(workspaceId);
  const jira = useMyJiraIssues(workspaceId, !!atlassian.data?.connected);
  const threads = useMyThreads(workspaceId);
  const notifications = useNotifications();
  const priority = usePriorityInbox(workspaceId);
  const setRightPanel = useUiStore((s) => s.setRightPanel);

  const jiraRows = jira.data ?? [];
  const threadRows = threads.data?.threads ?? [];
  const notifRows = notifications.data?.notifications ?? [];
  const priorityRows = priority.data?.items ?? [];

  return (
    <PaneShell icon={<Inbox size={18} className="text-accent" />} title="Inbox" subtitle="Everything that needs you">
      <div className="mx-auto max-w-3xl space-y-6">
        {priorityRows.length > 0 && (
          <Section icon={<Zap size={14} />} title="Top priority" count={priorityRows.length}>
            {priorityRows.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (p.channelId) onNavigate({ kind: 'channel', id: p.channelId }, p.messageId ?? undefined);
                  else if (p.conversationId)
                    onNavigate({ kind: 'conversation', id: p.conversationId }, p.messageId ?? undefined);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-hovered"
              >
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    p.score >= 0.85 ? 'bg-red-500' : p.score >= 0.6 ? 'bg-amber-500' : 'bg-accent'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{p.reason}</span>
                  {p.preview && <span className="line-clamp-1 text-[12px] text-ink-3">{p.preview}</span>}
                </span>
                <span className="shrink-0 text-[10px] font-semibold uppercase text-ink-3">{p.source}</span>
              </button>
            ))}
          </Section>
        )}
        <Section icon={<SquareKanban size={14} />} title="Assigned to you" count={jiraRows.length}>
          {jiraRows.length === 0 && <Empty>Nothing assigned in Jira.</Empty>}
          {jiraRows.map((i) => (
            <a key={i.key} href={i.url} target="_blank" rel="noreferrer" className="group flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-hovered">
              <span className="shrink-0 font-mono text-[11px] font-semibold text-accent">{i.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{i.summary}</span>
              {i.overdue ? (
                <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-500">Overdue</span>
              ) : i.status ? (
                <span className="shrink-0 rounded bg-hovered px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-3">{i.status}</span>
              ) : null}
              <ExternalLink size={12} className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
            </a>
          ))}
        </Section>

        <Section icon={<MessagesSquare size={14} />} title="Threads" count={threadRows.length}>
          {threadRows.length === 0 && <Empty>No active threads.</Empty>}
          {threadRows.map(({ message, containerLabel }) => (
            <button
              key={message.id}
              onClick={() => {
                const c: Container = message.channelId
                  ? { kind: 'channel', id: message.channelId }
                  : { kind: 'conversation', id: message.conversationId! };
                onNavigate(c, message.id);
                setRightPanel({ kind: 'thread', messageId: message.id, from: 'threads' });
              }}
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-hovered"
            >
              <div className="mb-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                <Avatar user={message.user} size="xs" />
                <span className="font-medium text-ink-2">{message.user?.displayName ?? 'Someone'}</span>
                <span>in {containerLabel}</span>
              </div>
              <div className="line-clamp-1 text-sm text-ink"><MessageBody contentJson={message.contentJson} contentText={message.contentText} /></div>
            </button>
          ))}
        </Section>

        <Section icon={<AtSign size={14} />} title="Activity" count={notifications.data?.unreadCount ?? 0}>
          {notifRows.length === 0 && <Empty>You're all caught up.</Empty>}
          {notifRows.slice(0, 30).map((n) => (
            <button
              key={n.id}
              onClick={() => n.channelId && onNavigate({ kind: 'channel', id: n.channelId }, n.messageId ?? undefined)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-hovered"
            >
              <Avatar user={n.actor} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="text-sm text-ink">
                  <strong className="font-semibold">{n.actor?.displayName ?? 'Someone'}</strong>{' '}
                  <span className="text-ink-2">{n.preview ?? n.type.toLowerCase().replace(/_/g, ' ')}</span>
                </span>
                <span className="block text-[11px] text-ink-3">{n.channelName ? `#${n.channelName} · ` : ''}{ago(n.createdAt)}</span>
              </span>
              {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
            </button>
          ))}
        </Section>
      </div>
    </PaneShell>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        {icon} {title}
        {count > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-bold text-accent">{count}</span>}
      </div>
      <div className="rounded-xl border border-line bg-elevated p-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-3 text-[13px] text-ink-3">{children}</p>;
}
