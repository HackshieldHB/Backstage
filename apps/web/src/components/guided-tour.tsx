'use client';

import {
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface TourStep {
  /** Element to spotlight. Omit for a centered, unanchored card (e.g. a welcome step). */
  anchorRef?: RefObject<HTMLElement | null>;
  title: string;
  body: ReactNode;
}

const CARD_WIDTH = 280;
const EST_CARD_HEIGHT = 210; // used only for viewport clamping

/**
 * A one-time, multi-step onboarding walkthrough. Spotlights a sequence of
 * anchored elements with Back / Next / Skip controls, dimming the rest of the
 * screen. Persists completion under `storageKey`, so it
 * runs exactly once per user (per browser). Anchors that are missing are
 * skipped gracefully, so conditionally-rendered menu items never break it.
 */
/**
 * The min viewport width (px) the tour needs. Below this the sidebar collapses
 * into an off-canvas drawer, so spotlighting its buttons would point at nothing.
 */
const DESKTOP_MIN_WIDTH = 768;

export function GuidedTour({
  storageKey,
  steps,
  labels,
  replayEvent,
  onFinish,
}: {
  storageKey: string;
  steps: TourStep[];
  /** UI strings — passed in so the tour stays i18n-agnostic. */
  labels: { skip: string; back: string; next: string; done: string };
  /** Optional window event name that re-opens the tour on demand (e.g. from a
   *  "Replay tour" button), bypassing the once-per-browser guard. */
  replayEvent?: string;
  onFinish?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Auto-run once per browser — but only on desktop, where the sidebar is
  // actually on screen to point at.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(storageKey) === '1') return;
    if (window.innerWidth < DESKTOP_MIN_WIDTH) return;
    // Give the sidebar a beat to mount/lay out before spotlighting.
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, [storageKey]);

  // Replay on demand (from anywhere) via a custom window event.
  useEffect(() => {
    if (!replayEvent || typeof window === 'undefined') return;
    const onReplay = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(replayEvent, onReplay);
    return () => window.removeEventListener(replayEvent, onReplay);
  }, [replayEvent]);

  const step = steps[index];
  const anchor = step?.anchorRef;

  // Measure the current anchor and keep it in sync with layout changes.
  useLayoutEffect(() => {
    if (!open) return;
    if (!anchor) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = anchor.current;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchor, index]);

  const finish = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, '1');
    setOpen(false);
    onFinish?.();
  };

  const next = () => {
    if (index >= steps.length - 1) finish();
    else setIndex((i) => i + 1);
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));

  if (!open || !step || typeof document === 'undefined') return null;

  const isLast = index === steps.length - 1;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;

  // Card placement: to the right of the anchor (sidebar sits on the left),
  // clamped into the viewport. Unanchored steps render centered.
  let cardStyle: React.CSSProperties;
  let arrowTop: number | null = null;
  if (rect) {
    const top = Math.min(Math.max(rect.top - 8, 12), vh - EST_CARD_HEIGHT - 12);
    let left = rect.right + 16;
    if (left + CARD_WIDTH > vw - 12) left = Math.max(12, rect.left - CARD_WIDTH - 16);
    cardStyle = { top, left, width: CARD_WIDTH };
    arrowTop = Math.min(Math.max(rect.top + rect.height / 2 - top - 6, 14), 170);
  } else {
    cardStyle = {
      top: '50%',
      left: '50%',
      width: CARD_WIDTH,
      transform: 'translate(-50%, -50%)',
    };
  }

  return createPortal(
    <>
      {/* Spotlight backdrop. Intentionally non-dismissing — use Skip/X. */}
      <div className="fixed inset-0 z-[90] bg-black/50 animate-fade-in" />
      {/* Highlight ring around the anchored element. */}
      {rect && (
        <div
          className="pointer-events-none fixed z-[91] rounded-md ring-2 ring-accent ring-offset-2 ring-offset-sidebar transition-all"
          style={{ top: rect.top - 2, left: rect.left - 2, width: rect.width + 4, height: rect.height + 4 }}
        />
      )}
      <div
        className="fixed z-[92] animate-fade-in rounded-xl border border-gray-200 bg-white p-3.5 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        data-testid="guided-tour"
      >
        {arrowTop != null && (
          <span
            className="absolute -left-1.5 h-3 w-3 rotate-45 border-b border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            style={{ top: arrowTop }}
          />
        )}
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-[14px] font-bold">{step.title}</h3>
          <button
            onClick={finish}
            className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={labels.skip}
          >
            <X size={14} />
          </button>
        </div>
        <div className="text-[13px] leading-snug text-gray-600 dark:text-gray-300">{step.body}</div>

        <div className="mt-3 flex items-center justify-between">
          {/* Step dots */}
          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={
                  i === index
                    ? 'h-1.5 w-4 rounded-full bg-accent transition-all'
                    : 'h-1.5 w-1.5 rounded-full bg-gray-300 transition-all dark:bg-gray-600'
                }
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {index === 0 ? (
              <button
                onClick={finish}
                className="rounded-md px-2.5 py-1 text-[13px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {labels.skip}
              </button>
            ) : (
              <button
                onClick={back}
                className="rounded-md px-2.5 py-1 text-[13px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {labels.back}
              </button>
            )}
            <button
              onClick={next}
              className="rounded-md bg-accent px-2.5 py-1 text-[13px] font-semibold text-white hover:bg-accent-hover"
              data-testid="guided-tour-next"
            >
              {isLast ? labels.done : labels.next}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
