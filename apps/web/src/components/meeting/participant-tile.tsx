'use client';

import { memo, useEffect, useRef } from 'react';
import { Hand, Mic, MicOff, MonitorUp, Video, VideoOff } from 'lucide-react';
import type { HuddleParticipant } from '@backstages/shared';
import { Avatar } from '../avatar';

/** Plays a remote peer's audio. Kept separate from the (muted) tile video so audio
 *  survives layout changes without re-attaching a large video element. */
export const RemoteAudio = memo(function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
});

/** A camera/avatar tile. `stream` carries the participant's A/V; video renders only
 *  when the server says their camera is on, otherwise a large avatar. Memoized so
 *  one participant's state change doesn't re-render the whole grid. */
export const ParticipantTile = memo(function ParticipantTile({
  participant,
  stream,
  local,
  localVideo,
  speaking,
  compact,
}: {
  participant: HuddleParticipant;
  stream?: MediaStream;
  /** True for the local user's own tile. */
  local?: boolean;
  /** The local self-view stream (camera), only for the local tile. */
  localVideo?: MediaStream | null;
  speaking?: boolean;
  compact?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStream = local ? localVideo ?? null : participant.videoEnabled ? stream ?? null : null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (videoStream) {
      el.srcObject = videoStream;
      el.play().catch(() => undefined);
    } else {
      el.srcObject = null;
    }
  }, [videoStream]);

  return (
    <div
      className={`group relative flex items-center justify-center overflow-hidden rounded-xl bg-gray-800 ${
        speaking ? 'ring-2 ring-green-400' : 'ring-1 ring-white/10'
      }`}
      data-testid="participant-tile"
      aria-label={`${participant.displayName}${participant.audioEnabled === false ? ', muted' : ''}${
        participant.handRaised ? ', hand raised' : ''
      }`}
    >
      {videoStream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${local ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Avatar
            user={{ id: participant.userId, displayName: participant.displayName, avatarUrl: participant.avatarUrl }}
            size={compact ? 'md' : 'lg'}
          />
        </div>
      )}

      {/* Name + mic state, bottom-left */}
      <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
        {participant.audioEnabled === false ? (
          <MicOff size={11} className="text-red-400" />
        ) : (
          <Mic size={11} className={speaking ? 'text-green-400' : 'text-white/70'} />
        )}
        <span className="max-w-[8rem] truncate">
          {participant.displayName}
          {local ? ' (you)' : ''}
        </span>
        {participant.role === 'host' && <span className="text-[9px] font-bold uppercase text-amber-300">Host</span>}
        {participant.role === 'cohost' && (
          <span className="text-[9px] font-bold uppercase text-amber-200/80">Co-host</span>
        )}
      </div>

      {/* Status badges, top-right */}
      <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1">
        {participant.screenSharing && (
          <span className="rounded bg-green-600 p-1 text-white" title="Sharing screen">
            <MonitorUp size={11} />
          </span>
        )}
        {participant.handRaised && (
          <span className="rounded bg-amber-400 p-1 text-black" title="Hand raised">
            <Hand size={11} />
          </span>
        )}
        {!compact &&
          (participant.videoEnabled ? (
            <span className="rounded bg-black/40 p-1 text-white/70">
              <Video size={11} />
            </span>
          ) : (
            <span className="rounded bg-black/40 p-1 text-white/50">
              <VideoOff size={11} />
            </span>
          ))}
      </div>
    </div>
  );
});
