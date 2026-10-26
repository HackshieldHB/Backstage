'use client';

import { ExternalLink, Plug } from 'lucide-react';
import type { Application } from './types';
import { ApplicationLogo } from './application-logo';
import { relativeTime, StatusPill } from './primitives';

/**
 * Entry-point card. Connected: live headline numbers, click to preview, "Open ↗"
 * goes straight to the real app. Not connected: no numbers at all — just what
 * it is and how to connect it.
 */
export function ApplicationCard({
  app,
  isAdmin,
  onView,
  onConnect,
}: {
  app: Application;
  isAdmin: boolean;
  onView: () => void;
  onConnect: () => void;
}) {
  if (!app.connected) {
    return (
      <div
        className="flex flex-col rounded-2xl border border-dashed border-line-strong bg-surface/60 p-4"
        data-testid={`app-card-${app.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <ApplicationLogo appId={app.id} size="md" />
          <span className="rounded-full bg-hovered px-2 py-0.5 text-[11px] font-medium text-ink-3">Not connected</span>
        </div>
        <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-ink">{app.name}</h3>
        <p className="text-[12.5px] text-ink-3">{app.description}</p>
        <div className="mt-auto pt-4">
          {isAdmin ? (
            <button
              onClick={onConnect}
              className="btn-primary w-full py-2 text-[13px]"
              data-testid={`app-connect-${app.id}`}
            >
              <Plug size={14} /> Connect {app.name}
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">Ask a workspace admin to connect it.</p>
          )}
        </div>
      </div>
    );
  }

  const unreachable = app.metrics.length === 0;
  return (
    <div className="group relative flex flex-col rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-pop focus-within:shadow-pop">
      {/* Click-anywhere-to-preview target (keyboard accessible). */}
      <button
        onClick={onView}
        aria-label={`Preview ${app.name}`}
        data-testid={`app-card-${app.id}`}
        className="absolute inset-0 z-0 rounded-2xl outline-none ring-accent focus-visible:ring-2"
      />

      <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <ApplicationLogo appId={app.id} size="md" />
          <StatusPill status={app.status} reason={app.statusReason} compact />
        </div>

        <h3 className="mt-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          {app.name}
          <span
            className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400"
            title="Read from your connected account"
          >
            Live
          </span>
        </h3>
        <p className="text-[12px] text-ink-3">{app.description}</p>

        <div className="my-3 border-t border-line" />

        {unreachable ? (
          <p className="text-[12.5px] text-amber-600 dark:text-amber-400">{app.statusReason}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {app.metrics.map((m) => (
              <div key={m.label} className="min-w-0">
                <div
                  className={`truncate text-[15px] font-semibold ${
                    m.tone === 'critical'
                      ? 'text-red-600 dark:text-red-400'
                      : m.tone === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-ink'
                  }`}
                >
                  {m.value}
                </div>
                <div className="truncate text-[11px] text-ink-3">{m.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="text-[11px] text-ink-3">
            {app.lastChecked ? `Updated ${relativeTime(app.lastChecked)}` : 'Not reachable right now'}
          </span>
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
