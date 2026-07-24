'use client';

import { useEffect, useRef } from 'react';
import { Headphones, Maximize2, Mic, MicOff, MonitorUp, MonitorX, PhoneOff } from 'lucide-react';
import { Avatar } from './avatar';
import type { HuddleController } from '@/hooks/use-huddle';

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    // autoPlay alone can be a no-op when srcObject is set after mount; nudge it.
    el.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

function ScreenTile({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => undefined);
  }, [stream]);
  const enlarge = () => ref.current?.requestFullscreen?.().catch(() => undefined);
  return (
    <div className="group relative overflow-hidden rounded-md border border-gray-300 bg-black dark:border-gray-600">
      {/* Click anywhere on the screen to go fullscreen. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        onClick={enlarge}
        className="max-h-48 w-auto cursor-zoom-in"
      />
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {label}
      </span>
      <button
        onClick={enlarge}
        title="Enlarge (fullscreen)"
        data-testid="screen-enlarge"
        className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
      >
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

export function HuddleBar({ huddle }: { huddle: HuddleController }) {
  const { joined, participants, muted, remoteStreams, screenSharing, remoteScreens } = huddle;
  if (!joined && participants.length === 0) return null;

  const screenEntries = Object.entries(remoteScreens);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
    <div
      className="flex items-center gap-3 bg-indigo-50 px-4 py-2 dark:bg-indigo-950/40"
      data-testid="huddle-bar"
    >
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
        <Headphones size={15} /> Huddle
      </span>
      <div className="flex -space-x-1.5">
        {participants.map((p) => (
          <span key={p.userId} className="ring-2 ring-indigo-50 dark:ring-indigo-950">
            <Avatar
              user={{ id: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl }}
              size="xs"
            />
          </span>
        ))}
      </div>
      <span className="text-[12px] text-gray-500">
        {participants.length} {participants.length === 1 ? 'person' : 'people'}
      </span>

      <span className="flex-1" />

      {joined ? (
        <>
          <button
            onClick={huddle.toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
            className={`rounded-md p-1.5 ${muted ? 'bg-red-100 text-red-600 dark:bg-red-900/40' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
            data-testid="huddle-mute"
          >
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            onClick={() => (screenSharing ? huddle.stopScreenShare() : void huddle.startScreenShare())}
            title={screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
            className={`rounded-md p-1.5 ${screenSharing ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
            data-testid="huddle-screenshare"
          >
            {screenSharing ? <MonitorX size={16} /> : <MonitorUp size={16} />}
          </button>
          <button
            onClick={huddle.leave}
            className="flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-red-600"
            data-testid="huddle-leave"
          >
            <PhoneOff size={14} /> Leave
          </button>
        </>
      ) : (
        <button
          onClick={() => void huddle.join()}
          className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700"
          data-testid="huddle-join"
        >
          Join huddle
        </button>
      )}

      {Object.entries(remoteStreams).map(([id, stream]) => (
        <RemoteAudio key={id} stream={stream} />
      ))}
    </div>

    {(screenSharing || screenEntries.length > 0) && (
      <div className="flex flex-wrap gap-2 bg-indigo-50 px-4 pb-3 dark:bg-indigo-950/40" data-testid="huddle-screens">
        {screenEntries.map(([id, stream]) => {
          const who = participants.find((p) => p.userId === id)?.displayName ?? 'Someone';
          return <ScreenTile key={id} stream={stream} label={`${who}'s screen`} />;
        })}
        {screenSharing && (
          <span className="flex items-center rounded-md border border-dashed border-indigo-400 px-3 py-2 text-[12px] font-medium text-indigo-600 dark:text-indigo-300">
            You're sharing your screen
          </span>
        )}
      </div>
    )}
    </div>
  );
}
