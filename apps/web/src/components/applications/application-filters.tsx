'use client';

import { Search } from 'lucide-react';
import type { ApplicationStatus } from './types';

export type StatusFilter = 'all' | ApplicationStatus;

const CHIPS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'healthy', label: 'Healthy' },
  { id: 'warning', label: 'Warning' },
  { id: 'critical', label: 'Critical' },
  { id: 'unknown', label: 'Unknown' },
];

export function ApplicationFilters({
  query,
  onQuery,
  status,
  onStatus,
}: {
  query: string;
  onQuery: (v: string) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search applications…"
          aria-label="Search applications"
          data-testid="applications-search"
          className="w-full rounded-lg border border-line-strong bg-elevated py-2 pl-9 pr-3 text-[13px] text-ink outline-none focus:border-accent"
        />
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg bg-hovered p-0.5" role="tablist" aria-label="Filter by status">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={status === c.id}
            onClick={() => onStatus(c.id)}
            data-testid={`applications-filter-${c.id}`}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
              status === c.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
