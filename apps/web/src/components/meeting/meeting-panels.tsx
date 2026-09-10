'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Hand,
  MicOff,
  MonitorUp,
  MoreVertical,
  Search,
  Send,
  ShieldCheck,
  UserMinus,
  Video,
} from 'lucide-react';
import type { HuddleParticipant, HuddleRole } from '@backstages/shared';
import type { HuddleController } from '@/hooks/use-huddle';
import { Avatar } from '../avatar';

const ago = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/** Right-side chat panel. Does not touch media — opening it never affects WebRTC. */
export function ChatPanel({ huddle, myId }: { huddle: HuddleController; myId: string }) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    huddle.markChatRead();
  }, [huddle.chat.length, huddle]);

  return (
    <div className="flex h-full flex-col">
      <div className="thin-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
        {huddle.chat.length === 0 && <p className="mt-6 text-center text-[13px] text-ink-3">No messages yet.</p>}
        {huddle.chat.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.userId === myId ? 'flex-row-reverse text-right' : ''}`}>
            <Avatar user={{ id: m.userId, displayName: m.displayName, avatarUrl: m.avatarUrl }} size="xs" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5 text-[11px] text-ink-3">
                <span className="font-semibold text-ink-2">{m.userId === myId ? 'You' : m.displayName}</span>
                <span>{ago(m.createdAt)}</span>
              </div>
              <div className="inline-block max-w-full break-words rounded-lg bg-hovered px-2.5 py-1.5 text-[13px] text-ink">
                {m.text}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-center gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            huddle.sendChat(text.trim());
            setText('');
          }
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the meeting…"
          aria-label="Meeting chat message"
          className="flex-1 rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send"
          className="rounded-lg bg-accent p-2 text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}

/** Participants list with per-participant host controls (all server-validated). */
export function ParticipantsPanel({ huddle, myId }: { huddle: HuddleController; myId: string }) {
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const isMod = huddle.myRole === 'host' || huddle.myRole === 'cohost';
  const rows = useMemo(() => {
    const sorted = [...huddle.participants].sort((a, b) => {
      // Raised hands first, then hosts, then name.
      if (!!a.handRaised !== !!b.handRaised) return a.handRaised ? -1 : 1;
      const rank = (r?: HuddleRole) => (r === 'host' ? 0 : r === 'cohost' ? 1 : 2);
      if (rank(a.role) !== rank(b.role)) return rank(a.role) - rank(b.role);
      return a.displayName.localeCompare(b.displayName);
    });
    return q ? sorted.filter((p) => p.displayName.toLowerCase().includes(q.toLowerCase())) : sorted;
  }, [huddle.participants, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5">
          <Search size={14} className="text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`${huddle.participants.length} in the meeting`}
            aria-label="Search participants"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
          />
        </div>
      </div>
      <div className="thin-scrollbar flex-1 overflow-y-auto p-1.5">
        {rows.map((p) => (
          <div key={p.userId} className="group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hovered">
            <Avatar user={{ id: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl }} size="sm" presence="ACTIVE" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-ink">
                  {p.displayName}
                  {p.userId === myId && ' (you)'}
                </span>
                {p.role === 'host' && <ShieldCheck size={12} className="text-amber-500" aria-label="Host" />}
                {p.role === 'cohost' && <ShieldCheck size={12} className="text-amber-400/70" aria-label="Co-host" />}
              </div>
            </div>
            <div className="flex items-center gap-1 text-ink-3">
              {p.handRaised && <Hand size={13} className="text-amber-500" aria-label="Hand raised" />}
              {p.screenSharing && <MonitorUp size={13} className="text-green-500" aria-label="Sharing" />}
              {p.videoEnabled && <Video size={13} aria-label="Camera on" />}
              {p.audioEnabled === false && <MicOff size={13} className="text-red-400" aria-label="Muted" />}
            </div>
            {isMod && p.userId !== myId && (
              <div className="relative">
                <button
                  onClick={() => setMenu(menu === p.userId ? null : p.userId)}
                  className="rounded p-1 text-ink-3 opacity-0 hover:bg-hovered group-hover:opacity-100"
                  aria-label={`Moderate ${p.displayName}`}
                >
                  <MoreVertical size={14} />
                </button>
                {menu === p.userId && (
                  <div className="absolute right-0 top-6 z-10 w-44 rounded-lg border border-line bg-overlay py-1 text-[13px] shadow-pop">
                    <MenuItem onClick={() => { huddle.moderate(p.userId, 'mute-request'); setMenu(null); }}>Ask to mute</MenuItem>
                    {p.handRaised && (
                      <MenuItem onClick={() => { huddle.moderate(p.userId, 'lower-hand'); setMenu(null); }}>Lower hand</MenuItem>
                    )}
                    {huddle.myRole === 'host' && p.role !== 'cohost' && (
                      <MenuItem onClick={() => { huddle.moderate(p.userId, 'set-role', 'cohost'); setMenu(null); }}>Make co-host</MenuItem>
                    )}
                    {huddle.myRole === 'host' && p.role === 'cohost' && (
                      <MenuItem onClick={() => { huddle.moderate(p.userId, 'set-role', 'participant'); setMenu(null); }}>Remove co-host</MenuItem>
                    )}
                    <MenuItem danger onClick={() => { huddle.moderate(p.userId, 'remove'); setMenu(null); }}>
                      <UserMinus size={13} className="mr-1.5 inline" />
                      Remove from meeting
                    </MenuItem>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {isMod && huddle.participants.some((p) => p.handRaised) && (
        <button
          onClick={() => huddle.participants.filter((p) => p.handRaised).forEach((p) => huddle.moderate(p.userId, 'lower-hand'))}
          className="m-2 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-hovered"
        >
          Lower all hands
        </button>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left hover:bg-hovered ${danger ? 'text-red-500' : 'text-ink'}`}
    >
      {children}
    </button>
  );
}

/** Collaborative notes — a shared textarea synced over the socket (ephemeral). */
export function NotesPanel({ huddle }: { huddle: HuddleController }) {
  const [local, setLocal] = useState(huddle.notes);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setLocal(huddle.notes);
  }, [huddle.notes]);
  return (
    <div className="flex h-full flex-col p-2">
      <textarea
        value={local}
        onChange={(e) => {
          typing.current = true;
          setLocal(e.target.value);
          huddle.updateNotes(e.target.value);
        }}
        onBlur={() => (typing.current = false)}
        placeholder={'Shared notes\n\nAgenda\n- \n\nDecisions\n- \n\nAction items\n- Owner — task'}
        aria-label="Collaborative meeting notes"
        className="thin-scrollbar h-full w-full resize-none rounded-lg border border-line bg-elevated p-3 text-[13px] leading-relaxed text-ink outline-none focus:border-accent"
      />
    </div>
  );
}

/** Live poll — moderators create/close; everyone votes; results update in real time. */
export function PollPanel({ huddle }: { huddle: HuddleController }) {
  const isMod = huddle.myRole === 'host' || huddle.myRole === 'cohost';
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const poll = huddle.poll;

  if (poll) {
    const total = Object.keys(poll.votes).length;
    return (
      <div className="flex h-full flex-col gap-3 p-3">
        <h3 className="text-[15px] font-semibold text-ink">{poll.question}</h3>
        <div className="space-y-2">
          {poll.options.map((opt, i) => {
            const count = Object.values(poll.votes).filter((v) => v === i).length;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <button
                key={i}
                disabled={poll.closed}
                onClick={() => huddle.votePoll(i)}
                className="relative w-full overflow-hidden rounded-lg border border-line px-3 py-2 text-left text-[13px] hover:border-accent disabled:cursor-default"
              >
                <span className="absolute inset-y-0 left-0 bg-accent/15" style={{ width: `${pct}%` }} />
                <span className="relative flex justify-between">
                  <span className="text-ink">{opt}</span>
                  <span className="text-ink-3">{pct}% · {count}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-ink-3">
          {total} vote{total === 1 ? '' : 's'}
          {poll.closed && ' · closed'}
        </p>
        {isMod && !poll.closed && (
          <button onClick={huddle.closePoll} className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-hovered">
            Close poll
          </button>
        )}
      </div>
    );
  }

  if (!isMod) return <p className="p-4 text-center text-[13px] text-ink-3">No active poll.</p>;

  return (
    <form
      className="flex h-full flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const opts = options.map((o) => o.trim()).filter(Boolean);
        if (question.trim() && opts.length >= 2) {
          huddle.createPoll(question.trim(), opts);
          setQuestion('');
          setOptions(['', '']);
        }
      }}
    >
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Poll question"
        className="rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
      />
      {options.map((o, i) => (
        <input
          key={i}
          value={o}
          onChange={(e) => setOptions((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
          placeholder={`Option ${i + 1}`}
          className="rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />
      ))}
      <button type="button" onClick={() => setOptions((s) => [...s, ''])} className="text-left text-[12px] text-accent">
        + Add option
      </button>
      <button type="submit" className="mt-auto rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover">
        Start poll
      </button>
    </form>
  );
}
