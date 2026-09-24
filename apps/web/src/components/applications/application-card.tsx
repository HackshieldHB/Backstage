'use client';

import { ExternalLink } from 'lucide-react';
import type { Application } from './types';
import { ApplicationLogo } from './application-logo';
import { relativeTime, StatusPill } from './primitives';

/**
 * Entry-point card. The whole card previews the application (Path A — Explore);
 * the explicit "Open ↗" link goes straight to the real app (Path B — Work),
 * bypassing the preview. Two separate, keyboard-focusable controls.
 */
export function ApplicationCard({ app, onView }: { app: Application; onView: () => void }) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-pop focus-within:shadow-pop">
      {/* Click-anywhere-to-preview target (keyboard accessible). */}
      <button
        onClick={onView}
        aria-label={`Preview ${app.name}`}
        data-testid={`app-card-${app.id}`}
        className="absolute inset-0 z-0 rounded-2xl outline-none ring-accent focus-visible:ring-2"
      />

      <div className="pointer-events-none relative z-10 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <ApplicationLogo appId={app.id} size="md" />
          <StatusPill status={app.status} reason={app.statusReason} compact />
        </div>

        <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-ink">{app.name}</h3>
        <p className="text-[12px] text-ink-3">{app.tagline}</p>

        <div className="my-3 border-t border-line" />

        <div className="grid grid-cols-3 gap-2">
          {app.metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-ink">{m.value}</div>
              <div className="truncate text-[11px] text-ink-3">{m.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-ink-3">Updated {relativeTime(app.lastChecked)}</span>
          <div className="pointer-events-auto flex items-center gap-1.5">
            <span className="rounded-lg px-2 py-1 text-[12px] font-medium text-accent">View</span>
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="relative z-20 inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-hovered"
              data-testid={`app-open-${app.id}`}
            >
              Open <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ApplicationCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 animate-pulse rounded-xl bg-hovered" />
        <div className="h-4 w-20 animate-pulse rounded-full bg-hovered" />
      </div>
      <div className="mt-3 h-4 w-24 animate-pulse rounded bg-hovered" />
      <div className="mt-1.5 h-3 w-32 animate-pulse rounded bg-hovered" />
      <div className="my-3 border-t border-line" />
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-4 w-10 animate-pulse rounded bg-hovered" />
            <div className="mt-1 h-3 w-12 animate-pulse rounded bg-hovered" />
          </div>
        ))}
      </div>
      <div className="mt-3 h-3 w-28 animate-pulse rounded bg-hovered" />
    </div>
  );
}
