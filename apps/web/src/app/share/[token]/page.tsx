'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import type { MessageDto } from '@backstages/shared';
import { API_URL } from '@/lib/api';
import { Avatar } from '@/components/avatar';
import { MessageBody } from '@/components/message-body';

type SharedView =
  | { kind: 'channel'; workspaceName: string; title: string; messages: MessageDto[] }
  | { kind: 'thread'; workspaceName: string; title: string; parent: MessageDto; replies: MessageDto[] };

/** Public, read-only view of a shared channel or thread (no login required). */
export default function SharePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [view, setView] = useState<SharedView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/share/${token}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error?.message ?? 'This link is unavailable');
        setView(body.data as SharedView);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'This link is unavailable'));
  }, [token]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Link unavailable</h1>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
        </div>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="animate-pulse text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  const messages = view.kind === 'channel' ? view.messages : [view.parent, ...view.replies];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <header className="mb-6 border-b border-line pb-4 dark:border-line">
          <p className="text-xs font-medium uppercase tracking-wide text-accent">
            Shared from {view.workspaceName} · Backstages
          </p>
          <h1 className="mt-1 text-xl font-bold">{view.title}</h1>
          <p className="mt-1 text-xs text-gray-500">Read-only view · {messages.length} messages</p>
        </header>

        <div className="space-y-4">
          {messages.map((m) => (
            <div key={m.id} className="flex gap-2.5">
              <Avatar user={m.user} size="md" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-bold">
                    {m.kind === 'INTEGRATION' ? 'App' : (m.user?.displayName ?? 'Unknown')}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {format(new Date(m.createdAt), 'MMM d, HH:mm')}
                  </span>
                </div>
                {m.isDeleted ? (
                  <p className="text-[14px] italic text-gray-400">This message was deleted</p>
                ) : (
                  <MessageBody contentJson={m.contentJson} contentText={m.contentText} />
                )}
              </div>
            </div>
          ))}
        </div>

        <footer className="mt-10 border-t border-line pt-4 text-center text-xs text-gray-400 dark:border-line">
          Shared with a public link. Only the selected {view.kind} is visible.
        </footer>
      </div>
    </main>
  );
}
