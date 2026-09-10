'use client';

import { useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

/**
 * Records a short audio clip via MediaRecorder and hands the resulting file to
 * `onClip`, which feeds it through the composer's normal attachment upload.
 */
export function VoiceRecorderButton({ onClip }: { onClip: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        onClip(new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' }));
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      /* mic denied or unavailable — silently do nothing */
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <button
      type="button"
      onClick={() => (recording ? stop() : void start())}
      title={recording ? 'Stop & attach voice clip' : 'Record a voice clip'}
      data-testid="voice-record"
      className={
        recording
          ? 'animate-pulse rounded-md bg-red-500 p-1.5 text-white'
          : 'rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
      }
    >
      {recording ? <Square size={15} /> : <Mic size={15} />}
    </button>
  );
}
