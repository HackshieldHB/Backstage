'use client';

import { useState } from 'react';
import { AtSign, ChevronDown, Sparkles } from 'lucide-react';
import { Dialog } from './dialog';
import { useCatchUp } from '@/hooks/queries';

const HELP_DISMISS_KEY = 'bs.catchUp.helpCollapsed';

/** Collapsible "how it works" explainer shown at the top of the dialog. */
function HowItWorks() {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(HELP_DISMISS_KEY) === '1',
  );
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(HELP_DISMISS_KEY, next ? '1' : '0');
      }
      return next;
    });
  };

  return (
    <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 text-left text-[13px] font-semibold text-accent"
        data-testid="catch-up-help-toggle"
      >
        <Sparkles size={15} />
        How &ldquo;Catch me up&rdquo; works
        <ChevronDown
          size={15}
          className={`ml-auto transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      {!collapsed && (
        <div className="mt-2 space-y-1.5 text-[13px] text-gray-600 dark:text-gray-300">
          <p>
            This is a quick digest of everything you missed since you were last here — one card per
            channel or DM, so you can skim instead of scrolling.
          </p>
          <ul className="ml-1 space-y-1">
            <li className="flex gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-red-100 px-1 text-[11px] font-semibold text-red-600 dark:bg-red-900/40 dark:text-red-300">
                <AtSign size={11} className="inline" /> mentions
              </span>
              <span>Cards where someone @-mentioned you float to the top — read these first.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 shrink-0 font-medium">·</span>
              <span>Each card shows the unread count and the latest few messages as a preview.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 shrink-0 font-medium">·</span>
              <span>Open it any time from the sidebar, or after you&apos;ve been away for a while.</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Catch me up": a digest of everything you missed, mentions first. */
export function CatchUpDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const cu = useCatchUp(workspaceId, true);

  return (
    <Dialog title="Catch me up" onClose={onClose}>
      <HowItWorks />
      <div className="max-h-[60vh] space-y-2 overflow-y-auto p-1">
        {cu.isLoading && <p className="p-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
        {cu.data && cu.data.items.length === 0 && (
          <p className="p-3 text-sm text-gray-500 dark:text-gray-400">You&apos;re all caught up. 🎉</p>
        )}
        {cu.data?.items.map((item) => (
          <div
            key={(item.channelId ?? item.conversationId)!}
            className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{item.title}</span>
              <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                {item.unread} unread
                {item.mentions > 0 && (
                  <span className="ml-1 rounded bg-red-100 px-1 font-semibold text-red-600 dark:bg-red-900/40 dark:text-red-300">
                    {item.mentions} mention{item.mentions > 1 ? 's' : ''}
                  </span>
                )}
              </span>
            </div>
            <ul className="space-y-0.5">
              {item.previews.map((p, i) => (
                <li key={i} className="truncate text-[13px] text-gray-600 dark:text-gray-300">
                  <span className="font-medium text-gray-800 dark:text-gray-100">{p.author}</span>: {p.snippet}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
