'use client';

import type { AtlassianData, AtlassianProduct } from '../types';
import { ActivityFeed, SectionLabel, StatRow, StatTile, StatusDot, StatusPill } from '../primitives';
import type { ExperienceProps, Tab } from './index';

/** Atlassian reads as a suite: multiple products, projects, spaces, requests. */
export const atlassianTabs: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'jira', label: 'Jira' },
  { id: 'confluence', label: 'Confluence' },
  { id: 'jsm', label: 'JSM' },
  { id: 'activity', label: 'Activity' },
];

function ProductCard({ p }: { p: AtlassianProduct }) {
  return (
    <div className="rounded-xl border border-line bg-elevated p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-ink">{p.name}</span>
        <StatusDot status={p.status} />
      </div>
      <div className="mt-1 text-[20px] font-semibold leading-tight text-ink">{p.metricValue}</div>
      <div className="text-[11px] text-ink-3">{p.metricLabel}</div>
    </div>
  );
}

function ProductDetail({ p, data }: { p: AtlassianProduct; data: AtlassianData }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{p.name}</h3>
        <StatusPill status={p.status} compact />
      </div>
      <div className="rounded-xl border border-line bg-elevated p-4">
        <StatRow label={p.metricLabel} value={p.metricValue} />
        {p.key === 'jira' && <StatRow label="Open issues" value={data.openIssues.toLocaleString()} />}
        <StatRow label="Users with access" value={data.users} />
      </div>
    </div>
  );
}

export function AtlassianExperience({ data, variant, activeTab }: ExperienceProps<AtlassianData>) {
  const tab = variant === 'modal' ? 'overview' : activeTab;

  const product = (key: AtlassianProduct['key']) => data.products.find((p) => p.key === key);
  if (tab === 'jira' && product('jira')) return <ProductDetail p={product('jira')!} data={data} />;
  if (tab === 'confluence' && product('confluence')) return <ProductDetail p={product('confluence')!} data={data} />;
  if (tab === 'jsm' && product('jsm')) return <ProductDetail p={product('jsm')!} data={data} />;

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
      <div>
        <SectionLabel>Products</SectionLabel>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {data.products.map((p) => <ProductCard key={p.key} p={p} />)}
        </div>
      </div>
      <div>
        <SectionLabel>Workspace overview</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Users" value={data.users} />
          <StatTile label="Projects" value={data.projects} />
          <StatTile label="Open issues" value={data.openIssues.toLocaleString()} />
        </div>
      </div>
      {variant === 'detail' && (
        <div>
          <SectionLabel>Recent activity</SectionLabel>
          <ActivityFeed items={data.activity} />
        </div>
      )}
    </div>
  );
}
