'use client';

import { useEffect, useId, useRef } from 'react';
import { ExternalLink, Settings2, X } from 'lucide-react';
import type { Application } from './types';
import { ApplicationLogo } from './application-logo';
import { StatusPill } from './primitives';
import { useApplicationDetail } from './use-applications';
import { ApplicationDetailBody } from './application-detail-body';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Preview of a connected application: its live status, figures and lists, read
 * from the service through the workspace's connection.
 */
export function ApplicationPreviewModal({
  app,
  canManage,
  onClose,
  onManage,
}: {
  app: Application;
  canManage: boolean;
  onClose: () => void;
  onManage: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dataQ = useApplicationDetail(app);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !panel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-start sm:pt-[7vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="application-preview"
        className="flex max-h-[92vh] w-full animate-fade-in flex-col overflow-hidden border border-line bg-overlay text-ink shadow-pop outline-none max-sm:rounded-t-2xl sm:max-h-[86vh] sm:max-w-xl sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <ApplicationLogo appId={app.id} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16px] font-semibold tracking-tight text-ink">
              {app.name}
            </h2>
            <p className="truncate text-[12.5px] text-ink-3">{app.description}</p>
            <div className="mt-1.5">
              <StatusPill status={app.status} reason={app.statusReason} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${app.name}`}
              aria-label={`Open ${app.name} in a new tab`}
              className="rounded-lg p-1.5 text-ink-3 hover:bg-hovered hover:text-ink"
            >
              <ExternalLink size={17} />
            </a>
            <button onClick={onClose} aria-label="Close preview" className="rounded-lg p-1.5 text-ink-3 hover:bg-hovered hover:text-ink">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body — application-specific experience */}
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {dataQ.isLoading ? (
            <PreviewSkeleton />
          ) : dataQ.data ? (
            <ApplicationDetailBody detail={dataQ.data} />
          ) : (
            <div className="rounded-xl border border-dashed border-line py-10 text-center">
              <p className="text-[14px] font-semibold text-ink">Couldn’t read {app.name}</p>
              <p className="mt-1 text-[13px] text-ink-3">
                {dataQ.error instanceof Error ? dataQ.error.message : 'Try again in a moment.'}
              </p>
              <button
                onClick={() => void dataQ.refetch()}
                className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hovered"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          {canManage ? (
            <button
              onClick={onManage}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-2 hover:bg-hovered"
              data-testid="preview-manage"
            >
              <Settings2 size={14} /> Manage connection
            </button>
          ) : (
            <span />
          )}
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="preview-open-app"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover"
          >
            Open {app.name} <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-hovered" />
        ))}
      </div>
      <div className="h-3 w-24 animate-pulse rounded bg-hovered" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-hovered" />
        ))}
      </div>
    </div>
  );
}
