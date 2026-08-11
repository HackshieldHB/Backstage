'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';

/** Renders transient toasts bottom-right. Mounted once in the app shell. */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          data-testid="toast"
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white p-3 shadow-lg animate-fade-in dark:border-gray-700 dark:bg-gray-800"
        >
          <span className="mt-0.5 shrink-0">
            {t.kind === 'success' ? (
              <CheckCircle2 size={16} className="text-green-500" />
            ) : t.kind === 'error' ? (
              <XCircle size={16} className="text-red-500" />
            ) : (
              <Info size={16} className="text-accent" />
            )}
          </span>
          <p className="flex-1 text-[13px] text-gray-700 dark:text-gray-200">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
