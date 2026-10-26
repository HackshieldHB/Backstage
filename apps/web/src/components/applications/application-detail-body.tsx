'use client';

import { ExternalLink } from 'lucide-react';
import type { ApplicationDetailDto, AppTone } from '@backstages/shared';
import { relativeTime, SectionLabel } from './primitives';

const TONE: Record<AppTone, string> = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** The live figures and lists for one connected application. */
export function ApplicationDetailBody({ detail }: { detail: ApplicationDetailDto }) {
  return (
    <div className="space-y-5" data-testid="application-detail">
      {detail.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {detail.stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <div
                className={`text-[18px] font-semibold leading-tight ${s.tone ? TONE[s.tone] : 'text-ink'}`}
              >
                {s.value}
              </div>
              <div className="mt-0.5 text-[11.5px] text-ink-3">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {detail.lists.map((list) => (
        <div key={list.title}>
          <SectionLabel>{list.title}</SectionLabel>
          {list.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-3">
              {list.empty}
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {list.items.map((item, i) => {
                const meta = item.meta && ISO.test(item.meta) ? relativeTime(item.meta) : item.meta;
                const body = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[13px] font-medium ${item.tone ? TONE[item.tone] : 'text-ink'}`}
                      >
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="block truncate text-[11.5px] text-ink-3">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {meta && (
                      <span className="shrink-0 text-right text-[11.5px] text-ink-3">{meta}</span>
                    )}
                    {item.url && (
                      <ExternalLink
                        size={12}
                        className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100"
                      />
                    )}
                  </>
                );
                return (
                  <li key={`${item.title}-${i}`}>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center gap-3 px-3 py-2.5 hover:bg-hovered"
                      >
                        {body}
                      </a>
                    ) : (
                      <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}

      <p className="text-[11.5px] text-ink-3">Read live {relativeTime(detail.fetchedAt)}.</p>
    </div>
  );
}
