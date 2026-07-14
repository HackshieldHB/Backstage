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

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type SignalData =
  | { kind: 'sdp'; description: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export interface HuddleController {
  joined: boolean;
  participants: HuddleParticipant[];
  muted: boolean;
  remoteStreams: Record<string, MediaStream>;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
}

/**
 * Slack-style audio huddle for a channel: a full WebRTC mesh where every
 * participant holds a peer connection to every other. Signaling (SDP + ICE) is
 * relayed peer-to-peer through the Socket.IO gateway; the deterministic
 * "lower userId offers" rule avoids offer glare.
 */
export function useHuddle(channelId: string | null): HuddleController {
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? '';
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState<HuddleParticipant[]>([]);
  const [muted, setMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  const joinedRef = useRef(false);

  const sendSignal = useCallback(
    (toUserId: string, data: SignalData) => {
      if (!channelId) return;
      getSocket().emit(CLIENT_EVENTS.HUDDLE_SIGNAL, { channelId, toUserId, data });
    },
    [channelId],
  );

  const closePeer = useCallback((peerId: string) => {
    const pc = peers.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      peers.current.delete(peerId);
    }
    setRemoteStreams((s) => {
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
      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(peerId, { kind: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const [stream] = e.streams;
        if (stream) setRemoteStreams((s) => ({ ...s, [peerId]: stream }));
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
        if (data.description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(fromUserId, { kind: 'sdp', description: pc.localDescription!.toJSON() });
        }
      } else {
        const pc = peers.current.get(fromUserId);
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
      }
    },
    [createPeer, sendSignal],
  );

  // Socket listeners for participant lists and relayed signaling.
  useEffect(() => {
    if (!channelId) return;
    const socket = getSocket();
    const onParticipants = (p: HuddleParticipantsPayload) => {
      if (p.channelId === channelId) setParticipants(p.participants);
    };
    const onSignal = (p: HuddleSignalPayload) => {
      if (p.channelId === channelId && joinedRef.current) {
        void handleSignal(p.fromUserId, p.data as SignalData);
      }
    };
    socket.on(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
    socket.on(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
    return () => {
      socket.off(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
      socket.off(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
    };
  }, [channelId, handleSignal]);

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

  const join = useCallback(async () => {
    if (!channelId || joinedRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      joinedRef.current = true;
      setJoined(true);
      setMuted(false);
      getSocket().emit(CLIENT_EVENTS.HUDDLE_JOIN, { channelId });
    } catch {
      window.alert('Could not access your microphone. Check browser permissions.');
    }
  }, [channelId]);

  const leave = useCallback(() => {
    if (channelId) getSocket().emit(CLIENT_EVENTS.HUDDLE_LEAVE, { channelId });
    for (const peerId of [...peers.current.keys()]) closePeer(peerId);
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    joinedRef.current = false;
    setJoined(false);
    setRemoteStreams({});
  }, [channelId, closePeer]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      localStream.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  // Leave automatically when the channel changes or the pane unmounts.
  useEffect(() => {
    return () => {
      if (joinedRef.current) leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return { joined, participants, muted, remoteStreams, join, leave, toggleMute };
}
