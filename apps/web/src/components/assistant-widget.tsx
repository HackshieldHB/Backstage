'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  ArrowUp,
  CheckSquare,
  ClipboardCheck,
  Globe,
  Hash,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AskAnswerDto, AskSourceDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useAiStatus, useExperts, type Container } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Avatar } from './avatar';

type Turn = {
  role: 'user' | 'assistant';
  content: string;
  sources?: AskSourceDto[];
  /** An assistant turn that failed: shown with a retry, never sent back to the model. */
  error?: boolean;
};

const MAX_SENT = 20;
const MAX_CHARS = 4000;

/** The floating assistant's mascot: a little stagehand with a spotlight on its head. */
function Stagehand({ size = 52, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      className={clsx('stagehand', thinking && 'is-thinking')}
    >
      <defs>
        <linearGradient id="sh-body" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="rgb(var(--brand-from))" />
          <stop offset="1" stopColor="rgb(var(--brand-to))" />
        </linearGradient>
        <radialGradient id="sh-lip" cx="0.3" cy="0.15" r="0.7">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* spotlight antenna */}
      <path d="M32 13 V7" stroke="rgb(var(--brand-to))" strokeWidth="3" strokeLinecap="round" />
      <circle className="stagehand-bulb" cx="32" cy="6" r="4" fill="#fde68a" />
      {/* body */}
      <rect x="8" y="12" width="48" height="44" rx="20" fill="url(#sh-body)" />
      <rect x="8" y="12" width="48" height="44" rx="20" fill="url(#sh-lip)" />
      <rect
        x="8.75"
        y="12.75"
        width="46.5"
        height="42.5"
        rx="19.25"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      {/* eyes */}
      <g className="stagehand-eyes">
        <ellipse cx="24" cy="32" rx="5.5" ry="7" fill="#fff" />
        <ellipse cx="40" cy="32" rx="5.5" ry="7" fill="#fff" />
        <circle className="stagehand-pupil" cx="25" cy="33" r="3" fill="#0f172a" />
        <circle className="stagehand-pupil" cx="41" cy="33" r="3" fill="#0f172a" />
        <circle cx="26.2" cy="31.6" r="1" fill="#fff" />
        <circle cx="42.2" cy="31.6" r="1" fill="#fff" />
      </g>
      {/* cheeks + smile */}
      <ellipse cx="17" cy="43" rx="3.5" ry="2" fill="#fda4af" opacity="0.7" />
      <ellipse cx="47" cy="43" rx="3.5" ry="2" fill="#fda4af" opacity="0.7" />
      <path
        d="M27 45 Q32 49 37 45"
        stroke="#0f172a"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * "Ask Backstages": a friendly assistant that floats in the bottom-right
 * corner. Click the stagehand to chat — it answers from your workspace
 * (decisions, your channels and DMs, your tasks) with numbered sources, and
 * helps with general questions too. Also opened from the command palette.
 */
export function AssistantWidget({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate: (c: Container, messageId?: string) => void;
}) {
  const ai = useAiStatus();
  const mainView = useUiStore((s) => s.mainView);
  const lang = useUiStore((s) => s.lang);
  const id = lang === 'id';
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `bs.assistant.${workspaceId}`;

  // The conversation survives navigation and reloads within this tab.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      setTurns(saved ? (JSON.parse(saved) as Turn[]) : []);
    } catch {
      setTurns([]);
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(turns.slice(-40)));
    } catch {
      /* storage unavailable: the chat just won't persist */
    }
  }, [turns, storageKey]);

  // Command palette: "Ask Backstages…".
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('bs:ask', onOpen);
    return () => window.removeEventListener('bs:ask', onOpen);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, loading, open]);

  const send = useCallback(
    async (text: string, history: Turn[]) => {
      const question = text.trim();
      if (!question || loading) return;
      const next: Turn[] = [...history, { role: 'user', content: question.slice(0, MAX_CHARS) }];
      setTurns(next);
      setDraft('');
      setLoading(true);
      try {
        const messages = next
          .filter((t) => !t.error)
          .slice(-MAX_SENT)
          .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CHARS) }));
        // The API wants the conversation to start from a user turn's perspective; a
        // leading assistant turn is harmless, but trim it if the window cut mid-pair.
        while (messages.length > 1 && messages[0].role === 'assistant') messages.shift();
        const res = await api<AskAnswerDto>('POST', `/ai/workspaces/${workspaceId}/chat`, {
          messages,
        });
        setTurns((t) => [...t, { role: 'assistant', content: res.answer, sources: res.sources }]);
      } catch (err) {
        setTurns((t) => [
          ...t,
          {
            role: 'assistant',
            error: true,
            content:
              err instanceof Error
                ? err.message
                : id
                  ? 'Ada yang salah. Coba lagi.'
                  : 'Something went wrong. Try again.',
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, workspaceId, id],
  );

  const retry = () => {
    // Drop the failed reply and resend the question before it.
    const lastUser = [...turns].reverse().findIndex((t) => t.role === 'user');
    if (lastUser < 0) return;
    const idx = turns.length - 1 - lastUser;
    void send(turns[idx].content, turns.slice(0, idx));
  };

  const enabled = ai.data?.enabled === true;
  const suggestions = id
    ? [
        'Apa keputusan terakhir tim kita?',
        'Tugas apa saja yang masih terbuka untukku?',
        'Berita teknologi terbaru hari ini?',
        'Bantu tulis pengumuman rilis singkat',
      ]
    : [
        'What did the team decide recently?',
        'What tasks do I still have open?',
        'What’s the latest tech news today?',
        'Help me write a short release announcement',
      ];

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Ask Backstages"
          className="assistant-panel fixed inset-x-2 bottom-2 top-14 z-[45] flex flex-col overflow-hidden rounded-2xl border border-line bg-overlay shadow-pop sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:h-[min(620px,calc(100vh-88px))] sm:w-[400px]"
          data-testid="assistant-panel"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Stagehand size={36} thinking={loading} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-bold leading-tight text-ink">
                Ask Backstages
              </p>
              <p className="truncate text-[11.5px] text-ink-3">Stagehand</p>
            </div>
            {turns.length > 0 && (
              <button
                onClick={() => setTurns([])}
                className="icon-btn"
                aria-label={id ? 'Percakapan baru' : 'New chat'}
                title={id ? 'Percakapan baru' : 'New chat'}
                data-testid="assistant-new-chat"
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="icon-btn"
              aria-label="Close"
              data-testid="assistant-close"
            >
              <X size={16} />
            </button>
          </header>

          <div
            ref={scrollRef}
            className="thin-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {!enabled && !ai.isLoading ? (
              <div className="rounded-xl border border-line bg-surface p-4 text-[13px] leading-relaxed text-ink-2">
                {id
                  ? 'AI belum diaktifkan untuk server ini. Admin bisa menyambungkan Claude, GPT, atau model gratis (Groq, Gemini, Ollama) lewat pengaturan server.'
                  : "AI isn't set up on this server yet. An admin can connect Claude, GPT, or a free model (Groq, Gemini, Ollama) in the server settings."}
              </div>
            ) : turns.length === 0 ? (
              <div className="pt-2 text-center">
                <div className="mx-auto mb-2 w-fit">
                  <Stagehand size={64} />
                </div>
                <p className="font-display text-[17px] font-bold text-ink">
                  {id ? 'Hai! Ada yang bisa kubantu?' : 'Hi! How can I help?'}
                </p>
                <p className="mx-auto mt-1 max-w-[280px] text-[12.5px] text-ink-3">
                  {id
                    ? 'Aku menjawab dari keputusan tim, channel & DM-mu, tugasmu, dan info terkini dari internet — lengkap dengan sumbernya.'
                    : 'I answer from your team’s decisions, your channels & DMs, your tasks, and live info from the web — with sources.'}
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s, turns)}
                      className="rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((t, i) =>
                t.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[13.5px] leading-relaxed text-white">
                      {t.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2" data-testid="assistant-reply">
                    <div className="mt-0.5 shrink-0">
                      <Stagehand size={26} />
                    </div>
                    <div className="min-w-0 max-w-[88%]">
                      <div
                        className={clsx(
                          'rounded-2xl rounded-tl-md px-3 py-2 text-[13.5px] leading-relaxed',
                          t.error
                            ? 'border border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                            : 'bg-surface text-ink',
                        )}
                      >
                        {t.error ? (
                          t.content
                        ) : (
                          <RichText
                            text={t.content}
                            sources={t.sources ?? []}
                            onSource={(s) => openSource(s)}
                          />
                        )}
                      </div>
                      {t.error && i === turns.length - 1 && (
                        <button
                          onClick={retry}
                          className="mt-1 text-[12px] font-medium text-accent hover:underline"
                        >
                          {id ? 'Coba lagi' : 'Try again'}
                        </button>
                      )}
                      {!t.error && (t.sources?.length ?? 0) > 0 && (
                        <Sources sources={t.sources!} onSource={(s) => openSource(s)} />
                      )}
                      {!t.error && i === turns.length - 1 && i > 0 && (
                        <Experts
                          workspaceId={workspaceId}
                          question={turns[i - 1].content}
                          onOpenDm={() => setOpen(false)}
                          onNavigate={onNavigate}
                        />
                      )}
                    </div>
                  </div>
                ),
              )
            )}
            {loading && (
              <div className="flex items-center gap-2" data-testid="assistant-thinking">
                <Stagehand size={26} thinking />
                <span className="auth-typing" aria-label={id ? 'Sedang berpikir' : 'Thinking'}>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            )}
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft, turns);
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(draft, turns);
                  }
                }}
                rows={1}
                maxLength={MAX_CHARS}
                disabled={!enabled}
                placeholder={id ? 'Tanya apa saja…' : 'Ask anything…'}
                className="max-h-32 min-h-[24px] flex-1 resize-none border-0 bg-transparent p-0 text-[13.5px] focus:ring-0 text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
                data-testid="ask-input"
              />
              <button
                type="submit"
                disabled={!enabled || loading || !draft.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-opacity disabled:opacity-40"
                aria-label={id ? 'Kirim' : 'Send'}
                data-testid="assistant-send"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
        </section>
      )}

      <button
        onClick={() => setOpen(true)}
        aria-label="Ask Backstages"
        aria-expanded={open}
        title="Ask Backstages"
        className={clsx(
          'stagehand-launcher fixed right-5 z-[45] rounded-full transition-[bottom,transform] duration-300 hover:scale-105 active:scale-95',
          // Above the message composer while a chat is open, so it never covers Send.
          mainView === 'chat' ? 'bottom-[196px]' : 'bottom-5',
          // The open panel has its own close button and sits where the launcher is.
          open && 'hidden',
        )}
        data-testid="assistant-launcher"
      >
        <Stagehand size={52} thinking={loading} />
      </button>
    </>
  );

  function openSource(s: AskSourceDto) {
    if (s.kind === 'message' && s.channelId)
      onNavigate({ kind: 'channel', id: s.channelId }, s.ref);
    else if (s.kind === 'message' && s.conversationId)
      onNavigate({ kind: 'conversation', id: s.conversationId }, s.ref);
    else if (s.kind === 'task') useUiStore.getState().setMainView('tasks');
    else if (s.kind === 'web' && s.url && /^https?:\/\//.test(s.url))
      window.open(s.url, '_blank', 'noopener,noreferrer');
  }
}

/** Minimal, safe formatting: paragraphs, "-"/"1." lists, **bold**, `code`, and [n] source chips. */
function RichText({
  text,
  sources,
  onSource,
}: {
  text: string;
  sources: AskSourceDto[];
  onSource: (s: AskSourceDto) => void;
}) {
  const blocks: Array<{ list: boolean; ordered: boolean; lines: string[] }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+/.test(line);
    const ordered = /^\s*\d+[.)]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (bullet || ordered) {
      const item = line.replace(/^\s*([-*•]|\d+[.)])\s+/, '');
      if (last?.list && last.ordered === ordered) last.lines.push(item);
      else blocks.push({ list: true, ordered, lines: [item] });
    } else if (!line.trim()) {
      blocks.push({ list: false, ordered: false, lines: [] });
    } else if (last && !last.list && last.lines.length > 0) {
      last.lines.push(line);
    } else {
      blocks.push({ list: false, ordered: false, lines: [line] });
    }
  }
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d{1,2}\])/g).map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (/^`[^`]+`$/.test(part))
        return (
          <code key={i} className="rounded bg-hovered px-1 font-mono text-[12px]">
            {part.slice(1, -1)}
          </code>
        );
      const cite = /^\[(\d{1,2})\]$/.exec(part);
      if (cite) {
        const s = sources[Number(cite[1]) - 1];
        if (!s) return <Fragment key={i}>{part}</Fragment>;
        return (
          <button
            key={i}
            onClick={() => onSource(s)}
            title={s.label}
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent/15 px-1 align-text-top text-[10px] font-bold text-accent hover:bg-accent/25"
          >
            {cite[1]}
          </button>
        );
      }
      return <Fragment key={i}>{part}</Fragment>;
    });
  return (
    <div className="space-y-2">
      {blocks
        .filter((b) => b.lines.length > 0)
        .map((b, i) =>
          b.list ? (
            b.ordered ? (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l)}</li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l)}</li>
                ))}
              </ul>
            )
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l)}
                </Fragment>
              ))}
            </p>
          ),
        )}
    </div>
  );
}

function Sources({
  sources,
  onSource,
}: {
  sources: AskSourceDto[];
  onSource: (s: AskSourceDto) => void;
}) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {sources.map((s, i) => {
        const clickable =
          s.kind === 'task' ||
          (s.kind === 'web' && !!s.url) ||
          (s.kind === 'message' && (!!s.channelId || !!s.conversationId));
        return (
          <li key={i}>
            <button
              onClick={() => onSource(s)}
              disabled={!clickable}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-ink-2 enabled:hover:bg-hovered enabled:hover:text-ink disabled:cursor-default"
            >
              <span className="shrink-0 text-ink-3">{i + 1}.</span>
              {s.kind === 'decision' ? (
                <ClipboardCheck size={12} className="shrink-0 text-accent" />
              ) : s.kind === 'task' ? (
                <CheckSquare size={12} className="shrink-0 text-accent" />
              ) : s.kind === 'web' ? (
                <Globe size={12} className="shrink-0 text-sky-500" />
              ) : s.channelId ? (
                <Hash size={12} className="shrink-0 text-ink-3" />
              ) : (
                <MessageSquare size={12} className="shrink-0 text-ink-3" />
              )}
              <span className="truncate">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "People who might know" for the latest question (from the recommendation engine). */
function Experts({
  workspaceId,
  question,
  onOpenDm,
  onNavigate,
}: {
  workspaceId: string;
  question: string;
  onOpenDm: () => void;
  onNavigate: (c: Container) => void;
}) {
  const experts = useExperts(workspaceId, question, true);
  const qc = useQueryClient();
  const list = experts.data?.experts ?? [];
  if (list.length === 0) return null;
  const messageExpert = async (userId: string) => {
    const dm = await api<{ id: string }>('POST', `/workspaces/${workspaceId}/conversations`, {
      memberIds: [userId],
    });
    await qc.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
    onNavigate({ kind: 'conversation', id: dm.id });
    onOpenDm();
  };
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        <Users size={11} /> People who might know
      </div>
      <ul className="space-y-0.5">
        {list.slice(0, 3).map((e) => (
          <li
            key={e.userId}
            className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hovered"
          >
            <Avatar
              user={{ id: e.userId, displayName: e.displayName, avatarUrl: e.avatarUrl }}
              size="xs"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink">
                {e.displayName}
              </span>
              <span className="block truncate text-[11px] text-ink-3">{e.reason}</span>
            </span>
            <button
              onClick={() => void messageExpert(e.userId)}
              className="shrink-0 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent/20"
            >
              <MessageSquarePlus size={11} className="mr-1 inline" />
              Ask
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
