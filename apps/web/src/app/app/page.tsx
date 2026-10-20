'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore, type RightPanel } from '@/stores/ui-store';
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
import { useHuddleRecording } from '@/hooks/use-huddle-recording';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
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
import { ApplicationsPane } from '@/components/applications/applications-pane';
import { TasksPane } from '@/components/tasks-pane';
import { MyDayPane } from '@/components/my-day-pane';
import { CalendarPane } from '@/components/calendar-pane';
import { MeetingDetailDialog } from '@/components/meeting-detail';
import { FeedbackDialog } from '@/components/feedback-dialog';
import { setUsageWorkspace, track, trackView } from '@/lib/usage';
import { AskDialog } from '@/components/ask-dialog';
import { SearchDialog } from '@/components/search-dialog';
import { CommandPalette } from '@/components/command-palette';
import { GettingStarted } from '@/components/getting-started';
import { ErrorBoundary } from '@/components/error-boundary';
import { ShortcutsHelp } from '@/components/shortcuts-help';
import { Toaster } from '@/components/toaster';

/** Right-panel views that are workspace-wide (not tied to the open channel), so
 *  they can open over any main view — Tasks, Inbox, Discover… */
const WORKSPACE_PANELS = new Set<RightPanel['kind']>(['activity', 'saved', 'threads', 'thread']);

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

  // Feature-usage analytics: which areas of the app people actually open.
  useEffect(() => {
    setUsageWorkspace(workspaceId);
  }, [workspaceId]);
  useEffect(() => {
    if (workspaceId) trackView(mainView);
  }, [workspaceId, mainView]);
  useEffect(() => {
    if (searchOpen) track('search:open');
  }, [searchOpen]);

  // Back from connecting Google/GitHub in Account security: finish the link with
  // this session (the server checks it's the same person who started it).
  const linkCode = params.get('oauth-link');
  const linkError = params.get('oauth-link-error');
  useEffect(() => {
    if (!user || (!linkCode && !linkError)) return;
    const clean = () => {
      const next = new URLSearchParams(window.location.search);
      next.delete('oauth-link');
      next.delete('oauth-link-error');
      router.replace(`/app${next.toString() ? `?${next}` : ''}`);
    };
    const toast = useUiStore.getState().pushToast;
    if (linkError) {
      toast(
        linkError === 'denied'
          ? 'Connecting was cancelled.'
          : linkError === 'expired'
            ? 'That took too long — try connecting again.'
            : 'Could not connect that account. Please try again.',
        'error',
      );
      clean();
      return;
    }
    if (!linkCode || handledLinkCodes.has(linkCode)) return; // single-use; StrictMode runs effects twice
    handledLinkCodes.add(linkCode);
    api<import('@backstages/shared').ConnectedAccountsDto>('POST', '/auth/oauth/link/confirm', { code: linkCode })
      .then((res) => {
        qc.setQueryData(['connected-accounts'], res);
        toast('Account connected — you can now sign in with it.', 'success');
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not connect that account.', 'error'))
      .finally(clean);
    // Run once per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, linkCode, linkError]);

  // Back from "Connect GitHub" (to create issues): finish it with this session.
  const githubCode = params.get('github-connect');
  useEffect(() => {
    if (!user || !githubCode || handledLinkCodes.has(githubCode)) return;
    handledLinkCodes.add(githubCode);
    const toast = useUiStore.getState().pushToast;
    api<import('@backstages/shared').GithubConnectionDto>('POST', '/me/github/connect/confirm', { code: githubCode })
      .then((res) => {
        qc.setQueryData(['github-connection'], res);
        toast(`GitHub connected as @${res.login} — you can now create issues from messages.`, 'success');
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not connect GitHub.', 'error'))
      .finally(() => {
        const next = new URLSearchParams(window.location.search);
        next.delete('github-connect');
        router.replace(`/app${next.toString() ? `?${next}` : ''}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, githubCode]);

  // The huddle lives at the shell (not inside MainPane) so it keeps running when
  // you navigate to another channel or DM.
  const huddle = useHuddle();
  const huddleRecording = useHuddleRecording(huddle, workspaceId);
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
    if (pending && user && !user.needsOnboarding) {
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

  // First run (new social sign-up, or no workspace yet): the /welcome flow.
  const needsWelcome = !!user && (!!user.needsOnboarding || (workspaces.isSuccess && workspaces.data.length === 0));
  useEffect(() => {
    if (needsWelcome) router.replace('/welcome');
  }, [needsWelcome, router]);

  if (loading || !user || needsWelcome) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-lg font-semibold text-sidebar dark:text-white">Backstages</div>
      </main>
    );
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
      {huddle.joined && <MeetingRoom huddle={huddle} label={huddleLabel} workspaceId={workspaceId} recording={huddleRecording} />}
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <VerifyEmailBanner />
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
          ) : mainView === 'myday' ? (
            <MyDayPane workspaceId={workspaceId} onNavigate={navigate} />
          ) : mainView === 'tasks' ? (
            <TasksPane workspaceId={workspaceId} onNavigate={navigate} />
          ) : mainView === 'calendar' ? (
            <CalendarPane workspaceId={workspaceId} />
          ) : mainView === 'applications' ? (
            <ApplicationsPane workspaceId={workspaceId} />
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
      {rightPanel.kind !== 'none' &&
        container &&
        (mainView === 'chat' || WORKSPACE_PANELS.has(rightPanel.kind)) && (
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
      <MeetingDetailDialog huddle={huddle} onNavigate={navigate} />
      <FeedbackDialog workspaceId={workspaceId} />
      <ShortcutsHelp />
      <CommandPalette />
      <AskDialog workspaceId={workspaceId} onNavigate={navigate} />
      <Toaster />
    </div>
  );
}

/** Link codes already confirmed in this page load. */
const handledLinkCodes = new Set<string>();

export default function AppPage() {
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
