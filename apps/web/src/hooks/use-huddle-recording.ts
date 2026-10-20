'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_UPLOAD_BYTES } from '@backstages/shared';
import { api } from '@/lib/api';
import { containerPath, type Container } from '@/hooks/queries';
import type { HuddleController } from '@/hooks/use-huddle';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import {
  extensionFor,
  formatDuration,
  HuddleRecorder,
  recordingSupported,
  type RecordingResult,
} from '@/lib/huddle-recorder';

export interface HuddleRecordingController {
  supported: boolean;
  /** Recordings started here run on the media server (video + audio), not in this browser. */
  serverMode: boolean;
  /** Who is recording this huddle right now (shown to everyone), or null. */
  recordingBy: string | null;
  /** The current recording runs on the media server. */
  onServer: boolean;
  /** True when this browser is the one recording (or I started the server recording). */
  isMine: boolean;
  /** I'm a moderator, nobody is recording yet, and the browser can record. */
  canStart: boolean;
  /** I'm a moderator (any moderator may stop someone's recording). */
  canStop: boolean;
  elapsedMs: number;
  saving: boolean;
  start: () => void;
  stop: () => void;
}

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/**
 * Huddle recording, owned by the app shell so it survives navigation and the
 * meeting window closing. The server holds `recordingBy` so every participant
 * sees the recording indicator; when the recording ends (stopped by anyone
 * allowed, the recorder leaving, or the size limit) the file is uploaded and
 * posted to the huddle's channel/DM — or downloaded locally if that fails.
 */
export function useHuddleRecording(huddle: HuddleController, workspaceId: string | null): HuddleRecordingController {
  const me = useAuthStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const recorderRef = useRef<HuddleRecorder | null>(null);
  const targetRef = useRef<{ container: Container; workspaceId: string } | null>(null);
  const confirmedRef = useRef(false);
  const finishingRef = useRef(false);
  const [isMine, setIsMine] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);

  const recordingBy = huddle.joined ? huddle.settings.recordingBy : null;
  const isModerator = huddle.myRole === 'host' || huddle.myRole === 'cohost';
  // SFU huddles with an Egress worker record on the server; otherwise in this browser.
  const serverMode = huddle.serverRecordingAvailable === true;
  const supported = serverMode || recordingSupported();
  const onServer = recordingBy !== null && huddle.settings.recordingOnServer === true;
  const serverIsMine = onServer && recordingBy === me?.id;
  // When the server recording I'm looking at started (for the elapsed timer).
  const [serverStartedAt, setServerStartedAt] = useState<number | null>(null);
  const serverRequestedRef = useRef(false);
  const serverStoppedByMeRef = useRef(false);

  const streams = useCallback((): MediaStream[] => {
    const local = huddle.getLocalStream();
    return [
      ...(local ? [local] : []),
      ...Object.values(huddle.remoteStreams),
      ...Object.values(huddle.remoteScreens ?? {}),
    ];
  }, [huddle]);

  const deliver = useCallback(
    async (result: RecordingResult, target: { container: Container; workspaceId: string }) => {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const filename = `huddle-recording-${stamp.replace(/[: ]/g, '-')}.${extensionFor(result.mimeType)}`;
      const text = `🔴 Huddle recording · ${formatDuration(result.durationMs)}`;
      try {
        const fd = new FormData();
        fd.append('file', new File([result.blob], filename, { type: result.mimeType }));
        const uploaded = await api<{ id: string }>('POST', `/workspaces/${target.workspaceId}/attachments`, undefined, {
          formData: fd,
        });
        await api('POST', `${containerPath(target.container)}/messages`, {
          clientMsgId: crypto.randomUUID(),
          contentJson: doc(text),
          contentText: text,
          attachmentIds: [uploaded.id],
        });
        pushToast('Recording saved to the conversation.', 'success');
      } catch (err) {
        // Never lose a recording: hand it to the user instead.
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        pushToast(
          `Couldn't post the recording (${err instanceof Error ? err.message : 'upload failed'}) — it was downloaded instead.`,
          'error',
        );
      }
    },
    [pushToast],
  );

  const finish = useCallback(async () => {
    const rec = recorderRef.current;
    const target = targetRef.current;
    if (!rec || !target || finishingRef.current) return;
    finishingRef.current = true;
    recorderRef.current = null;
    setIsMine(false);
    setStartedAt(null);
    setSaving(true);
    try {
      const result = await rec.stop();
      if (result.blob.size === 0) pushToast('Nothing was recorded.', 'info');
      else await deliver(result, target);
    } finally {
      setSaving(false);
      finishingRef.current = false;
      confirmedRef.current = false;
      targetRef.current = null;
    }
  }, [deliver, pushToast]);

  const start = useCallback(() => {
    const container = huddle.activeTarget;
    if (!container || !workspaceId || !huddle.joined || !isModerator || recordingBy || recorderRef.current || !supported) return;
    if (serverMode) {
      // The media server records; the file is posted to the conversation when it's ready.
      serverRequestedRef.current = true;
      serverStoppedByMeRef.current = false;
      huddle.updateSettings({ recording: true, onServer: true });
      return;
    }
    try {
      const rec = new HuddleRecorder({
        maxBytes: MAX_UPLOAD_BYTES,
        onLimit: () => {
          pushToast('Recording stopped at the file size limit.', 'info');
          huddle.updateSettings({ recording: false });
          void finish();
        },
      });
      rec.start(streams());
      recorderRef.current = rec;
      targetRef.current = { container, workspaceId };
      confirmedRef.current = false;
      setIsMine(true);
      setStartedAt(Date.now());
      huddle.updateSettings({ recording: true });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not start recording', 'error');
    }
  }, [huddle, isModerator, recordingBy, supported, serverMode, streams, workspaceId, pushToast, finish]);

  const stop = useCallback(() => {
    if (!isModerator && !recorderRef.current) return;
    huddle.updateSettings({ recording: false });
    if (onServer) {
      serverStoppedByMeRef.current = true;
      pushToast('Recording stopped — it will be posted to the conversation once the server has processed it.', 'success');
    }
    if (recorderRef.current) void finish();
  }, [huddle, isModerator, onServer, finish, pushToast]);

  // Server recordings: run the timer while one is on, and tell whoever asked for
  // it when it ends without them stopping it (e.g. the media server gave up).
  useEffect(() => {
    if (onServer) {
      setServerStartedAt((t) => t ?? Date.now());
      return;
    }
    setServerStartedAt(null);
    if (serverRequestedRef.current && recordingBy === null) {
      if (!serverStoppedByMeRef.current) pushToast('The server recording has ended.', 'info');
      serverRequestedRef.current = false;
      serverStoppedByMeRef.current = false;
    }
  }, [onServer, recordingBy, pushToast]);

  // Keep the mix in step with who's in the huddle.
  useEffect(() => {
    if (recorderRef.current?.recording) recorderRef.current.sync(streams());
  }, [streams, huddle.remoteStreams, huddle.remoteScreens]);

  // React to the server's view: confirmation, someone else winning the race,
  // a moderator stopping it, or leaving the huddle.
  useEffect(() => {
    if (!recorderRef.current) return;
    if (!huddle.joined) {
      void finish();
      return;
    }
    if (recordingBy === me?.id) {
      confirmedRef.current = true;
      return;
    }
    if (recordingBy !== null || confirmedRef.current) void finish();
  }, [recordingBy, huddle.joined, me?.id, finish]);

  // Elapsed-time ticker while this browser records.
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  // Tick while a server recording is on, too.
  useEffect(() => {
    if (serverStartedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [serverStartedAt]);

  const shownStart = isMine ? startedAt : serverIsMine ? serverStartedAt : null;
  return {
    supported,
    serverMode,
    recordingBy,
    onServer,
    isMine: isMine || serverIsMine,
    canStart: supported && isModerator && huddle.joined && !recordingBy && !isMine && !saving,
    canStop: (isModerator && !!recordingBy) || isMine,
    elapsedMs: shownStart === null ? 0 : Math.max(0, now - shownStart),
    saving,
    start,
    stop,
  };
}
