'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Focus,
  Hand,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorX,
  MoreHorizontal,
  PhoneOff,
  Smile,
  SquareStack,
  StickyNote,
  Users,
  Video,
  VideoOff,
  Vote,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { HUDDLE_REACTIONS } from '@backstages/shared';
import type { HuddleController } from '@/hooks/use-huddle';
import { useAuthStore } from '@/stores/auth-store';
import { ParticipantTile, RemoteAudio } from './participant-tile';
import { ScreenStage } from './screen-stage';
import { ChatPanel, NotesPanel, ParticipantsPanel, PollPanel } from './meeting-panels';

type Panel = 'none' | 'chat' | 'participants' | 'notes' | 'poll';
type Layout = 'stage' | 'gallery' | 'focus';

/** A small draggable floating tile (self-view / PiP), clamped to the viewport. */
function DraggablePip({ children }: { children: React.ReactNode }) {
  const [pos, setPos] = useState({ x: 24, y: 96 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      const w = 176;
      const h = 112;
      setPos({
        x: Math.min(window.innerWidth - w, Math.max(0, e.clientX - drag.current.dx)),
        y: Math.min(window.innerHeight - h, Math.max(0, e.clientY - drag.current.dy)),
      });
    };
    const up = () => (drag.current = null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);
  return (
    <div
      className="absolute z-20 h-28 w-44 cursor-grab overflow-hidden rounded-lg shadow-pop active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => (drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y })}
    >
      {children}
    </div>
  );
}

export function MeetingRoom({ huddle, label }: { huddle: HuddleController; label?: string }) {
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? '';
  const [panel, setPanel] = useState<Panel>('none');
  const [minimized, setMinimized] = useState(false);
  const [layout, setLayout] = useState<Layout>('stage');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [reactMenu, setReactMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);

  const isMod = huddle.myRole === 'host' || huddle.myRole === 'cohost';

  // Which screen is on stage: mine if I'm sharing, else the first remote screen.
  const remoteScreenEntries = Object.entries(huddle.remoteScreens);
  const stageStream = huddle.screenSharing
    ? huddle.localScreen
    : remoteScreenEntries.length > 0
      ? remoteScreenEntries[0][1]
      : null;
  const stageSharerId = huddle.screenSharing ? myId : remoteScreenEntries[0]?.[0];
  const stageSharerName = huddle.screenSharing
    ? 'You are sharing'
    : `${huddle.participants.find((p) => p.userId === stageSharerId)?.displayName ?? 'Someone'} is sharing`;
  const hasScreen = !!stageStream;
  const effectiveLayout: Layout = layout === 'focus' ? 'focus' : hasScreen ? layout : 'gallery';
  const focusTarget =
    huddle.participants.find((p) => p.userId === focusedId) ??
    huddle.participants.find((p) => huddle.speaking[p.userId]) ??
    huddle.participants[0];

  const controlLabel = huddle.control
    ? huddle.control.controllerId === myId
      ? 'You'
      : huddle.participants.find((p) => p.userId === huddle.control!.controllerId)?.displayName ?? 'Someone'
    : null;

  // ----- keyboard shortcuts (ignored while typing) -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case 'm': huddle.toggleMute(); break;
        case 'v': void huddle.toggleCamera(); break;
        case 'h': huddle.toggleHand(); break;
        case 'c': setPanel((p) => (p === 'chat' ? 'none' : 'chat')); break;
        case 'p': setPanel((p) => (p === 'participants' ? 'none' : 'participants')); break;
        case 's': huddle.screenSharing ? huddle.stopScreenShare() : void huddle.startScreenShare(); break;
        case 'escape': setPanel('none'); setReactMenu(false); setMoreMenu(false); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [huddle]);

  const tiles = useMemo(() => huddle.participants, [huddle.participants]);

  if (minimized) {
    return (
      <>
        {Object.entries(huddle.remoteStreams).map(([id, s]) => (
          <RemoteAudio key={id} stream={s} />
        ))}
        <button
          onClick={() => setMinimized(false)}
          className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-pop hover:bg-indigo-700"
          data-testid="meeting-restore"
        >
          <SquareStack size={15} /> Return to meeting · {huddle.participants.length}
        </button>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950 text-white" data-testid="meeting-room">
      <ReactionAnimations />
      {/* Hidden audio sinks */}
      {Object.entries(huddle.remoteStreams).map(([id, s]) => (
        <RemoteAudio key={id} stream={s} />
      ))}

      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <span className="text-[14px] font-semibold">{label ?? 'Huddle'}</span>
        <span className="text-[12px] text-white/50">{huddle.participants.length} in call</span>
        <ConnBadge state={huddle.connectionState} />
        <span className="flex-1" />
        <div className="hidden items-center gap-1 rounded-lg bg-white/10 p-0.5 sm:flex">
          {hasScreen && (
            <LayoutBtn active={layout === 'stage'} onClick={() => setLayout('stage')} icon={<SquareStack size={14} />} label="Stage" />
          )}
          <LayoutBtn active={layout === 'gallery'} onClick={() => setLayout('gallery')} icon={<LayoutGrid size={14} />} label="Gallery" />
          <LayoutBtn active={layout === 'focus'} onClick={() => setLayout('focus')} icon={<Focus size={14} />} label="Focus" />
        </div>
        <button onClick={() => setMinimized(true)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Minimize meeting">
          <Minimize2 size={16} />
        </button>
      </header>

      {/* Body: stage/gallery + optional side panel */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col p-3">
          {/* Incoming remote-control requests (I'm the presenter) */}
          {huddle.controlRequests.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {huddle.controlRequests.map((r) => (
                <div key={r.requesterId} className="flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-[13px] text-amber-100">
                  <span className="flex-1">
                    <strong>{r.requesterName}</strong> wants to control your shared screen.
                  </span>
                  <button onClick={() => huddle.respondControl(r.requesterId, 'grant')} className="rounded-md bg-green-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-green-700">
                    Allow
                  </button>
                  <button onClick={() => huddle.respondControl(r.requesterId, 'deny')} className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-white/20">
                    Deny
                  </button>
                </div>
              ))}
            </div>
          )}

          {effectiveLayout === 'stage' && hasScreen ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="min-h-0 flex-1">
                <ScreenStage
                  stream={stageStream}
                  label={stageSharerName}
                  live
                  annotations={huddle.annotations}
                  lasers={huddle.lasers}
                  canAnnotate={huddle.canAnnotate}
                  isModerator={isMod}
                  myId={myId}
                  controlLabel={controlLabel}
                  onOp={huddle.sendAnnotation}
                  onLaser={huddle.sendLaser}
                  onClear={huddle.clearAnnotations}
                />
              </div>
              {/* Draggable self-view PiP over the shared screen */}
              {huddle.cameraOn && huddle.localVideo && me && (
                <DraggablePip>
                  <ParticipantTile
                    participant={{ userId: myId, displayName: me.displayName, avatarUrl: me.avatarUrl }}
                    local
                    localVideo={huddle.localVideo}
                    speaking={huddle.speaking[myId]}
                    compact
                  />
                </DraggablePip>
              )}
              {/* Filmstrip */}
              <div className="flex h-24 shrink-0 gap-2 overflow-x-auto">
                {tiles.map((p) => (
                  <button
                    key={p.userId}
                    onClick={() => { setFocusedId(p.userId); setLayout('focus'); }}
                    className="aspect-video h-full shrink-0"
                    title={`Focus ${p.displayName}`}
                  >
                    <ParticipantTile
                      participant={p}
                      stream={huddle.remoteStreams[p.userId]}
                      local={p.userId === myId}
                      localVideo={huddle.localVideo}
                      speaking={huddle.speaking[p.userId]}
                      compact
                    />
                  </button>
                ))}
              </div>
              {/* Request-control affordance for viewers of someone else's screen */}
              {!huddle.screenSharing && stageSharerId && !huddle.control && (
                <button
                  onClick={() => huddle.requestControl(stageSharerId)}
                  className="mx-auto rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/80 hover:bg-white/20"
                >
                  Request control
                </button>
              )}
              {huddle.control?.presenterId === myId && (
                <button onClick={huddle.revokeControl} className="mx-auto rounded-full bg-red-600/80 px-3 py-1 text-[12px] font-semibold text-white hover:bg-red-600">
                  Stop remote control
                </button>
              )}
            </div>
          ) : effectiveLayout === 'focus' && focusTarget ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="min-h-0 flex-1">
                <ParticipantTile
                  participant={focusTarget}
                  stream={huddle.remoteStreams[focusTarget.userId]}
                  local={focusTarget.userId === myId}
                  localVideo={huddle.localVideo}
                  speaking={huddle.speaking[focusTarget.userId]}
                />
              </div>
              <div className="flex h-24 shrink-0 gap-2 overflow-x-auto">
                {tiles.map((p) => (
                  <button
                    key={p.userId}
                    onClick={() => setFocusedId(p.userId)}
                    className={`aspect-video h-full shrink-0 rounded-xl ${p.userId === focusTarget.userId ? 'ring-2 ring-accent' : ''}`}
                  >
                    <ParticipantTile
                      participant={p}
                      stream={huddle.remoteStreams[p.userId]}
                      local={p.userId === myId}
                      localVideo={huddle.localVideo}
                      speaking={huddle.speaking[p.userId]}
                      compact
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2 overflow-y-auto">
              {tiles.map((p) => (
                <button key={p.userId} onClick={() => { setFocusedId(p.userId); setLayout('focus'); }} className="min-h-0">
                  <ParticipantTile
                    participant={p}
                    stream={huddle.remoteStreams[p.userId]}
                    local={p.userId === myId}
                    localVideo={huddle.localVideo}
                    speaking={huddle.speaking[p.userId]}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Side panel */}
        {panel !== 'none' && (
          <aside className="flex w-full max-w-sm shrink-0 flex-col border-l border-white/10 bg-surface text-ink sm:w-80 md:w-96">
            <div className="flex h-11 items-center justify-between border-b border-line px-3">
              <span className="text-[13px] font-semibold capitalize">
                {panel === 'chat' && `Chat${huddle.unreadChat ? ` (${huddle.unreadChat})` : ''}`}
                {panel === 'participants' && `People (${huddle.participants.length})`}
                {panel === 'notes' && 'Notes'}
                {panel === 'poll' && 'Poll'}
              </span>
              <button onClick={() => setPanel('none')} className="rounded p-1 text-ink-3 hover:bg-hovered" aria-label="Close panel">
                <ChevronDown size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {panel === 'chat' && <ChatPanel huddle={huddle} myId={myId} />}
              {panel === 'participants' && <ParticipantsPanel huddle={huddle} myId={myId} />}
              {panel === 'notes' && <NotesPanel huddle={huddle} />}
              {panel === 'poll' && <PollPanel huddle={huddle} />}
            </div>
          </aside>
        )}
      </div>

      {/* Floating reactions */}
      <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center">
        <div className="relative h-40 w-64">
          {huddle.reactions.map((r, i) => (
            <span
              key={r.id}
              className="absolute bottom-0 text-3xl"
              style={{ left: `${15 + ((i * 37) % 70)}%`, animation: 'huddle-float 4s ease-out forwards' }}
              title={r.displayName}
            >
              {r.emoji}
            </span>
          ))}
        </div>
      </div>

      {/* Control bar */}
      <footer className="relative flex h-16 shrink-0 items-center justify-center gap-1.5 border-t border-white/10 px-3">
        <Ctrl label={huddle.muted ? 'Unmute (M)' : 'Mute (M)'} active={!huddle.muted} danger={huddle.muted} onClick={huddle.toggleMute} icon={huddle.muted ? <MicOff size={18} /> : <Mic size={18} />} testId="ctrl-mic" />
        <Ctrl label={huddle.cameraOn ? 'Stop video (V)' : 'Start video (V)'} active={huddle.cameraOn} onClick={() => void huddle.toggleCamera()} icon={huddle.cameraOn ? <Video size={18} /> : <VideoOff size={18} />} testId="ctrl-cam" />
        <Ctrl label={huddle.screenSharing ? 'Stop sharing (S)' : 'Share screen (S)'} active={huddle.screenSharing} onClick={() => (huddle.screenSharing ? huddle.stopScreenShare() : void huddle.startScreenShare())} icon={huddle.screenSharing ? <MonitorX size={18} /> : <MonitorUp size={18} />} testId="ctrl-screen" />
        <Ctrl label="Raise hand (H)" active={huddle.handRaised} onClick={huddle.toggleHand} icon={<Hand size={18} />} testId="ctrl-hand" />

        <div className="relative">
          <Ctrl label="Reactions" onClick={() => setReactMenu((v) => !v)} icon={<Smile size={18} />} testId="ctrl-react" />
          {reactMenu && (
            <div className="absolute bottom-14 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-gray-800 p-1.5 shadow-pop">
              {HUDDLE_REACTIONS.map((e) => (
                <button key={e} onClick={() => { huddle.sendReaction(e); setReactMenu(false); }} className="rounded-full p-1 text-xl hover:bg-white/15">
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        <Ctrl label="Chat (C)" active={panel === 'chat'} badge={huddle.unreadChat} onClick={() => setPanel((p) => (p === 'chat' ? 'none' : 'chat'))} icon={<MessageSquare size={18} />} testId="ctrl-chat" />
        <Ctrl label="People (P)" active={panel === 'participants'} onClick={() => setPanel((p) => (p === 'participants' ? 'none' : 'participants'))} icon={<Users size={18} />} testId="ctrl-people" />

        <div className="relative">
          <Ctrl label="More" onClick={() => setMoreMenu((v) => !v)} icon={<MoreHorizontal size={18} />} testId="ctrl-more" />
          {moreMenu && (
            <div className="absolute bottom-14 right-0 w-48 rounded-lg border border-white/10 bg-gray-800 py-1 text-[13px] shadow-pop">
              <MoreItem icon={<StickyNote size={14} />} onClick={() => { setPanel('notes'); setMoreMenu(false); }}>Meeting notes</MoreItem>
              <MoreItem icon={<Vote size={14} />} onClick={() => { setPanel('poll'); setMoreMenu(false); }}>Polls</MoreItem>
              {isMod && (
                <MoreItem icon={<Hand size={14} />} onClick={() => { setPanel('participants'); setMoreMenu(false); }}>
                  Moderate
                </MoreItem>
              )}
            </div>
          )}
        </div>

        <button
          onClick={huddle.leave}
          className="ml-2 flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-red-700"
          data-testid="ctrl-leave"
        >
          <PhoneOff size={16} /> Leave
        </button>
      </footer>
    </div>
  );
}

function Ctrl({
  label,
  icon,
  onClick,
  active,
  danger,
  badge,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  badge?: number;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={`relative grid h-11 w-11 place-items-center rounded-full transition-colors ${
        danger ? 'bg-red-500/20 text-red-300' : active ? 'bg-white text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      {icon}
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function LayoutBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[12px] ${active ? 'bg-white text-gray-900' : 'text-white/70 hover:bg-white/10'}`}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function MoreItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-white/90 hover:bg-white/10">
      {icon}
      {children}
    </button>
  );
}

function ConnBadge({ state }: { state: HuddleController['connectionState'] }) {
  if (state === 'connected') return null;
  const map = {
    reconnecting: { text: 'Reconnecting…', cls: 'bg-amber-500/20 text-amber-300', icon: <Wifi size={12} /> },
    unstable: { text: 'Connection unstable', cls: 'bg-red-500/20 text-red-300', icon: <WifiOff size={12} /> },
  } as const;
  const m = map[state];
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`} role="status">
      {m.icon} {m.text}
    </span>
  );
}

function ReactionAnimations() {
  return (
    <style>{`@keyframes huddle-float{0%{transform:translateY(0);opacity:0}10%{opacity:1}100%{transform:translateY(-140px);opacity:0}}`}</style>
  );
}
