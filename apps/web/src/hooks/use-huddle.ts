'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  type HuddleParticipant,
  type HuddleParticipantsPayload,
  type HuddleSignalPayload,
} from '@backstages/shared';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';
import type { Container } from '@/hooks/queries';

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type SignalData =
  | { kind: 'sdp'; description: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export interface HuddleController {
  joined: boolean;
  participants: HuddleParticipant[];
  muted: boolean;
  remoteStreams: Record<string, MediaStream>;
  /** True while THIS client is sharing its screen. */
  screenSharing: boolean;
  /** Remote peers' screen-share streams, keyed by userId. */
  remoteScreens: Record<string, MediaStream>;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
}

/**
 * Slack-style audio huddle for a channel: a full WebRTC mesh where every
 * participant holds a peer connection to every other. Signaling (SDP + ICE) is
 * relayed peer-to-peer through the Socket.IO gateway; the deterministic
 * "lower userId offers" rule avoids offer glare.
 */
export function useHuddle(target: Container | null): HuddleController {
  // A huddle can run in a channel or a DM/group conversation.
  const targetId = target?.id ?? null;
  const isChannel = target?.kind === 'channel';
  const targetBody = useCallback(
    () => (isChannel ? { channelId: targetId! } : { conversationId: targetId! }),
    [isChannel, targetId],
  );
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? '';
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState<HuddleParticipant[]>([]);
  const [muted, setMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});

  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  // ICE candidates that arrive before the remote description is set must be
  // buffered — adding them early throws and silently kills the connection.
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const screenStream = useRef<MediaStream | null>(null);
  // The RTCRtpSender carrying our screen track on each peer, so we can drop it.
  const screenSenders = useRef<Map<string, RTCRtpSender>>(new Map());
  const joinedRef = useRef(false);

  const sendSignal = useCallback(
    (toUserId: string, data: SignalData) => {
      if (!targetId) return;
      getSocket().emit(CLIENT_EVENTS.HUDDLE_SIGNAL, { ...targetBody(), toUserId, data });
    },
    [targetId, targetBody],
  );

  const closePeer = useCallback((peerId: string) => {
    const pc = peers.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      peers.current.delete(peerId);
    }
    pendingIce.current.delete(peerId);
    screenSenders.current.delete(peerId);
    setRemoteStreams((s) => {
      if (!(peerId in s)) return s;
      const next = { ...s };
      delete next[peerId];
      return next;
    });
    setRemoteScreens((s) => {
      if (!(peerId in s)) return s;
      const next = { ...s };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeer = useCallback(
    (peerId: string, initiator: boolean) => {
      const existing = peers.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection(ICE);
      localStream.current?.getTracks().forEach((t) => pc.addTrack(t, localStream.current!));
      // If we're already sharing our screen when this peer connects, offer it
      // too. (They see it immediately when we're the initiator; otherwise on
      // our next share toggle — a mesh-renegotiation trade-off.)
      const screenTrack = screenStream.current?.getVideoTracks()[0];
      if (screenTrack) {
        screenSenders.current.set(peerId, pc.addTrack(screenTrack, screenStream.current!));
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(peerId, { kind: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const [stream] = e.streams;
        if (!stream) return;
        if (e.track.kind === 'video') {
          // A screen-share track — track it separately from the voice stream
          // and clear it when the sharer stops (the track ends).
          setRemoteScreens((s) => ({ ...s, [peerId]: stream }));
          e.track.addEventListener('ended', () =>
            setRemoteScreens((s) => {
              if (!(peerId in s)) return s;
              const next = { ...s };
              delete next[peerId];
              return next;
            }),
          );
        } else {
          setRemoteStreams((s) => ({ ...s, [peerId]: stream }));
        }
      };
      peers.current.set(peerId, pc);
      if (initiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => sendSignal(peerId, { kind: 'sdp', description: pc.localDescription!.toJSON() }))
          .catch(() => undefined);
      }
      return pc;
    },
    [sendSignal],
  );

  const handleSignal = useCallback(
    async (fromUserId: string, data: SignalData) => {
      if (data.kind === 'sdp') {
        const pc = peers.current.get(fromUserId) ?? createPeer(fromUserId, false);
        await pc.setRemoteDescription(data.description).catch(() => undefined);
        // Now that the remote description exists, drain any ICE that raced ahead.
        const queued = pendingIce.current.get(fromUserId);
        if (queued) {
          pendingIce.current.delete(fromUserId);
          for (const c of queued) await pc.addIceCandidate(c).catch(() => undefined);
        }
        if (data.description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(fromUserId, { kind: 'sdp', description: pc.localDescription!.toJSON() });
        }
      } else {
        const pc = peers.current.get(fromUserId);
        if (pc?.remoteDescription) {
          await pc.addIceCandidate(data.candidate).catch(() => undefined);
        } else {
          // Peer/remote-desc not ready yet — buffer until setRemoteDescription runs.
          const q = pendingIce.current.get(fromUserId) ?? [];
          q.push(data.candidate);
          pendingIce.current.set(fromUserId, q);
        }
      }
    },
    [createPeer, sendSignal],
  );

  // Socket listeners for participant lists and relayed signaling.
  useEffect(() => {
    if (!targetId) return;
    const socket = getSocket();
    // The server echoes whichever id applies (channelId or conversationId).
    const onParticipants = (p: HuddleParticipantsPayload) => {
      if ((p.channelId ?? p.conversationId) === targetId) setParticipants(p.participants);
    };
    const onSignal = (p: HuddleSignalPayload) => {
      if ((p.channelId ?? p.conversationId) === targetId && joinedRef.current) {
        void handleSignal(p.fromUserId, p.data as SignalData);
      }
    };
    socket.on(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
    socket.on(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
    return () => {
      socket.off(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
      socket.off(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
    };
  }, [targetId, handleSignal]);

  // Reconcile the mesh whenever the participant set changes (while joined).
  useEffect(() => {
    if (!joinedRef.current) return;
    const present = new Set(participants.map((p) => p.userId));
    for (const p of participants) {
      if (p.userId === myId) continue;
      if (!peers.current.has(p.userId) && myId < p.userId) createPeer(p.userId, true);
    }
    for (const peerId of [...peers.current.keys()]) {
      if (!present.has(peerId)) closePeer(peerId);
    }
  }, [participants, myId, createPeer, closePeer]);

  // Screen-share renegotiation is always driven by the sharer, so peers only
  // ever answer (the existing offer→answer path) — no glare handling needed.
  const renegotiate = useCallback(
    async (peerId: string) => {
      const pc = peers.current.get(peerId);
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(peerId, { kind: 'sdp', description: pc.localDescription!.toJSON() });
    },
    [sendSignal],
  );

  const stopScreenShare = useCallback(() => {
    const stream = screenStream.current;
    if (!stream) return;
    for (const [peerId, sender] of screenSenders.current) {
      const pc = peers.current.get(peerId);
      if (pc) {
        try {
          pc.removeTrack(sender);
        } catch {
          // peer already gone
        }
        void renegotiate(peerId);
      }
    }
    screenSenders.current.clear();
    stream.getTracks().forEach((t) => t.stop());
    screenStream.current = null;
    setScreenSharing(false);
  }, [renegotiate]);

  const startScreenShare = useCallback(async () => {
    if (!joinedRef.current || screenStream.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return; // user dismissed the picker
    }
    screenStream.current = stream;
    setScreenSharing(true);
    const track = stream.getVideoTracks()[0];
    // Ending the share from the browser's own "Stop sharing" bar cleans up too.
    track.addEventListener('ended', () => stopScreenShare());
    for (const [peerId, pc] of peers.current) {
      screenSenders.current.set(peerId, pc.addTrack(track, stream));
      await renegotiate(peerId);
    }
  }, [renegotiate, stopScreenShare]);

  const join = useCallback(async () => {
    if (!targetId || joinedRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      joinedRef.current = true;
      setJoined(true);
      setMuted(false);
      getSocket().emit(CLIENT_EVENTS.HUDDLE_JOIN, targetBody());
    } catch {
      window.alert('Could not access your microphone. Check browser permissions.');
    }
  }, [targetId, targetBody]);

  const leave = useCallback(() => {
    if (targetId) getSocket().emit(CLIENT_EVENTS.HUDDLE_LEAVE, targetBody());
    stopScreenShare();
    for (const peerId of [...peers.current.keys()]) closePeer(peerId);
    pendingIce.current.clear();
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    joinedRef.current = false;
    setJoined(false);
    setRemoteStreams({});
    setRemoteScreens({});
  }, [targetId, targetBody, closePeer, stopScreenShare]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      localStream.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  // Leave automatically when the channel/DM changes or the pane unmounts.
  useEffect(() => {
    return () => {
      if (joinedRef.current) leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  return {
    joined,
    participants,
    muted,
    remoteStreams,
    screenSharing,
    remoteScreens,
    join,
    leave,
    toggleMute,
    startScreenShare,
    stopScreenShare,
  };
}
