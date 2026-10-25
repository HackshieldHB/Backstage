'use client';

import { useEffect } from 'react';
import { BrandMark } from '@/components/brand-mark';

/**
 * The "stage" pieces shared by the landing page and the sign-in / sign-up
 * panel: the spotlight rig, the twinkling stars and the glowing brand mark.
 * Styles live under "LANDING" in globals.css; they expect a `.stage` ancestor.
 */

/** After this long without pointer input the spotlight drifts on its own. */
const IDLE_MS = 2500;

/** Fixed (not random) so server and client render the same dust. */
const DUST = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 37.7 + 11) % 100,
  top: (i * 61.3 + 13) % 100,
  size: 1 + (i % 3),
  duration: 7 + (i % 5) * 2,
  delay: -((i * 0.7) % 9),
}));

/** A four-point sparkle, drawn in a 24×24 box. */
const SPARKLE =
  'M12 0C12.7 7.3 16.7 11.3 24 12C16.7 12.7 12.7 16.7 12 24C11.3 16.7 7.3 12.7 0 12C7.3 11.3 11.3 7.3 12 0Z';

/** Twinkles arched over the logo; x/y are % of the box above the mark. */
const STARS: {
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  tint?: 'accent' | 'warm';
}[] = [
  { x: 50, y: 6, size: 25, duration: 2.6, delay: 0 },
  { x: 30, y: 22, size: 15, duration: 3.1, delay: 0.7, tint: 'accent' },
  { x: 70, y: 18, size: 18, duration: 2.8, delay: 1.3 },
  { x: 14, y: 52, size: 13, duration: 3.4, delay: 0.4, tint: 'warm' },
  { x: 86, y: 46, size: 14, duration: 3, delay: 1.9, tint: 'accent' },
  { x: 40, y: 0, size: 10, duration: 2.4, delay: 1.1 },
  { x: 62, y: 38, size: 10, duration: 3.6, delay: 2.2, tint: 'warm' },
  { x: 22, y: 8, size: 8, duration: 2.9, delay: 1.6 },
  { x: 80, y: 4, size: 11, duration: 3.3, delay: 0.2 },
  { x: 4, y: 82, size: 8, duration: 2.7, delay: 2.5 },
  { x: 96, y: 78, size: 10, duration: 3.2, delay: 0.9 },
];

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Spotlight: ease toward the pointer (or an idle drift around `anchorY`, a
 * fraction of the height) and publish the position as CSS variables on the
 * element, so moving the light never re-renders React.
 */
export function useSpotlight(ref: React.RefObject<HTMLElement>, anchorY = 0.42) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduced = prefersReducedMotion();
    let w = root.clientWidth;
    let h = root.clientHeight;
    let x = w / 2;
    let y = h * anchorY;
    let tx = x;
    let ty = y;
    let lastInput = -Infinity;
    let frame = 0;

    const paint = () => {
      const dx = x - w / 2;
      const dy = y + 60;
      root.style.setProperty('--sx', `${x}px`);
      root.style.setProperty('--sy', `${y}px`);
      root.style.setProperty('--beam-angle', `${(-Math.atan2(dx, dy) * 180) / Math.PI}deg`);
      root.style.setProperty('--beam-length', `${Math.hypot(dx, dy) + 140}px`);
    };

    const tick = (t: number) => {
      if (t - lastInput > IDLE_MS) {
        tx = w / 2 + Math.sin(t / 2600) * w * 0.16;
        ty = h * anchorY + Math.cos(t / 3400) * h * 0.07;
      }
      x += (tx - x) * 0.07;
      y += (ty - y) * 0.07;
      paint();
      frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      tx = e.clientX - rect.left;
      ty = e.clientY - rect.top;
      lastInput = performance.now();
    };
    const onResize = () => {
      w = root.clientWidth;
      h = root.clientHeight;
      if (reduced) {
        x = w / 2;
        y = h * anchorY;
        paint();
      }
    };

    paint();
    window.addEventListener('resize', onResize);
    if (!reduced) {
      root.addEventListener('pointermove', onMove);
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      root.removeEventListener('pointermove', onMove);
    };
  }, [ref, anchorY]);
}

/** Light rig: the beam from the rafters, its pool on stage, dust caught in it. */
export function StageLights() {
  return (
    <>
      <div aria-hidden className="stage-beam" data-anim />
      <div aria-hidden className="stage-pool" data-anim />
      <div aria-hidden className="stage-dust" data-anim>
        {DUST.map((d, i) => (
          <span
            key={i}
            style={{
              left: `${d.left}%`,
              top: `${d.top}%`,
              width: d.size,
              height: d.size,
              animationDuration: `${d.duration}s`,
              animationDelay: `${d.delay}s`,
            }}
          />
        ))}
      </div>
    </>
  );
}

/** The floating, haloed brand mark with stars twinkling over it. */
export function StageMark({ size = 88 }: { size?: number }) {
  return (
    <div className="stage-mark" data-anim>
      <div aria-hidden className="stage-stars" data-anim>
        {STARS.map((s, i) => (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className={s.tint ? `stage-star stage-star-${s.tint}` : 'stage-star'}
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
            }}
          >
            <path d={SPARKLE} />
          </svg>
        ))}
      </div>
      <div className="stage-mark-float">
        <BrandMark size={size} className="!rounded-[26%]" />
        <span aria-hidden className="stage-mark-sheen" />
      </div>
    </div>
  );
}
