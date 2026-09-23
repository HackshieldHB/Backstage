'use client';

import { useRef, useState } from 'react';
import { MonitorPlay, Square } from 'lucide-react';

/**
 * Records a short screen clip with narration (screen video + tab/system audio +
 * mic, mixed) via MediaRecorder and hands the resulting video file to `onClip`,
 * which feeds it through the composer's normal attachment upload — a lightweight
 * async "Loom-style" clip to share instead of a meeting.
 */
export function ClipRecorderButton({ onClip }: { onClip: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const start = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return;
    let screen: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });
    } catch {
      return; // user dismissed the picker
    }
    let mic: MediaStream | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      mic = null; // record silent screen if the mic is unavailable
    }

    // Mix tab/system audio + mic into a single track.
    const AC: typeof AudioContext | undefined =
      (window.AudioContext as typeof AudioContext | undefined) ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let audioTracks: MediaStreamTrack[] = [];
    let ctx: AudioContext | null = null;
    if (AC && (screen.getAudioTracks().length || mic)) {
      ctx = new AC();
      const dest = ctx.createMediaStreamDestination();
      if (screen.getAudioTracks().length)
        ctx.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(dest);
      if (mic) ctx.createMediaStreamSource(mic).connect(dest);
      audioTracks = dest.stream.getAudioTracks();
    } else if (mic) {
      audioTracks = mic.getAudioTracks();
    }

    const combined = new MediaStream([...screen.getVideoTracks(), ...audioTracks]);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';

    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(combined, { mimeType: mime });
    } catch {
      screen.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      return;
    }
    chunksRef.current = [];
    cleanupRef.current = () => {
      screen.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      cleanupRef.current = null;
    };
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      onClip(new File([blob], `clip-${Date.now()}.webm`, { type: 'video/webm' }));
      cleanupRef.current?.();
    };
    // Stopping the share from the browser bar ends the recording too.
    screen.getVideoTracks()[0]?.addEventListener('ended', () => stop());
    rec.start();
    recorderRef.current = rec;
    setRecording(true);
  };

  if (typeof navigator !== 'undefined' && !navigator.mediaDevices?.getDisplayMedia) return null;

  return (
    <button
      type="button"
      onClick={() => (recording ? stop() : void start())}
      title={recording ? 'Stop & attach screen clip' : 'Record a screen clip'}
      data-testid="clip-record"
      className={
        recording
          ? 'animate-pulse rounded-md bg-red-500 p-1.5 text-white'
          : 'rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
      }
    >
      {recording ? <Square size={15} /> : <MonitorPlay size={15} />}
    </button>
  );
}
