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
import { WorkspaceRail } from '@/components/workspace-rail';
import { Sidebar } from '@/components/sidebar';
import { MainPane } from '@/components/main-pane';
import { RightPanelView } from '@/components/right-panel';
import { SearchDialog } from '@/components/search-dialog';

function AppShell() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuthStore();
  const { rightPanel, setRightPanel, searchOpen, setSearchOpen, sidebarOpen, toggleSidebar } =
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
      toggleSidebar(false);
      router.push(`/app?ws=${workspaceId}&c=${next.id}&t=${next.kind === 'conversation' ? 'dm' : 'ch'}`);
    },
    [router, workspaceId, setRightPanel, toggleSidebar],
  );

  useRealtime(workspaceId);
  useTypingJanitor();

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

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && !searchOpen) {
        setRightPanel({ kind: 'none' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen, setRightPanel, searchOpen]);

  // Ask for desktop notification permission once.
  useEffect(() => {
    if (user && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [user]);

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
    <div className="flex h-screen overflow-hidden">
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
      <main className="flex min-w-0 flex-1 flex-col">
        {container ? (
          <MainPane
            key={container.id}
            workspaceId={workspaceId}
            container={container}
            highlightMessageId={highlightMessageId}
            clearHighlight={() => setHighlightMessageId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            Pick a channel to get started
          </div>
        )}
      </main>
      {rightPanel.kind !== 'none' && container && (
        <RightPanelView
          workspaceId={workspaceId}
          container={container}
          panel={rightPanel}
          onNavigate={navigate}
        />
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
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
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
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
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
