'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Hash, MessageCircleQuestion, MessageSquarePlus, Sparkles, Users } from 'lucide-react';
import type { AskAnswerDto, AskSourceDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { Dialog } from './dialog';
import { Avatar } from './avatar';
import { keys, useExperts, type Container } from '@/hooks/queries';

/** "Ask Backstages" — a lightweight RAG assistant over the team's decisions and
 *  the channels you can see. Opened via the command palette (bs:ask event). */
export function AskDialog({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string;
  onNavigate: (c: Container, messageId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<AskAnswerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const experts = useExperts(workspaceId, asked, !!answer);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('bs:ask', onOpen);
    return () => window.removeEventListener('bs:ask', onOpen);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuestion('');
    setAsked('');
    setAnswer(null);
    setError(null);
  };

  const ask = async () => {
    if (question.trim().length < 3 || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const q = question.trim();
      setAsked(q);
      const res = await api<AskAnswerDto>('POST', `/workspaces/${workspaceId}/ask`, { question: q });
      setAnswer(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const messageExpert = async (userId: string) => {
    const dm = await api<{ id: string }>('POST', `/workspaces/${workspaceId}/conversations`, {
      memberIds: [userId],
    });
    await qc.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
    onNavigate({ kind: 'conversation', id: dm.id });
    close();
  };

  const openSource = (s: AskSourceDto) => {
    if (s.kind === 'message' && s.channelId) {
      onNavigate({ kind: 'channel', id: s.channelId }, s.ref);
      close();
    }
  };

  if (!open) return null;

  return (
    <Dialog title="Ask Backstages" onClose={close} wide>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line-strong bg-elevated px-3 py-2 focus-within:border-accent">
        <MessageCircleQuestion size={16} className="shrink-0 text-accent" />
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ask()}
          placeholder="Ask about decisions, discussions, who owns what…"
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          data-testid="ask-input"
        />
        <button
          onClick={() => void ask()}
          disabled={loading || question.trim().length < 3}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {!answer && !loading && !error && (
        <p className="flex items-center gap-1.5 px-1 text-[12px] text-ink-3">
          <Sparkles size={13} className="text-accent" /> Answers are grounded in your team&apos;s recorded decisions and the channels you belong to.
        </p>
      )}
      {error && <p className="px-1 text-[13px] text-red-500">{error}</p>}

      {answer && (
        <div className="space-y-3">
          <div className="whitespace-pre-wrap rounded-lg bg-elevated p-3 text-[13px] leading-relaxed text-ink">{answer.answer}</div>
          {answer.sources.length > 0 && (
            <div>
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Sources</div>
              <ul className="space-y-1">
                {answer.sources.map((s, i) => (
                  <li key={i}>
                    <button
                      onClick={() => openSource(s)}
                      disabled={s.kind !== 'message' || !s.channelId}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 enabled:hover:bg-hovered enabled:hover:text-ink disabled:cursor-default"
                    >
                      <span className="shrink-0 text-ink-3">{i + 1}.</span>
                      {s.kind === 'decision' ? <ClipboardCheck size={13} className="shrink-0 text-accent" /> : <Hash size={13} className="shrink-0 text-ink-3" />}
                      <span className="truncate">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(experts.data?.experts.length ?? 0) > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                <Users size={11} /> People who might know
              </div>
              <ul className="space-y-1">
                {experts.data!.experts.map((e) => (
                  <li key={e.userId} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hovered">
                    <Avatar user={{ id: e.userId, displayName: e.displayName, avatarUrl: e.avatarUrl }} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{e.displayName}</span>
                      <span className="block truncate text-[11px] text-ink-3">{e.reason}</span>
                    </span>
                    <button
                      onClick={() => void messageExpert(e.userId)}
                      className="shrink-0 rounded-md bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent opacity-0 hover:bg-accent/20 group-hover:opacity-100"
                    >
                      <MessageSquarePlus size={12} className="mr-1 inline" />
                      Ask
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
