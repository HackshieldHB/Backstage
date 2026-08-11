'use client';

import {
  cloneElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'bottom' | 'left' | 'right';

const GAP = 8; // distance between trigger and tooltip
const SHOW_DELAY = 350; // ms — matches the native title() feel, minus the sluggishness

interface Coords {
  top: number;
  left: number;
  side: Side;
}

/**
 * Lightweight, themed tooltip that replaces raw `title=""` attributes.
 *
 * Renders into a body portal with fixed positioning so it is never clipped by
 * the sidebar's `overflow` container, flips to the opposite side when it would
 * overflow the viewport, and appears on hover *and* keyboard focus. The child
 * must be a single element that forwards a ref and mouse/focus handlers (any
 * DOM element or a component that spreads `...props`).
 */
export function Tooltip({
  label,
  side = 'top',
  children,
}: {
  label: ReactNode;
  side?: Side;
  children: ReactElement;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Flip to the opposite edge if the preferred side would clip.
    let resolved = side;
    if (side === 'top' && r.top < 44) resolved = 'bottom';
    else if (side === 'bottom' && vh - r.bottom < 44) resolved = 'top';
    else if (side === 'left' && r.left < 120) resolved = 'right';
    else if (side === 'right' && vw - r.right < 120) resolved = 'left';

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pos: Record<Side, Coords> = {
      top: { top: r.top - GAP, left: cx, side: 'top' },
      bottom: { top: r.bottom + GAP, left: cx, side: 'bottom' },
      left: { top: cy, left: r.left - GAP, side: 'left' },
      right: { top: cy, left: r.right + GAP, side: 'right' },
    };
    setCoords(pos[resolved]);
  }, [side]);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(place, SHOW_DELAY);
  }, [place]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCoords(null);
  }, []);

  // Keep position correct if the tooltip is open while the layout shifts.
  useLayoutEffect(() => {
    if (!coords) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [coords, place]);

  const child = children as ReactElement<{
    ref?: React.Ref<HTMLElement>;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    'aria-describedby'?: string;
  }>;

  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const r = (child as unknown as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof r === 'function') r(node);
      else if (r && typeof r === 'object') (r as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      child.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      child.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      child.props.onFocus?.(e);
      place();
    },
    onBlur: (e: React.FocusEvent) => {
      child.props.onBlur?.(e);
      hide();
    },
    'aria-describedby': coords ? id : undefined,
  });

  const transform: Record<Side, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  return (
    <>
      {trigger}
      {coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ top: coords.top, left: coords.left, transform: transform[coords.side] }}
            className="pointer-events-none fixed z-[100] max-w-xs animate-fade-in rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium leading-tight text-white shadow-lg dark:bg-gray-700"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
