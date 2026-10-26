'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useWorkspaces } from '@/hooks/queries';
import { PaneShell } from '../pane-shell';
import { ApplicationSummary } from './application-summary';
import { ApplicationFilters, type StatusFilter } from './application-filters';
import { ApplicationCard, ApplicationCardSkeleton } from './application-card';
import { ApplicationPreviewModal } from './application-preview-modal';
import { ConnectApplicationDialog } from './connect-application-dialog';
import { ApplicationsWorkspaceContext, useApplications } from './use-applications';
import type { Application } from './types';

/**
 * Application Hub: the tools this workspace has connected, with their live
 * status read through each connection, and the ones still to connect. No
 * sample data — an unconnected application shows no figures.
 */
function ApplicationsHub({ isAdmin }: { isAdmin: boolean }) {
  const appsQ = useApplications();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [connectId, setConnectId] = useState<string | null>(null);

  const apps = useMemo(() => appsQ.data ?? [], [appsQ.data]);
  // Look apps up by id so dialogs always show the latest data after a refetch.
  const previewApp = apps.find((a) => a.id === previewId) ?? null;
  const connectApp = apps.find((a) => a.id === connectId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return apps
      .filter((a) => (status === 'all' ? true : a.status === status))
      .filter((a) =>
        needle ? [a.name, a.description, a.category].some((f) => f.toLowerCase().includes(needle)) : true,
      )
      // Connected first, those needing attention on top; then the ones to connect.
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [apps, query, status]);

  const startConnect = (app: Application) => {
    if (app.connectVia === 'atlassian') {
      // Atlassian connects through its own OAuth flow in Workspace settings.
      window.dispatchEvent(new CustomEvent('bs:open-dialog', { detail: 'atlassian' }));
      return;
    }
    setPreviewId(null);
    setConnectId(app.id);
  };

  return (
    <PaneShell
      icon={<LayoutGrid size={18} className="text-accent" />}
      title="Applications"
      subtitle="Live status of the tools your workspace has connected."
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <ApplicationSummary apps={apps} />
        <ApplicationFilters query={query} onQuery={setQuery} status={status} onStatus={setStatus} />

        {appsQ.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <ApplicationCardSkeleton key={i} />
            ))}
          </div>
        ) : appsQ.isError ? (
          <div className="rounded-xl border border-dashed border-line bg-elevated py-12 text-center">
            <p className="text-[14px] font-semibold text-ink">Unable to load applications</p>
            <button
              onClick={() => void appsQ.refetch()}
              className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hovered"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-elevated py-12 text-center" data-testid="applications-empty">
            <p className="text-[14px] font-semibold text-ink">No applications found</p>
            <p className="mt-1 text-[13px] text-ink-3">Try another search or clear your filters.</p>
            <button
              onClick={() => {
                setQuery('');
                setStatus('all');
              }}
              className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hovered"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="applications-grid">
            {filtered.map((app) => (
              <ApplicationCard
                key={app.id}
                app={app}
                isAdmin={isAdmin}
                onView={() => setPreviewId(app.id)}
                onConnect={() => startConnect(app)}
              />
            ))}
          </div>
        )}
      </div>

      {previewApp && previewApp.connected && (
        <ApplicationPreviewModal
          app={previewApp}
          canManage={isAdmin}
          onClose={() => setPreviewId(null)}
          onManage={() => startConnect(previewApp)}
        />
      )}
      {connectApp && connectApp.catalog && (
        <ConnectApplicationDialog app={connectApp} onClose={() => setConnectId(null)} />
      )}
    </PaneShell>
  );
}

function rank(a: Application): number {
  if (!a.connected) return 4;
  return a.status === 'critical' ? 0 : a.status === 'warning' ? 1 : a.status === 'unknown' ? 2 : 3;
}

export function ApplicationsPane({ workspaceId }: { workspaceId?: string | null }) {
  const workspaces = useWorkspaces();
  const role = workspaces.data?.find((w) => w.id === workspaceId)?.myRole;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  return (
    <ApplicationsWorkspaceContext.Provider value={workspaceId ?? null}>
      <ApplicationsHub isAdmin={isAdmin} />
    </ApplicationsWorkspaceContext.Provider>
  );
}
