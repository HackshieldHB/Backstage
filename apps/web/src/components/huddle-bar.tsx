'use client';

import { useEffect, useRef } from 'react';
import { Headphones, Mic, MicOff, PhoneOff } from 'lucide-react';
import { Avatar } from './avatar';
import type { HuddleController } from '@/hooks/use-huddle';

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

export function HuddleBar({ huddle }: { huddle: HuddleController }) {
  const { joined, participants, muted, remoteStreams } = huddle;
  if (!joined && participants.length === 0) return null;

  return (
    <div
      className="flex items-center gap-3 border-b border-gray-200 bg-indigo-50 px-4 py-2 dark:border-gray-700 dark:bg-indigo-950/40"
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
  );
}
