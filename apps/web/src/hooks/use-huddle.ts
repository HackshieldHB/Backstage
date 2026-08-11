'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  type HuddleParticipant,
  type HuddleParticipantsPayload,
  type HuddleSignalPayload,
} from '@backstages/shared';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import type { Container } from '@/hooks/queries';

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type SignalData =
  | { kind: 'sdp'; description: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export interface HuddleController {
  /** The channel/DM the local user is currently in a huddle in, or null. */
  activeTarget: Container | null;
  joined: boolean;
  participants: HuddleParticipant[];
  /** Live participant lists for every container, so a channel can advertise an
   *  ongoing huddle even when it is not the one you are in. Keyed by container id. */
  participantsByContainer: Record<string, HuddleParticipant[]>;
  muted: boolean;
  remoteStreams: Record<string, MediaStream>;
  /** True while THIS client is sharing its screen. */
  screenSharing: boolean;
  /** The local screen-share stream, for the sharer's own self-preview. */
  localScreen: MediaStream | null;
  /** Remote peers' screen-share streams, keyed by userId. */
  remoteScreens: Record<string, MediaStream>;
  /** Start (or join) a huddle in the given channel/DM. */
  join: (target: Container) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
}

/**
 * Slack-style audio huddle: a full WebRTC mesh where every participant holds a
 * peer connection to every other. Signaling (SDP + ICE) is relayed peer-to-peer
 * through the Socket.IO gateway; the deterministic "lower userId offers" rule
 * avoids offer glare.
 *
 * This controller is mounted **once at the app shell** and is intentionally
 * decoupled from whatever channel/DM is being viewed: the huddle is bound to the
 * `activeTarget` the user explicitly joined, so navigating to another channel or
 * DM no longer tears it down. Participant lists for *all* containers are tracked
 * in parallel (the server broadcasts them to every room a member is in) so any
 * channel can still surface "N people are in a huddle — Join".
 */
export function useHuddle(): HuddleController {
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? '';

  const [activeTarget, setActiveTarget] = useState<Container | null>(null);
  const [joined, setJoined] = useState(false);
  const [participantsByContainer, setParticipantsByContainer] = useState<
    Record<string, HuddleParticipant[]>
  >({});
  const [muted, setMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [screenSharing, setScreenSharing] = useState(false);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});

  // The target the user is actually huddling in, mirrored in a ref so socket
  // handlers (which close over a stable identity) can read the latest value.
  const activeTargetRef = useRef<Container | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  // ICE candidates that arrive before the remote description is set must be
  // buffered — adding them early throws and silently kills the connection.
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const screenStream = useRef<MediaStream | null>(null);
  // The RTCRtpSender carrying our screen track on each peer, so we can drop it.
  const screenSenders = useRef<Map<string, RTCRtpSender>>(new Map());
  const joinedRef = useRef(false);

  const bodyFor = useCallback(
    (target: Container) =>
      target.kind === 'channel' ? { channelId: target.id } : { conversationId: target.id },
    [],
  );

  const sendSignal = useCallback(
    (toUserId: string, data: SignalData) => {
      const target = activeTargetRef.current;
      if (!target) return;
      getSocket().emit(CLIENT_EVENTS.HUDDLE_SIGNAL, { ...bodyFor(target), toUserId, data });
    },
    [bodyFor],
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

  // Socket listeners: participant lists for ALL containers, plus relayed
  // signaling that belongs to the huddle we are actually in.
  useEffect(() => {
    if (!me) return;
    const socket = getSocket();
    const onParticipants = (p: HuddleParticipantsPayload) => {
      const containerId = p.channelId ?? p.conversationId;
      if (!containerId) return;
      setParticipantsByContainer((s) => {
        if (p.participants.length === 0) {
          if (!(containerId in s)) return s;
          const next = { ...s };
          delete next[containerId];
          return next;
        }
        return { ...s, [containerId]: p.participants };
      });
    };
    const onSignal = (p: HuddleSignalPayload) => {
      const target = activeTargetRef.current;
      const containerId = p.channelId ?? p.conversationId;
      if (target && containerId === target.id && joinedRef.current) {
        void handleSignal(p.fromUserId, p.data as SignalData);
      }
    };
    socket.on(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
    socket.on(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
    return () => {
      socket.off(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
      socket.off(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
    };
  }, [me, handleSignal]);

  const participants = useMemo(
    () => (activeTarget ? (participantsByContainer[activeTarget.id] ?? []) : []),
    [activeTarget, participantsByContainer],
  );

  // Reconcile the mesh whenever the active huddle's participant set changes.
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
    setLocalScreen(null);
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
    setLocalScreen(stream);
    setScreenSharing(true);
    const track = stream.getVideoTracks()[0];
    // Ending the share from the browser's own "Stop sharing" bar cleans up too.
    track.addEventListener('ended', () => stopScreenShare());
    for (const [peerId, pc] of peers.current) {
      screenSenders.current.set(peerId, pc.addTrack(track, stream));
      await renegotiate(peerId);
    }
  }, [renegotiate, stopScreenShare]);

  // Tear down the mesh + local media without touching the active-target React
  // state, so it can be called from `join` (switching huddles) and from `leave`.
  const leaveInternal = useCallback(() => {
    const target = activeTargetRef.current;
    if (target) getSocket().emit(CLIENT_EVENTS.HUDDLE_LEAVE, bodyFor(target));
    stopScreenShare();
    for (const peerId of [...peers.current.keys()]) closePeer(peerId);
    pendingIce.current.clear();
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    joinedRef.current = false;
    activeTargetRef.current = null;
    setRemoteStreams({});
    setRemoteScreens({});
  }, [bodyFor, closePeer, stopScreenShare]);

  const join = useCallback(
    async (target: Container) => {
      if (joinedRef.current) {
        // Already in a huddle. Only re-join if it's a different container.
        if (activeTargetRef.current?.id === target.id) return;
        leaveInternal();
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.current = stream;
        joinedRef.current = true;
        activeTargetRef.current = target;
        setActiveTarget(target);
        setJoined(true);
        setMuted(false);
        getSocket().emit(CLIENT_EVENTS.HUDDLE_JOIN, bodyFor(target));
      } catch {
        useUiStore
          .getState()
          .pushToast('Could not access your microphone. Check browser permissions.', 'error');
      }
    },
    [bodyFor, leaveInternal],
  );

  const leave = useCallback(() => {
    leaveInternal();
    setActiveTarget(null);
    setJoined(false);
  }, [leaveInternal]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      localStream.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  // Only tears down on app-shell unmount (i.e. logout / full navigation away).
  useEffect(() => {
    return () => {
      if (joinedRef.current) leaveInternal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    activeTarget,
    joined,
    participants,
    participantsByContainer,
    muted,
    remoteStreams,
    screenSharing,
    localScreen,
    remoteScreens,
    join,
    leave,
    toggleMute,
    startScreenShare,
    stopScreenShare,
  };
}
