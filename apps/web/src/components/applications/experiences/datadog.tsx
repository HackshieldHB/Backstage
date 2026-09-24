'use client';

import type { DatadogData, DatadogIncident, DatadogService } from '../types';
import { clockTime, SectionLabel, StatTile, StatusDot } from '../primitives';
import type { ExperienceProps, Tab } from './index';

/** Datadog reads as observability: service health, monitors, incidents, infra. */
export const datadogTabs: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'services', label: 'Services' },
  { id: 'monitors', label: 'Monitors' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'infrastructure', label: 'Infrastructure' },
];

function ServiceRow({ s }: { s: DatadogService }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <StatusDot status={s.status} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{s.name}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{s.latencyMs}ms</span>
      <span
        className={`w-14 shrink-0 text-right text-[11px] tabular-nums ${s.errorRate >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-ink-3'}`}
      >
        {s.errorRate.toFixed(1)}% err
      </span>
    </li>
  );
}

function IncidentRow({ i }: { i: DatadogIncident }) {
  const sev =
    i.severity === 'sev1'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : i.severity === 'sev2'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-gray-400/10 text-ink-3';
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sev}`}>{i.severity}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink">{i.title}</div>
        <div className="text-[11px] text-ink-3">
          {clockTime(i.at)}
          {i.resolved ? ' · resolved' : ' · investigating'}
        </div>
      </div>
    </li>
  );
}

export function DatadogExperience({ data, variant, activeTab }: ExperienceProps<DatadogData>) {
  const tab = variant === 'modal' ? 'overview' : activeTab;

  if (tab === 'services') {
    return (
      <div>
        <SectionLabel>Service health ({data.services.length})</SectionLabel>
        <ul className="divide-y divide-line">{data.services.map((s) => <ServiceRow key={s.name} s={s} />)}</ul>
      </div>
    );
  }

  if (tab === 'monitors') {
    const degraded = data.services.filter((s) => s.status !== 'healthy').length;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Monitors" value={data.monitors} />
          <StatTile label="Degraded services" value={degraded} tone={degraded ? 'text-amber-600 dark:text-amber-400' : undefined} />
        </div>
        <p className="text-[12px] text-ink-3">
          {degraded === 0 ? 'All monitored services within thresholds.' : `${degraded} service(s) breaching a monitor threshold.`}
        </p>
      </div>
    );
  }

  if (tab === 'incidents') {
    return (
      <div>
        <SectionLabel>Incidents</SectionLabel>
        <ul className="divide-y divide-line">{data.incidents.map((i) => <IncidentRow key={i.id} i={i} />)}</ul>
      </div>
    );
  }

  if (tab === 'infrastructure') {
    return (
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Hosts" value={data.hosts} />
        <StatTile label="Services" value={data.services.length} />
        <StatTile label="Monitors" value={data.monitors} />
      </div>
    );
  }

  // Overview — operational state first
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Service health</SectionLabel>
        <ul className="divide-y divide-line">
          {data.services.slice(0, variant === 'modal' ? 4 : 99).map((s) => <ServiceRow key={s.name} s={s} />)}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Monitors" value={data.monitors} />
        <StatTile
          label="Active incidents"
          value={data.activeIncidents}
          tone={data.activeIncidents ? 'text-amber-600 dark:text-amber-400' : undefined}
        />
      </div>
      <div>
        <SectionLabel>Recent incidents</SectionLabel>
        <ul className="divide-y divide-line">
          {data.incidents.slice(0, variant === 'modal' ? 2 : 99).map((i) => <IncidentRow key={i.id} i={i} />)}
        </ul>
      </div>
    </div>
  );
}
