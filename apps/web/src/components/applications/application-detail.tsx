'use client';

import { useState } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import type { Application } from './types';
import { ApplicationLogo } from './application-logo';
import { relativeTime, StatusPill } from './primitives';
import { useApplicationData } from './use-applications';
import { ApplicationExperience, getExperienceTabs, MonitoringUnavailable } from './experiences';

/** Deep-inspection view for one application (in-pane, matching the SPA shell). */
export function ApplicationDetail({ app, onBack }: { app: Application; onBack: () => void }) {
  const tabs = getExperienceTabs(app.experience);
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? 'overview');
  const dataQ = useApplicationData(app.id);

  return (
    <div className="mx-auto max-w-4xl">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-[12px] text-ink-3" aria-label="Breadcrumb">
        <button onClick={onBack} className="rounded px-1 py-0.5 font-medium hover:bg-hovered hover:text-ink" data-testid="detail-back">
          Applications
        </button>
        <ChevronRight size={13} />
        <span className="text-ink-2">{app.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <ApplicationLogo appId={app.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">{app.name}</h1>
          <p className="text-[13px] text-ink-3">{app.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={app.status} reason={app.statusReason} />
            <span className="text-[12px] text-ink-3">Last checked {relativeTime(app.lastChecked)}</span>
          </div>
        </div>
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover"
          data-testid="detail-open-app"
        >
          Open {app.name} <ExternalLink size={14} />
        </a>
      </div>

      {app.status === 'warning' && (
        <div className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-300">
          {app.statusReason}
        </div>
      )}

      {/* Domain-specific tabs */}
      <div className="mt-5 flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label={`${app.name} sections`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            data-testid={`detail-tab-${t.id}`}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              activeTab === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="py-5">
        {dataQ.isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-hovered" />
              ))}
            </div>
            <div className="h-40 animate-pulse rounded-xl bg-hovered" />
          </div>
        ) : dataQ.data && dataQ.data.ok ? (
          <ApplicationExperience appData={dataQ.data.data} variant="detail" activeTab={activeTab} />
        ) : (
          <MonitoringUnavailable
            reason={dataQ.data && !dataQ.data.ok ? dataQ.data.reason : 'Monitoring unavailable'}
            lastSuccessfulSync={dataQ.data && !dataQ.data.ok ? dataQ.data.lastSuccessfulSync : app.lastChecked}
            onRetry={() => void dataQ.refetch()}
          />
        )}
      </div>
    </div>
  );
}
