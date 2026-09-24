'use client';

import type { LaunchDarklyData, LaunchDarklyFlag } from '../types';
import { ProgressBar, relativeTime, SectionLabel, StatTile, StatusDot } from '../primitives';
import type { ExperienceProps, Tab } from './index';

/** LaunchDarkly reads as release control: flags, environments, rollouts, changes. */
export const launchDarklyTabs: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'flags', label: 'Flags' },
  { id: 'environments', label: 'Environments' },
  { id: 'rollouts', label: 'Rollouts' },
  { id: 'changes', label: 'Changes' },
];

function FlagState({ f }: { f: LaunchDarklyFlag }) {
  if (f.state === 'on')
    return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> ON</span>;
  if (f.state === 'off')
    return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-3"><span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> OFF</span>;
  return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-600 dark:text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {f.rollout}% rollout</span>;
}

function FlagRow({ f }: { f: LaunchDarklyFlag }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{f.key}</code>
      <span className="shrink-0 text-[11px] text-ink-3">{f.environment}</span>
      <span className="w-24 shrink-0 text-right"><FlagState f={f} /></span>
    </li>
  );
}

export function LaunchDarklyExperience({ data, variant, activeTab }: ExperienceProps<LaunchDarklyData>) {
  const tab = variant === 'modal' ? 'overview' : activeTab;

  if (tab === 'flags') {
    return (
      <div>
        <SectionLabel>Feature flags ({data.featureFlags})</SectionLabel>
        <ul className="divide-y divide-line">
          {data.flags.map((f) => <FlagRow key={f.key} f={f} />)}
        </ul>
      </div>
    );
  }

  if (tab === 'environments') {
    return (
      <div>
        <SectionLabel>Environments</SectionLabel>
        <ul className="divide-y divide-line">
          {data.environments.map((e) => (
            <li key={e.name} className="flex items-center gap-3 py-2.5">
              <StatusDot status={e.status} />
              <span className="flex-1 text-[13px] font-medium text-ink">{e.name}</span>
              <span className="text-[12px] text-ink-3">{e.flagsEnabled} enabled</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (tab === 'rollouts') {
    const rollouts = data.flags.filter((f) => f.state === 'rollout');
    return (
      <div>
        <SectionLabel>Active rollouts</SectionLabel>
        {rollouts.length === 0 ? (
          <p className="text-[13px] text-ink-3">No progressive rollouts in flight.</p>
        ) : (
          <div className="space-y-3">
            {rollouts.map((f) => (
              <div key={f.key}>
                <div className="mb-1 flex items-center justify-between text-[12.5px]">
                  <code className="font-mono text-ink">{f.key}</code>
                  <span className="font-medium text-amber-600 dark:text-amber-400">{f.rollout}%</span>
                </div>
                <ProgressBar pct={f.rollout ?? 0} tone="bg-amber-500" />
                <div className="mt-1 text-[11px] text-ink-3">{f.environment}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (tab === 'changes') {
    return (
      <div>
        <SectionLabel>Recent changes</SectionLabel>
        <ul className="divide-y divide-line">
          {data.changes.map((c) => (
            <li key={c.id} className="py-2.5">
              <div className="text-[13px] text-ink">{c.text}</div>
              <div className="text-[11px] text-ink-3">{c.by} · {relativeTime(c.at)}</div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Overview
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Feature flags" value={data.featureFlags} />
        <StatTile label="Enabled" value={data.enabled} tone="text-emerald-600 dark:text-emerald-400" />
        <StatTile label="Disabled" value={data.disabled} tone="text-ink-2" />
      </div>
      <div>
        <SectionLabel>Feature flags</SectionLabel>
        <ul className="divide-y divide-line">
          {data.flags.slice(0, variant === 'modal' ? 3 : 6).map((f) => <FlagRow key={f.key} f={f} />)}
        </ul>
      </div>
      <div>
        <SectionLabel>Environments</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {data.environments.map((e) => (
            <span key={e.name} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-elevated px-2.5 py-1 text-[12px] text-ink">
              <StatusDot status={e.status} /> {e.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
