'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useRealtime, useTypingJanitor } from '@/hooks/use-realtime';
import { useQueryClient } from '@tanstack/react-query';
import {
  keys,
  useChannels,
  useConversations,
  useWorkspaces,
  type Container,
} from '@/hooks/queries';
import { api } from '@/lib/api';
import { useHuddle } from '@/hooks/use-huddle';
import { WorkspaceRail } from '@/components/workspace-rail';
import { Sidebar } from '@/components/sidebar';
import { MainPane } from '@/components/main-pane';
import { MeetingRoom } from '@/components/meeting/meeting-room';
import { RightPanelView } from '@/components/right-panel';
import { TeamTimelinePane } from '@/components/team-timeline-pane';
import { JiraPane } from '@/components/jira-pane';
import { ConfluencePane } from '@/components/confluence-pane';
import { ProjectsPane } from '@/components/projects-pane';
import { IncidentsPane } from '@/components/incidents-pane';
import { InboxPane } from '@/components/inbox-pane';
import { DiscoverPane } from '@/components/discover-pane';
import { AskDialog } from '@/components/ask-dialog';
import { SearchDialog } from '@/components/search-dialog';
import { CommandPalette } from '@/components/command-palette';
import { GettingStarted } from '@/components/getting-started';
import { ErrorBoundary } from '@/components/error-boundary';
import { ShortcutsHelp } from '@/components/shortcuts-help';
import { Toaster } from '@/components/toaster';

function AppShell() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuthStore();
  const { rightPanel, setRightPanel, searchOpen, setSearchOpen, sidebarOpen, toggleSidebar, mainView, setMainView } =
    useUiStore();

  const workspaces = useWorkspaces();
  const wsParam = params.get('ws');
  const workspaceId = useMemo(() => {
    if (wsParam && workspaces.data?.some((w) => w.id === wsParam)) return wsParam;
    return workspaces.data?.[0]?.id ?? null;
  }, [wsParam, workspaces.data]);

  const channels = useChannels(workspaceId ?? '');
  const conversations = useConversations(workspaceId ?? '');

  const cParam = params.get('c');
  const tParam = params.get('t');
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  const container: Container | null = useMemo(() => {
    if (cParam && tParam === 'dm') return { kind: 'conversation', id: cParam };
    if (cParam) return { kind: 'channel', id: cParam };
    const general = channels.data?.find((c) => c.isDefault) ?? channels.data?.[0];
    return general ? { kind: 'channel', id: general.id } : null;
  }, [cParam, tParam, channels.data]);

  const navigate = useCallback(
    (next: Container, highlight?: string) => {
      setHighlightMessageId(highlight ?? null);
      setRightPanel({ kind: 'none' });
      // Opening a channel/DM always returns to the chat view (out of Jira/etc panes).
      setMainView('chat');
      toggleSidebar(false);
      router.push(`/app?ws=${workspaceId}&c=${next.id}&t=${next.kind === 'conversation' ? 'dm' : 'ch'}`);
    },
    [router, workspaceId, setRightPanel, setMainView, toggleSidebar],
  );

  useRealtime(workspaceId);
  useTypingJanitor();

  // The huddle lives at the shell (not inside MainPane) so it keeps running when
  // you navigate to another channel or DM.
  const huddle = useHuddle();
  const huddleTarget = huddle.activeTarget;
  const huddleLabel = useMemo(() => {
    if (!huddleTarget) return undefined;
    if (huddleTarget.kind === 'channel') {
      const ch = channels.data?.find((c) => c.id === huddleTarget.id);
      return ch ? `#${ch.name}` : 'a channel';
    }
    const dm = conversations.data?.find((c) => c.id === huddleTarget.id);
    const others = dm?.members.filter((m) => m.id !== user?.id) ?? [];
    return others.length > 0 ? others.map((o) => o.displayName).join(', ') : 'a DM';
  }, [huddleTarget, channels.data, conversations.data, user?.id]);

  const qc = useQueryClient();
  // Open (or create) a DM with a user — fired from profile cards anywhere.
  useEffect(() => {
    const onOpenDm = async (e: Event) => {
      const userId = (e as CustomEvent<string>).detail;
      if (!workspaceId || !userId || userId === user?.id) return;
      try {
        const dm = await api<{ id: string }>('POST', `/workspaces/${workspaceId}/conversations`, {
          memberIds: [userId],
        });
        await qc.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
        navigate({ kind: 'conversation', id: dm.id });
      } catch {
        /* ignore — e.g. provisional target */
      }
    };
    window.addEventListener('bs:open-dm', onOpenDm);
    return () => window.removeEventListener('bs:open-dm', onOpenDm);
  }, [workspaceId, user?.id, qc, navigate]);

  // Pending invite from an /invite/<token> visit pre-login.
  useEffect(() => {
    const pending = window.localStorage.getItem('bs.pendingInvite');
    if (pending && user) {
      window.localStorage.removeItem('bs.pendingInvite');
      api<{ id: string }>('POST', '/invites/accept', { token: pending })
        .then((ws) => router.replace(`/app?ws=${ws.id}`))
        .catch(() => undefined);
    }
  }, [user, router]);

  // Global keyboard shortcuts. Cmd/Ctrl-K is owned by the CommandPalette; here we
  // only collapse the right panel on Escape when nothing modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !searchOpen) {
        setRightPanel({ kind: 'none' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setRightPanel, searchOpen]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-lg font-semibold text-sidebar dark:text-white">Backstages</div>
      </main>
    );
  }

  if (workspaces.isSuccess && workspaces.data.length === 0) {
    return <CreateFirstWorkspace onCreated={(id) => router.replace(`/app?ws=${id}`)} />;
  }

  if (!workspaceId) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading workspace…</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <WorkspaceRail
        workspaces={workspaces.data ?? []}
        activeId={workspaceId}
        onSelect={(id) => router.push(`/app?ws=${id}`)}
      />
      <div
        className={`${sidebarOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-14 z-40 md:static md:flex`}
      >
        <Sidebar
          workspaceId={workspaceId}
          container={container}
          onNavigate={navigate}
          channels={channels.data ?? []}
          conversations={conversations.data ?? []}
        />
      </div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => toggleSidebar(false)} />
      )}
      {huddle.joined && <MeetingRoom huddle={huddle} label={huddleLabel} workspaceId={workspaceId} />}
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <ErrorBoundary key={`${mainView}:${container?.id ?? 'none'}`}>
          {mainView === 'timeline' ? (
            <TeamTimelinePane workspaceId={workspaceId} />
          ) : mainView === 'jira' ? (
            <JiraPane workspaceId={workspaceId} />
          ) : mainView === 'confluence' ? (
            <ConfluencePane workspaceId={workspaceId} />
          ) : mainView === 'projects' ? (
            <ProjectsPane workspaceId={workspaceId} />
          ) : mainView === 'incidents' ? (
            <IncidentsPane workspaceId={workspaceId} />
          ) : mainView === 'inbox' ? (
            <InboxPane workspaceId={workspaceId} onNavigate={navigate} />
          ) : mainView === 'discover' ? (
            <DiscoverPane workspaceId={workspaceId} onNavigate={navigate} />
          ) : container ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <GettingStarted workspaceId={workspaceId} />
              <MainPane
                key={container.id}
                workspaceId={workspaceId}
                container={container}
                huddle={huddle}
                highlightMessageId={highlightMessageId}
                clearHighlight={() => setHighlightMessageId(null)}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              Pick a channel to get started
            </div>
          )}
        </ErrorBoundary>
      </main>
      {mainView === 'chat' && rightPanel.kind !== 'none' && container && (
        <ErrorBoundary key={`right:${rightPanel.kind}`}>
          <RightPanelView
            workspaceId={workspaceId}
            container={container}
            panel={rightPanel}
            onNavigate={navigate}
          />
        </ErrorBoundary>
      )}
      {searchOpen && (
        <SearchDialog
          workspaceId={workspaceId}
          onClose={() => setSearchOpen(false)}
          onJump={(c, messageId) => {
            setSearchOpen(false);
            navigate(c, messageId);
          }}
        />
      )}
      <ShortcutsHelp />
      <CommandPalette />
      <AskDialog workspaceId={workspaceId} onNavigate={navigate} />
      <Toaster />
    </div>
  );
}

function CreateFirstWorkspace({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <form
        className="w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-sm dark:border-line dark:bg-gray-900"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ws = await api<{ id: string }>('POST', '/workspaces', { name });
          await qc.invalidateQueries({ queryKey: keys.workspaces });
          onCreated(ws.id);
        }}
      >
        <h1 className="mb-1 text-lg font-semibold">Create your workspace</h1>
        <p className="mb-4 text-sm text-gray-500">A home for your team&apos;s conversations.</p>
        <input
          className="mb-3 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800"
          placeholder="Workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          data-testid="workspace-name"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="workspace-create"
        >
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </main>
  );
}

export default function AppPage() {
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
