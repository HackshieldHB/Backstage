'use client';

import type { ReactNode } from 'react';
import { Boxes, CheckCircle2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { Application } from './types';
import { relativeTime } from './primitives';

function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone,
  small,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-elevated ${tone ?? 'text-ink-3'}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
        <div className={`${small ? 'text-[14px]' : 'text-[20px]'} font-semibold leading-tight ${tone ?? 'text-ink'}`}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}

export function ApplicationSummary({ apps }: { apps: Application[] }) {
  const total = apps.length;
  const healthy = apps.filter((a) => a.status === 'healthy').length;
  const attention = apps.filter((a) => a.status === 'warning' || a.status === 'critical').length;
  const latest = apps.reduce((max, a) => Math.max(max, new Date(a.lastChecked).getTime()), 0);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SummaryTile icon={<Boxes size={17} />} label="Applications" value={total} sub="Connected" />
      <SummaryTile
        icon={<CheckCircle2 size={17} />}
        label="Operational"
        value={healthy}
        sub="Healthy"
        tone="text-emerald-600 dark:text-emerald-400"
      />
      <SummaryTile
        icon={<TriangleAlert size={17} />}
        label="Attention"
        value={attention}
        sub="Requires review"
        tone={attention ? 'text-amber-600 dark:text-amber-400' : undefined}
      />
      <SummaryTile
        icon={<RefreshCw size={17} />}
        label="Last sync"
        value={latest ? relativeTime(new Date(latest).toISOString()) : '—'}
        small
      />
    </div>
  );
}
