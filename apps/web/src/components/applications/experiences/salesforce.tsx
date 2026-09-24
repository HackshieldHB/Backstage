'use client';

import type { IntegrationHealth, SalesforceData, SalesforceIntegration } from '../types';
import { ActivityFeed, ProgressBar, relativeTime, SectionLabel, StatTile } from '../primitives';
import type { ExperienceProps, Tab } from './index';

/** Salesforce reads as a CRM/platform: users, API consumption, integrations. */
export const salesforceTabs: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'api', label: 'API' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'activity', label: 'Activity' },
];

const HEALTH: Record<IntegrationHealth, { label: string; dot: string; text: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  delayed: { label: 'Delayed', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  failed: { label: 'Failed', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
};

function IntegrationRow({ it }: { it: SalesforceIntegration }) {
  const h = HEALTH[it.health];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${h.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">{it.name}</div>
        <div className="text-[11px] text-ink-3">Last sync {relativeTime(it.lastSync)}</div>
      </div>
      <span className={`shrink-0 text-[12px] font-medium ${h.text}`}>{h.label}</span>
    </li>
  );
}

function ApiUsage({ data }: { data: SalesforceData }) {
  const tone = data.apiUsagePct >= 90 ? 'bg-red-500' : data.apiUsagePct >= 75 ? 'bg-amber-500' : 'bg-accent';
  return (
    <div className="rounded-xl border border-line bg-elevated p-4">
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span className="font-medium text-ink">Daily API usage</span>
        <span className={`font-semibold ${data.apiUsagePct >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-ink'}`}>
          {data.apiUsagePct}%
        </span>
      </div>
      <ProgressBar pct={data.apiUsagePct} tone={tone} />
      <div className="mt-1.5 text-[11px] text-ink-3">{data.apiLimit}</div>
    </div>
  );
}

export function SalesforceExperience({ data, variant, activeTab }: ExperienceProps<SalesforceData>) {
  const tab = variant === 'modal' ? 'overview' : activeTab;

  if (tab === 'users') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Active users" value={data.activeUsers} />
        <StatTile label="Integrations" value={data.integrations.length} />
      </div>
    );
  }

  if (tab === 'api') {
    return (
      <div>
        <SectionLabel>API consumption</SectionLabel>
        <ApiUsage data={data} />
      </div>
    );
  }

  if (tab === 'integrations') {
    return (
      <div>
        <SectionLabel>Integration health</SectionLabel>
        <ul className="divide-y divide-line">{data.integrations.map((it) => <IntegrationRow key={it.name} it={it} />)}</ul>
      </div>
    );
  }

  if (tab === 'activity') {
    return (
      <div>
        <SectionLabel>Recent activity</SectionLabel>
        <ActivityFeed items={data.activity} />
      </div>
    );
  }

  // Overview
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Active users" value={data.activeUsers} />
        <StatTile label="API usage" value={`${data.apiUsagePct}%`} tone={data.apiUsagePct >= 75 ? 'text-amber-600 dark:text-amber-400' : undefined} />
        <StatTile label="Integrations" value={data.integrations.length} />
      </div>
      <ApiUsage data={data} />
      <div>
        <SectionLabel>Integration health</SectionLabel>
        <ul className="divide-y divide-line">
          {data.integrations.slice(0, variant === 'modal' ? 3 : 99).map((it) => <IntegrationRow key={it.name} it={it} />)}
        </ul>
      </div>
    </div>
  );
}
