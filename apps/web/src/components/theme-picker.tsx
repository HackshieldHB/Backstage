'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Check, Palette } from 'lucide-react';
import {
  ACCENTS,
  ACCENT_LABEL,
  ACCENT_SIDEBAR,
  ACCENT_SURFACE,
  ACCENT_SWATCH,
  THEME_MODE,
  useUiStore,
  type AccentId,
} from '@/stores/ui-store';

/** Appearance popover: pick a complete theme (each carries its own light/dark
 *  mode, full neutral palette, accent and sidebar), shown as live app previews. */
export function ThemePicker() {
  const { accent, setAccent } = useUiStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        aria-label="Appearance"
        onClick={() => setOpen((v) => !v)}
        className="rounded p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
        data-testid="theme-toggle"
      >
        <Palette size={15} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="animate-fade-in absolute bottom-full right-0 z-50 mb-2 w-72 rounded-xl border border-line bg-white p-3 text-gray-800 shadow-2xl dark:border-line dark:bg-gray-900 dark:text-gray-100">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Theme</span>
              <span className="text-[10px] text-gray-400">whole-app palette</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ACCENTS.map((a: AccentId) => (
                <button
                  key={a}
                  onClick={() => setAccent(a)}
                  className={clsx(
                    'group overflow-hidden rounded-lg border p-1 text-left transition-transform hover:-translate-y-0.5',
                    accent === a ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
                  )}
                  data-testid={`accent-${a}`}
                >
                  {/* Mini app preview: sidebar strip + surface + accent dot */}
                  <div className="flex h-11 overflow-hidden rounded-md" style={{ backgroundColor: ACCENT_SIDEBAR[a] }}>
                    <div
                      className="flex w-1/3 flex-col justify-center gap-1 px-1.5"
                      style={{
                        backgroundColor: ACCENT_SIDEBAR[a],
                        backgroundImage: `radial-gradient(140% 80% at 50% -30%, ${ACCENT_SWATCH[a]}44, transparent 70%)`,
                      }}
                    >
                      <span className="h-1 w-full rounded-full" style={{ backgroundColor: ACCENT_SWATCH[a] }} />
                      <span className="h-1 w-3/4 rounded-full bg-white/25" />
                      <span className="h-1 w-2/3 rounded-full bg-white/15" />
                    </div>
                    <div className="flex flex-1 items-center justify-center" style={{ backgroundColor: ACCENT_SURFACE[a] }}>
                      <span className="h-3.5 w-3.5 rounded-full ring-2 ring-black/5" style={{ backgroundColor: ACCENT_SWATCH[a] }} />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{ACCENT_LABEL[a]}</span>
                    {accent === a ? (
                      <Check size={12} className="text-accent" strokeWidth={3} />
                    ) : (
                      <span className="text-[9px] uppercase text-gray-400">{THEME_MODE[a]}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
