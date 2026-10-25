'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { getAccessToken } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { StageLights, StageMark, prefersReducedMotion, useSpotlight } from './stage-parts';

const WORDMARK = 'Backstages';
/** How long the light spreads over the screen before we navigate away. */
const EXIT_MS = 1050;

/**
 * The logged-out landing page: the spotlight flickers on over a dark stage and
 * follows the pointer, and "Enter Backstage" floods the screen with light on
 * the way to sign-in. Signed-in people are sent straight to the app instead.
 */
export function SpotlightStage() {
  const router = useRouter();
  const { user, loading } = useAuthStore();
  const rootRef = useRef<HTMLElement>(null);
  /** The stage stays dark until we know this person isn't already signed in. */
  const [live, setLive] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // No stored session: nothing to wait for, bring the lights up right away.
    if (!getAccessToken()) {
      setLive(true);
      return;
    }
    if (loading) return;
    if (user) router.replace('/app');
    else setLive(true);
  }, [user, loading, router]);

  useEffect(() => {
    router.prefetch('/login');
    router.prefetch('/signup');
  }, [router]);

  useSpotlight(rootRef);

  const enter = useCallback(
    (href: string, e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      if (exiting) return;
      const root = rootRef.current;
      if (root) {
        const rect = root.getBoundingClientRect();
        root.style.setProperty('--ex', `${e.clientX ? e.clientX - rect.left : rect.width / 2}px`);
        root.style.setProperty('--ey', `${e.clientY ? e.clientY - rect.top : rect.height / 2}px`);
      }
      setExiting(true);
      window.setTimeout(() => router.push(href), prefersReducedMotion() ? 200 : EXIT_MS);
    },
    [exiting, router],
  );

  return (
    <main
      ref={rootRef}
      className={`stage${live ? ' is-live' : ''}${exiting ? ' is-exiting' : ''}`}
      aria-label="Welcome to Backstages"
    >
      <StageLights />
      <div aria-hidden className="stage-floor">
        <div className="stage-footlights">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} data-anim style={{ animationDelay: `${0.5 + i * 0.08}s` }} />
          ))}
        </div>
      </div>

      <div className="stage-content">
        <StageMark />
        <p className="stage-eyebrow" data-anim>
          Team chat for people who ship
        </p>
        <h1 className="stage-wordmark" aria-label={WORDMARK}>
          {WORDMARK.split('').map((ch, i) => (
            <span key={i} aria-hidden data-anim style={{ '--i': i } as React.CSSProperties}>
              {ch}
            </span>
          ))}
        </h1>
        <p className="stage-tagline" data-anim>
          Where your team works behind the scenes.
        </p>
        <div className="stage-cta-wrap" data-anim>
          <a href="/login" className="stage-cta" onClick={(e) => enter('/login', e)}>
            Enter Backstage
            <ArrowRight className="stage-cta-arrow" size={18} strokeWidth={2.25} />
          </a>
          <a href="/signup" className="stage-secondary" onClick={(e) => enter('/signup', e)}>
            New here? <span>Create an account</span>
          </a>
        </div>
      </div>

      <p className="stage-credits" data-anim>
        Chat · Huddles · Collaboration
      </p>

      <div aria-hidden className="stage-exit" />
    </main>
  );
}
