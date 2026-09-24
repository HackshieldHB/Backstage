'use client';

import { LayoutDashboard, Users } from 'lucide-react';
import type { MiroData, MiroWorkspace } from '../types';
import { ActivityFeed, relativeTime, SectionLabel, StatTile } from '../primitives';
import type { ExperienceProps, Tab } from './index';

/** Miro reads as a collaboration product: people, workspaces, boards, activity. */
export const miroTabs: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'boards', label: 'Boards' },
  { id: 'activity', label: 'Activity' },
];

function WorkspaceCard({ w }: { w: MiroWorkspace }) {
  return (
    <div className="rounded-xl border border-line bg-elevated px-3.5 py-3">
      <div className="text-[13px] font-semibold text-ink">{w.name}</div>
      <div className="mt-1 flex items-center gap-3 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1"><Users size={12} /> {w.members} members</span>
        <span className="inline-flex items-center gap-1"><LayoutDashboard size={12} /> {w.boards} boards</span>
      </div>
    </div>
  );
}

export function MiroExperience({ data, variant, activeTab }: ExperienceProps<MiroData>) {
  const tab = variant === 'modal' ? 'overview' : activeTab;

  if (tab === 'workspaces') {
    return (
      <div>
        <SectionLabel>All workspaces</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.workspaces.map((w) => (
            <WorkspaceCard key={w.id} w={w} />
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'boards') {
    return (
      <div>
        <SectionLabel>Recently updated boards</SectionLabel>
        <ul className="divide-y divide-line">
          {data.recentBoards.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2.5">
              <LayoutDashboard size={15} className="shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{b.name}</div>
                <div className="text-[11px] text-ink-3">{b.workspace}</div>
              </div>
              <span className="shrink-0 text-[11px] text-ink-3">{relativeTime(b.updatedAt)}</span>
            </li>
          ))}
        </ul>
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
        <StatTile label="Active boards" value={data.activeBoards} />
        <StatTile label="Activity today" value={data.activityToday} />
      </div>
      <div>
        <SectionLabel>Workspaces</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.workspaces.slice(0, variant === 'modal' ? 2 : 4).map((w) => (
            <WorkspaceCard key={w.id} w={w} />
          ))}
        </div>
      </div>
      <div>
        <SectionLabel>Recent activity</SectionLabel>
        <ActivityFeed items={data.activity.slice(0, variant === 'modal' ? 3 : 99)} />
      </div>
    </div>
  );
}
