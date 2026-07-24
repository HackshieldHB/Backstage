'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { FileText, Hash, Lock, MessageSquare, Search } from 'lucide-react';
import { fileUrl } from '@/lib/api';
import { useSearch, type Container } from '@/hooks/queries';
import { Avatar } from './avatar';
import { MessageBody } from './message-body';

const TABS = ['messages', 'files', 'channels', 'people'] as const;
type Tab = (typeof TABS)[number];

export function SearchDialog({
  workspaceId,
  onClose,
  onJump,
}: {
  workspaceId: string;
  onClose: () => void;
  onJump: (c: Container, messageId?: string) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tab, setTab] = useState<Tab>('messages');
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useSearch(workspaceId, debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const counts: Record<Tab, number> = {
    messages: results.data?.messages.length ?? 0,
    files: results.data?.files.length ?? 0,
    channels: results.data?.channels.length ?? 0,
    people: results.data?.people.length ?? 0,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl animate-fade-in rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <Search size={16} className="text-gray-500 dark:text-gray-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search — try: report from:alice in:general before:2026-07-01 has:file"
            className="flex-1 bg-transparent text-sm outline-none"
            data-testid="search-input"
          />
          <kbd className="text-[10px] text-gray-500 dark:text-gray-400">Esc</kbd>
        </div>

        <div className="flex border-b border-gray-100 px-2 dark:border-gray-800">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-3 py-2 text-[13px] font-medium capitalize',
                tab === t ? 'border-b-2 border-accent text-accent' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200',
              )}
              data-testid={`search-tab-${t}`}
            >
              {t} {debounced && counts[t] > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">({counts[t]})</span>}
            </button>
          ))}
        </div>

        <div className="thin-scrollbar max-h-[50vh] overflow-y-auto p-2" data-testid="search-results">
          {!debounced && (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">
              Search across messages, files, channels and people. Modifiers:{' '}
              <code className="text-xs">from:</code> <code className="text-xs">in:</code>{' '}
              <code className="text-xs">before:</code> <code className="text-xs">after:</code>{' '}
              <code className="text-xs">has:link</code> <code className="text-xs">has:file</code>
            </p>
          )}

          {debounced && tab === 'messages' &&
            (results.data?.messages ?? []).map((m) => (
              <button
                key={m.id}
                onClick={() =>
                  onJump(
                    m.channelId
                      ? { kind: 'channel', id: m.channelId }
                      : { kind: 'conversation', id: m.conversationId! },
                    m.id,
                  )
                }
                className="mb-1 block w-full rounded-lg p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                data-testid="search-result-message"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                  <Avatar user={m.user} size="xs" />
                  <strong>{m.user?.displayName}</strong>
                  <span>{format(new Date(m.createdAt), 'MMM d, yyyy HH:mm')}</span>
                </div>
                <MessageBody contentJson={m.contentJson} contentText={m.contentText} />
              </button>
            ))}

          {debounced && tab === 'files' &&
            (results.data?.files ?? []).map((f) => (
              <a
                key={f.id}
                href={`${fileUrl(f.url)}&download=1`}
                className="mb-1 flex items-center gap-3 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <FileText size={20} className="text-accent" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{f.filename}</span>
                  <span className="block text-xs text-gray-500">
                    {f.uploader?.displayName} · {format(new Date(f.createdAt), 'MMM d, yyyy')}
                  </span>
                </span>
              </a>
            ))}

          {debounced && tab === 'channels' &&
            (results.data?.channels ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => onJump({ kind: 'channel', id: c.id })}
                className="mb-1 flex w-full items-center gap-2 rounded-lg p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {c.isPrivate ? <Lock size={14} /> : <Hash size={14} />}
                <span className="text-sm font-medium">{c.name}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {c.memberCount} members {c.topic ? `· ${c.topic}` : ''}
                </span>
              </button>
            ))}

          {debounced && tab === 'people' &&
            (results.data?.people ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  // Open (or create) a DM with this person — handled in the app shell.
                  window.dispatchEvent(new CustomEvent('bs:open-dm', { detail: p.id }));
                  onClose();
                }}
                className="mb-1 flex w-full items-center gap-2 rounded-lg p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                data-testid="search-result-person"
              >
                <Avatar user={p} size="sm" />
                <span className="text-sm font-medium">{p.displayName}</span>
                <span className="truncate text-xs text-gray-500 dark:text-gray-400">{p.email}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
                  <MessageSquare size={13} /> Message
                </span>
              </button>
            ))}

          {debounced && results.isSuccess && counts[tab] === 0 && (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No {tab} match “{debounced}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}
