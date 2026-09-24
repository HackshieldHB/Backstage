'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { PaneShell } from '../pane-shell';
import { ActivityFeed, SectionLabel } from './primitives';
import { ApplicationSummary } from './application-summary';
import { ApplicationFilters, type StatusFilter } from './application-filters';
import { ApplicationCard, ApplicationCardSkeleton } from './application-card';
import { ApplicationPreviewModal } from './application-preview-modal';
import { ApplicationDetail } from './application-detail';
import { useApplications, useGlobalActivity } from './use-applications';
import type { Application } from './types';

/**
 * Application Hub — the enterprise application command center. Generic at the
 * platform level (summary, search, filters, grid, preview shell); the per-app
 * experiences it opens are domain-specific.
 */
export function ApplicationsPane() {
  const appsQ = useApplications();
  const activityQ = useGlobalActivity();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [previewApp, setPreviewApp] = useState<Application | null>(null);
  const [detailApp, setDetailApp] = useState<Application | null>(null);

  const apps = appsQ.data ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return apps
      .filter((a) => (status === 'all' ? true : a.status === status))
      .filter((a) =>
        needle
          ? [a.name, a.description, a.tagline, a.category].some((f) => f.toLowerCase().includes(needle))
          : true,
      )
      // Applications needing attention float to the top by default.
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [apps, query, status]);

  const globalActivity = useMemo(
    () =>
      (activityQ.data ?? []).map((g) => ({
        id: g.id,
        at: g.at,
        text: g.text,
        tone: g.tone,
        app: apps.find((a) => a.id === g.appId)?.name ?? g.appId,
      })),
    [activityQ.data, apps],
  );

  if (detailApp) {
    return (
      <PaneShell icon={<LayoutGrid size={18} className="text-accent" />} title="Applications" subtitle="Application detail">
        <ApplicationDetail app={detailApp} onBack={() => setDetailApp(null)} />
      </PaneShell>
    );
  }

  return (
    <PaneShell
      icon={<LayoutGrid size={18} className="text-accent" />}
      title="Applications"
      subtitle="Your enterprise tools, activity, and operational status in one place."
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <ApplicationSummary apps={apps} />
        <ApplicationFilters query={query} onQuery={setQuery} status={status} onStatus={setStatus} />

        {appsQ.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
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
              <ApplicationCard key={app.id} app={app} onView={() => setPreviewApp(app)} />
            ))}
          </div>
        )}

        {globalActivity.length > 0 && (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <SectionLabel>Recent activity across applications</SectionLabel>
            <ActivityFeed items={globalActivity} />
          </div>
        )}
      </div>

      {previewApp && (
        <ApplicationPreviewModal
          app={previewApp}
          onClose={() => setPreviewApp(null)}
          onOpenDetail={() => {
            setDetailApp(previewApp);
            setPreviewApp(null);
          }}
        />
      )}
    </PaneShell>
  );
}

function rank(a: Application): number {
  return a.status === 'critical' ? 0 : a.status === 'warning' ? 1 : a.status === 'unknown' ? 2 : 3;
}
