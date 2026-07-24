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

  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  // ICE candidates that arrive before the remote description is set must be
  // buffered — adding them early throws and silently kills the connection.
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
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
    for (const peerId of [...peers.current.keys()]) closePeer(peerId);
    pendingIce.current.clear();
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    joinedRef.current = false;
    setJoined(false);
    setRemoteStreams({});
  }, [targetId, targetBody, closePeer]);

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

  return { joined, participants, muted, remoteStreams, join, leave, toggleMute };
}
