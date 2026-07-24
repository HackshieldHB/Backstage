'use client';

import { Dialog } from './dialog';
import { useCatchUp } from '@/hooks/queries';

/** "Catch me up": a digest of everything you missed, mentions first. */
export function CatchUpDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const cu = useCatchUp(workspaceId, true);

  return (
    <Dialog title="Catch me up" onClose={onClose}>
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
