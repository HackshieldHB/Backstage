'use client';

import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import type { ApplicationStatus } from './types';

// ----- time -----
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s} sec ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ----- status -----
type StatusMeta = {
  label: string;
  dot: string;
  text: string;
  pill: string;
  Icon: typeof CheckCircle2;
};
export const STATUS_META: Record<ApplicationStatus, StatusMeta> = {
  healthy: {
    label: 'Operational',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    pill: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  warning: {
    label: 'Attention required',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    pill: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    pill: 'bg-red-500/10 text-red-600 dark:text-red-400',
    Icon: AlertOctagon,
  },
  unknown: {
    label: 'Unknown',
    dot: 'bg-gray-400',
    text: 'text-gray-500 dark:text-gray-400',
    pill: 'bg-gray-400/10 text-gray-500 dark:text-gray-400',
    Icon: HelpCircle,
  },
};

/** A status pill that conveys state with an icon + label, never colour alone. */
export function StatusPill({
  status,
  reason,
  compact,
}: {
  status: ApplicationStatus;
  reason?: string;
  compact?: boolean;
}) {
  const s = STATUS_META[status];
  const Icon = s.Icon;
  return (
    <span
      title={reason}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ${s.pill}`}
      role="status"
    >
      <Icon size={compact ? 11 : 12} aria-hidden />
      {s.label}
    </span>
  );
}

export function StatusDot({ status, className = '' }: { status: ApplicationStatus; className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_META[status].dot} ${className}`} aria-hidden />;
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{children}</h3>
      {right}
    </div>
  );
}
