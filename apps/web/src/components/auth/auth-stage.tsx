'use client';

import { useEffect, useRef, useState } from 'react';
import { Headphones, MessageSquare, Mic, Rocket } from 'lucide-react';
import { StageLights, StageMark, useSpotlight } from '@/components/landing/stage-parts';

const SLIDES = [
  {
    key: 'chat',
    icon: MessageSquare,
    title: 'Chat that keeps up',
    body: 'Channels, threads and DMs that move as fast as your team does.',
  },
  {
    key: 'huddles',
    icon: Headphones,
    title: 'Huddle in one click',
    body: 'Hop on voice or video without leaving the conversation.',
  },
  {
    key: 'collab',
    icon: Rocket,
    title: 'Ship it together',
    body: 'Tasks, docs and Jira live right where your team talks.',
  },
] as const;

const ROTATE_MS = 4500;

/** The left half of the sign-in / sign-up pages: a slice of the landing stage. */
export function AuthStage() {
  const ref = useRef<HTMLElement>(null);
  useSpotlight(ref, 0.3);
  return (
    <aside ref={ref} className="stage is-live auth-stage" aria-label="About Backstages">
      <StageLights />
      <div className="auth-stage-inner">
        <div className="auth-stage-brand">
          <StageMark size={64} />
          <p className="auth-stage-wordmark">Backstages</p>
          <p className="auth-stage-tagline">Where your team works behind the scenes.</p>
        </div>
        <FeatureShowcase />
      </div>
      <p className="stage-credits auth-stage-credits">Chat · Huddles · Collaboration</p>
    </aside>
  );
}

function FeatureShowcase() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [index]);

  const slide = SLIDES[index];
  const Icon = slide.icon;
  return (
    <div className="auth-showcase">
      <div key={slide.key} className="auth-showcase-slide">
        <div className="flex items-center gap-3">
          <span className="auth-showcase-icon">
            <Icon size={18} aria-hidden />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-white">{slide.title}</p>
            <p className="text-[13px] leading-snug text-white/60">{slide.body}</p>
          </div>
        </div>
        <div className="auth-showcase-mock" aria-hidden>
          {slide.key === 'chat' && <ChatMock />}
          {slide.key === 'huddles' && <HuddleMock />}
          {slide.key === 'collab' && <TaskMock />}
        </div>
      </div>
      <div className="mt-4 flex justify-center gap-1.5">
        {SLIDES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            aria-label={s.title}
            aria-current={i === index}
            onClick={() => setIndex(i)}
            className={`auth-showcase-dot${i === index ? ' is-active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

function Avatar({ initials, hue }: { initials: string; hue: number }) {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: `hsl(${hue} 65% 52%)` }}
    >
      {initials}
    </span>
  );
}

function ChatMock() {
  return (
    <div className="space-y-2.5">
      <div className="auth-mock-row" style={{ animationDelay: '0.15s' }}>
        <Avatar initials="AR" hue={258} />
        <div>
          <p className="text-[11px] font-semibold text-white/80">Ari</p>
          <p className="auth-bubble">Release notes are up 🚀</p>
        </div>
      </div>
      <div className="auth-mock-row" style={{ animationDelay: '0.75s' }}>
        <Avatar initials="MK" hue={12} />
        <div>
          <p className="text-[11px] font-semibold text-white/80">Maya</p>
          <p className="auth-bubble">Looks great, shipping at 5 ✨</p>
        </div>
      </div>
      <div className="auth-mock-row" style={{ animationDelay: '1.35s' }}>
        <Avatar initials="JD" hue={160} />
        <span className="auth-typing">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}

function HuddleMock() {
  const people = [
    { initials: 'AR', hue: 258, speaking: true },
    { initials: 'MK', hue: 12 },
    { initials: 'JD', hue: 160 },
    { initials: 'SL', hue: 200 },
  ];
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-3">
        {people.map((p, i) => (
          <span
            key={p.initials}
            className={`auth-mock-row auth-huddle-person${p.speaking ? ' is-speaking' : ''}`}
            style={{ animationDelay: `${0.1 + i * 0.12}s` }}
          >
            <Avatar initials={p.initials} hue={p.hue} />
          </span>
        ))}
      </div>
      <span className="auth-mock-row auth-pill" style={{ animationDelay: '0.7s' }}>
        <span className="auth-live-dot" />
        Live huddle · 4 on stage
        <Mic size={12} aria-hidden />
      </span>
    </div>
  );
}

function TaskMock() {
  return (
    <div className="auth-mock-row auth-task" style={{ animationDelay: '0.15s' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-white/50">BS-142</span>
        <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
          In review
        </span>
      </div>
      <p className="mt-1.5 text-[13px] font-medium text-white/90">Polish the onboarding flow</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="auth-progress h-full rounded-full" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex -space-x-2">
          <Avatar initials="AR" hue={258} />
          <Avatar initials="MK" hue={12} />
        </div>
        <span className="text-[11px] text-white/50">3 of 4 subtasks</span>
      </div>
    </div>
  );
}
