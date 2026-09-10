'use client';

import { useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  Headphones,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
} from 'lucide-react';
import { Avatar } from './avatar';
import { Tooltip } from './tooltip';
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

/**
 * A single screen-share tile. `live` gives it Slack's green "actively sharing"
 * border + badge so it's unmistakable which video is a shared screen. `muted`
 * is set for the sharer's own self-preview to avoid audio feedback (screen
 * audio isn't captured anyway, but it's the correct default).
 */
function ScreenTile({
  stream,
  label,
  live,
}: {
  stream: MediaStream;
  label: string;
  live?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => undefined);
  }, [stream]);
  const enlarge = () => ref.current?.requestFullscreen?.().catch(() => undefined);
  return (
    <div
      className={
        live
          ? 'group relative overflow-hidden rounded-md bg-black ring-2 ring-green-500'
          : 'group relative overflow-hidden rounded-md border border-line-strong bg-black dark:border-line-strong'
      }
      data-testid={live ? 'screen-tile-live' : 'screen-tile'}
    >
      {/* Click anywhere on the screen to go fullscreen. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        onClick={enlarge}
        className="max-h-48 w-auto cursor-zoom-in"
      />
      {live && (
        <span className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
        </span>
      )}
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

export function HuddleBar({
  huddle,
  targetLabel,
  viewingActive = true,
  onOpenTarget,
}: {
  huddle: HuddleController;
  /** Human label for the channel/DM the huddle is in (e.g. "#general"). */
  targetLabel?: string;
  /** True when the user is currently viewing the channel/DM the huddle is in. */
  viewingActive?: boolean;
  /** Jump to the huddle's channel/DM (shown when viewing a different one). */
  onOpenTarget?: () => void;
}) {
  const { joined, participants, muted, remoteStreams, screenSharing, localScreen, remoteScreens } =
    huddle;
  if (!joined && participants.length === 0) return null;

  const screenEntries = Object.entries(remoteScreens);
  const showScreens = screenSharing || screenEntries.length > 0;

  return (
    <div className="border-b border-line">
      <div
        className="flex items-center gap-3 bg-indigo-50 px-4 py-2 dark:bg-indigo-950/40"
        data-testid="huddle-bar"
      >
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
          <Headphones size={15} /> Huddle
          {targetLabel && (
            <span className="font-normal text-indigo-500/80 dark:text-indigo-300/70">
              in {targetLabel}
            </span>
          )}
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

        {!viewingActive && onOpenTarget && (
          <button
            onClick={onOpenTarget}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-indigo-600 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
            data-testid="huddle-open-target"
          >
            <ArrowUpRight size={13} /> Open
          </button>
        )}

        <span className="flex-1" />

        {joined ? (
          <>
            <Tooltip label={muted ? 'Unmute' : 'Mute'}>
              <button
                onClick={huddle.toggleMute}
                className={`rounded-md p-1.5 ${muted ? 'bg-red-100 text-red-600 dark:bg-red-900/40' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                data-testid="huddle-mute"
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            </Tooltip>
            <Tooltip label={screenSharing ? 'Stop sharing your screen' : 'Share your screen'}>
              <button
                onClick={() =>
                  screenSharing ? huddle.stopScreenShare() : void huddle.startScreenShare()
                }
                className={`rounded-md p-1.5 ${screenSharing ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                data-testid="huddle-screenshare"
                aria-label={screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
              >
                {screenSharing ? <MonitorX size={16} /> : <MonitorUp size={16} />}
              </button>
            </Tooltip>
            <button
              onClick={huddle.leave}
              className="flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-red-600"
              data-testid="huddle-leave"
            >
              <PhoneOff size={14} /> Leave
            </button>
          </>
        ) : (
          onOpenTarget && (
            <button
              onClick={onOpenTarget}
              className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700"
              data-testid="huddle-join"
            >
              Join huddle
            </button>
          )
        )}

        {Object.entries(remoteStreams).map(([id, stream]) => (
          <RemoteAudio key={id} stream={stream} />
        ))}
      </div>

      {showScreens && (
        <div
          className="flex flex-wrap gap-2 bg-indigo-50 px-4 pb-3 dark:bg-indigo-950/40"
          data-testid="huddle-screens"
        >
          {/* The sharer's own live preview — a green-bordered thumbnail so you
              can see exactly what you're broadcasting, Slack-style. */}
          {screenSharing && localScreen && (
            <ScreenTile stream={localScreen} label="You're sharing" live />
          )}
          {screenEntries.map(([id, stream]) => {
            const who = participants.find((p) => p.userId === id)?.displayName ?? 'Someone';
            return <ScreenTile key={id} stream={stream} label={`${who}'s screen`} live />;
          })}
        </div>
      )}
    </div>
  );
}
