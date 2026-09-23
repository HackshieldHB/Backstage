'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  type HuddleParticipant,
  type HuddleParticipantsPayload,
  type HuddleSignalPayload,
  type HuddleChatPayload,
  type HuddleReactionPayload,
  type HuddleAnnotationPayload,
  type HuddleAnnotationOp,
  type HuddleAnnotationShape,
  type HuddleLaserPayload,
  type HuddleControlPayload,
  type HuddlePollPayload,
  type HuddleNotesPayload,
  type HuddleModerationPayload,
  type HuddleCaptionPayload,
  type HuddleRole,
  type HuddleSettings,
  type HuddleSettingsPayload,
  type HuddleWaitingPayload,
  type HuddleWaitingEntry,
  type HuddleWhiteboardPayload,
  type HuddleWhiteboardOp,
  type HuddleBreakoutPayload,
  type BreakoutRoom,
} from '@backstages/shared';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { BackgroundBlurProcessor, backgroundBlurSupported } from '@/lib/background-blur';
import type { Container } from '@/hooks/queries';

export type ConnectionState = 'connected' | 'reconnecting' | 'unstable';
/** My own admission state relative to a waiting-room-gated huddle. */
export type AdmitStatus = 'pending' | 'waiting' | 'admitted' | 'denied';

/** A remote laser pointer position, with a timestamp so stale pointers fade out. */
export interface LaserState {
  userId: string;
  displayName: string;
  point: { x: number; y: number };
  at: number;
}

/** A transient reaction bubble to float over the meeting. */
export interface FloatingReaction {
  id: string;
  userId: string;
  displayName: string;
  emoji: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  text: string;
  replyTo: string | null;
  createdAt: string;
}

export interface ControlSessionState {
  controllerId: string;
  presenterId: string;
}

export interface IncomingControlRequest {
  requesterId: string;
  requesterName: string;
}

export interface LivePoll {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  createdBy: string;
  closed: boolean;
}

export interface CaptionState {
  userId: string;
  displayName: string;
  text: string;
  final: boolean;
  at: number;
}

// Minimal typings for the Web Speech API (not in the standard TS DOM lib).
interface SpeechRecognitionAltLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAltLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/**
 * ICE configuration, env-driven so a TURN relay can be added without code changes:
 *   NEXT_PUBLIC_STUN_URLS    comma-separated STUN urls (defaults to Google STUN)
 *   NEXT_PUBLIC_TURN_URLS    comma-separated TURN urls (enables TURN when set)
 *   NEXT_PUBLIC_TURN_USERNAME / NEXT_PUBLIC_TURN_CREDENTIAL
 * Without TURN, STUN-only connectivity can fail on symmetric-NAT / locked-down
 * corporate networks. NOTE: NEXT_PUBLIC_* values are baked into the client bundle,
 * so use short-lived (ephemeral) TURN credentials, ideally minted per session by
 * an API endpoint — never long-lived static secrets here.
 */
function buildIceServers(): RTCIceServer[] {
  const split = (v?: string) => v?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const stun = split(process.env.NEXT_PUBLIC_STUN_URLS);
  const servers: RTCIceServer[] = [
    { urls: stun.length ? stun : ['stun:stun.l.google.com:19302'] },
  ];
  const turn = split(process.env.NEXT_PUBLIC_TURN_URLS);
  if (turn.length) {
    servers.push({
      urls: turn,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  } else {
    // No private relay configured — fall back to Metered's free public TURN so
    // huddles still connect through strict/symmetric NATs and firewalls that block
    // peer-to-peer (STUN-only) media. For production, provision a dedicated relay
    // and set NEXT_PUBLIC_TURN_URLS / _USERNAME / _CREDENTIAL to override this.
    servers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  return servers;
}

const ICE: RTCConfiguration = { iceServers: buildIceServers() };

/** Best-effort: raise the screen-share encoding ceiling so a large, high-motion
 *  screen stays sharp and fluid instead of being throttled to a low bitrate.
 *  Not every browser allows setParameters at this point — hence best-effort. */
async function tuneScreenSender(sender: RTCRtpSender): Promise<void> {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = 3_000_000; // ~3 Mbps
    params.encodings[0].maxFramerate = 30;
    await sender.setParameters(params);
  } catch {
    /* contentHint + capture constraints still carry most of the benefit */
  }
}

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
  /** True while the local camera is on. */
  cameraOn: boolean;
  /** Local camera stream for self-view (null when camera off). */
  localVideo: MediaStream | null;
  /** Who is currently speaking, keyed by userId (includes the local user). */
  speaking: Record<string, boolean>;
  /** Aggregate connection health across peers. */
  connectionState: ConnectionState;
  /** My own role in the active huddle. */
  myRole: HuddleRole;
  /** Am I allowed to annotate the shared screen right now? */
  canAnnotate: boolean;
  handRaised: boolean;
  // Collaboration state
  chat: ChatMessage[];
  unreadChat: number;
  reactions: FloatingReaction[];
  annotations: HuddleAnnotationShape[];
  lasers: Record<string, LaserState>;
  poll: LivePoll | null;
  notes: string;
  control: ControlSessionState | null;
  controlRequests: IncomingControlRequest[];
  captions: Record<string, CaptionState>;
  captionsOn: boolean;
  captionsSupported: boolean;
  // ----- room settings / waiting room -----
  settings: HuddleSettings;
  /** My admission status (waiting room). 'admitted' once I'm in the meeting. */
  admitStatus: AdmitStatus;
  /** People waiting to be admitted (populated for moderators only). */
  waitingList: HuddleWaitingEntry[];
  updateSettings: (patch: Partial<HuddleSettings>) => void;
  admit: (userId: string, action: 'admit' | 'deny') => void;
  // ----- whiteboard -----
  whiteboard: HuddleAnnotationShape[];
  sendWhiteboardOp: (op: HuddleWhiteboardOp) => void;
  clearWhiteboard: () => void;
  // ----- breakout rooms -----
  breakoutRooms: BreakoutRoom[];
  breakoutsOpen: boolean;
  breakoutAssignments: Record<string, string>;
  /** The breakout room I'm currently in (null = main room). */
  myBreakoutId: string | null;
  openBreakouts: (count: number, autoAssign: boolean) => void;
  assignBreakout: (userId: string, roomId: string | null) => void;
  closeBreakouts: () => void;
  // ----- background blur -----
  blurEnabled: boolean;
  blurSupported: boolean;
  toggleBlur: () => Promise<void>;
  // ----- push-to-talk -----
  pttEnabled: boolean;
  /** True while the PTT key is held and the mic is live. */
  pttActive: boolean;
  setPttEnabled: (enabled: boolean) => void;
  /** Start (or join) a huddle in the given channel/DM. */
  join: (target: Container) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleCamera: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  toggleHand: () => void;
  sendChat: (text: string, replyTo?: string | null) => void;
  markChatRead: () => void;
  sendReaction: (emoji: string) => void;
  sendAnnotation: (op: HuddleAnnotationOp) => void;
  clearAnnotations: () => void;
  sendLaser: (point: { x: number; y: number } | null) => void;
  requestControl: (presenterId: string) => void;
  respondControl: (requesterId: string, action: 'grant' | 'deny') => void;
  revokeControl: () => void;
  createPoll: (question: string, options: string[]) => void;
  votePoll: (optionIndex: number) => void;
  closePoll: () => void;
  toggleCaptions: () => void;
  updateNotes: (content: string) => void;
  moderate: (targetUserId: string, action: 'mute-request' | 'lower-hand' | 'remove' | 'set-role', role?: HuddleRole) => void;
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
  const [cameraOn, setCameraOn] = useState(false);
  const [localVideo, setLocalVideo] = useState<MediaStream | null>(null);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [connectionState, setConnectionState] = useState<ConnectionState>('connected');
  const [handRaised, setHandRaised] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [annotations, setAnnotations] = useState<HuddleAnnotationShape[]>([]);
  const [lasers, setLasers] = useState<Record<string, LaserState>>({});
  const [poll, setPoll] = useState<LivePoll | null>(null);
  const [notes, setNotes] = useState('');
  const [control, setControl] = useState<ControlSessionState | null>(null);
  const [controlRequests, setControlRequests] = useState<IncomingControlRequest[]>([]);
  const [captions, setCaptions] = useState<Record<string, CaptionState>>({});
  const [captionsOn, setCaptionsOn] = useState(false);
  const captionsOnRef = useRef(false);
  // Room settings / waiting room / whiteboard / breakouts
  const [settings, setSettings] = useState<HuddleSettings>({
    waitingRoomEnabled: false,
    locked: false,
    whiteboardOn: false,
  });
  const [admitStatus, setAdmitStatus] = useState<AdmitStatus>('pending');
  const admitStatusRef = useRef<AdmitStatus>('pending');
  const [waitingList, setWaitingList] = useState<HuddleWaitingEntry[]>([]);
  const [whiteboard, setWhiteboard] = useState<HuddleAnnotationShape[]>([]);
  const [breakoutRooms, setBreakoutRooms] = useState<BreakoutRoom[]>([]);
  const [breakoutsOpen, setBreakoutsOpen] = useState(false);
  const [breakoutAssignments, setBreakoutAssignments] = useState<Record<string, string>>({});
  // Background blur
  const [blurEnabled, setBlurEnabled] = useState(false);
  const blurEnabledRef = useRef(false);
  const blurProcessor = useRef<BackgroundBlurProcessor | null>(null);
  const rawCamTrack = useRef<MediaStreamTrack | null>(null);
  // Push-to-talk
  const [pttEnabled, setPttEnabledState] = useState(false);
  const pttEnabledRef = useRef(false);
  const [pttActive, setPttActive] = useState(false);

  const cameraTrack = useRef<MediaStreamTrack | null>(null);
  const mutedRef = useRef(false);
  const handRaisedRef = useRef(false);
  // Authoritative source map: peerId → the stream ids they report for camera/screen,
  // so incoming video tracks are classified explicitly (not by audio-track presence).
  const mediaMapRef = useRef<Record<string, { cameraStreamId: string | null; screenStreamId: string | null }>>({});
  // Video streams that arrived before their source map — reclassified when it lands.
  const pendingVideo = useRef<Map<string, { peerId: string; stream: MediaStream }>>(new Map());
  // One persistent AudioContext for active-speaker analysis; analysers are added
  // and removed incrementally as peers/streams change (never recreated per change).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<
    Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array<ArrayBuffer> }>
  >(new Map());

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
  // Peers we've already pushed a follow-up screen offer to (late-joiner fix),
  // so we never loop re-offering to the same peer.
  const screenReoffered = useRef<Set<string>>(new Set());
  // Peers whose renegotiation was deferred because signaling wasn't stable; retried
  // on the next 'stable' signalingstatechange so a track change is never dropped.
  const needsRenegotiation = useRef<Set<string>>(new Set());
  // Late-bound ref to renegotiate() so createPeer's signaling handler can call it
  // without a definition-order dependency.
  const renegotiateRef = useRef<((peerId: string) => Promise<void>) | null>(null);
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
      pc.onconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.close();
      peers.current.delete(peerId);
    }
    needsRenegotiation.current.delete(peerId);
    pendingIce.current.delete(peerId);
    screenSenders.current.delete(peerId);
    screenReoffered.current.delete(peerId);
    for (const [streamId, v] of [...pendingVideo.current.entries()])
      if (v.peerId === peerId) pendingVideo.current.delete(streamId);
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

  // Remove a remote screen tile only if it still matches the given stream id, so a
  // track that ended after being replaced doesn't clear a newer share.
  const removeRemoteScreen = useCallback((peerId: string, streamId: string) => {
    setRemoteScreens((s) => {
      if (s[peerId]?.id !== streamId) return s;
      const next = { ...s };
      delete next[peerId];
      return next;
    });
    pendingVideo.current.delete(streamId);
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
        const sender = pc.addTrack(screenTrack, screenStream.current!);
        screenSenders.current.set(peerId, sender);
        void tuneScreenSender(sender);
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(peerId, { kind: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        // Never leave a frozen last frame up indefinitely (§22): when the peer
        // connection fails, drop its remote screen. Participant reconciliation
        // then finishes the cleanup; a clean leave already clears it via closePeer.
        if (pc.connectionState === 'failed') {
          setRemoteScreens((s) => {
            if (!(peerId in s)) return s;
            const next = { ...s };
            delete next[peerId];
            return next;
          });
        }
      };
      pc.onsignalingstatechange = () => {
        // Retry a renegotiation that was deferred while a prior offer was in flight
        // (rapid camera+screen toggles), so track changes are never silently lost.
        if (pc.signalingState === 'stable' && needsRenegotiation.current.has(peerId)) {
          needsRenegotiation.current.delete(peerId);
          void renegotiateRef.current?.(peerId);
        }
      };
      pc.ontrack = (e) => {
        const [stream] = e.streams;
        if (!stream) return;
        if (e.track.kind === 'audio') {
          // Screen shares may include tab/system audio; route that with the screen
          // stream (played by the screen tile) rather than overwriting the mic A/V.
          if (mediaMapRef.current[peerId]?.screenStreamId === stream.id) {
            setRemoteScreens((s) => ({ ...s, [peerId]: stream }));
          } else {
            setRemoteStreams((s) => ({ ...s, [peerId]: stream }));
          }
          return;
        }
        // Video: classify by the sender's reported source map (authoritative).
        const map = mediaMapRef.current[peerId];
        if (map?.screenStreamId === stream.id) {
          setRemoteScreens((s) => ({ ...s, [peerId]: stream }));
          e.track.addEventListener('ended', () => removeRemoteScreen(peerId, stream.id));
        } else if (map?.cameraStreamId === stream.id) {
          setRemoteStreams((s) => ({ ...s, [peerId]: stream }));
        } else {
          // Source map hasn't arrived yet — buffer and place optimistically
          // (audio-less video ≈ screen); the map reclassifies it authoritatively.
          pendingVideo.current.set(stream.id, { peerId, stream });
          if (stream.getAudioTracks().length === 0) {
            setRemoteScreens((s) => ({ ...s, [peerId]: stream }));
            e.track.addEventListener('ended', () => removeRemoteScreen(peerId, stream.id));
          } else {
            setRemoteStreams((s) => ({ ...s, [peerId]: stream }));
          }
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
    [sendSignal, removeRemoteScreen],
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
          // Late-joiner fix: if we're already sharing our screen when this peer's
          // first offer arrives, createPeer added our screen track — but an
          // *answer* can't introduce a new sending m-line, so the peer would
          // never receive the screen. Push one follow-up offer (we're in 'stable'
          // right after answering). Guarded so it happens at most once per peer.
          if (
            (screenStream.current || cameraTrack.current) &&
            !screenReoffered.current.has(fromUserId)
          ) {
            screenReoffered.current.add(fromUserId);
            try {
              const reoffer = await pc.createOffer();
              await pc.setLocalDescription(reoffer);
              sendSignal(fromUserId, { kind: 'sdp', description: pc.localDescription!.toJSON() });
            } catch {
              // Screen will still reach them on the sharer's next toggle.
              screenReoffered.current.delete(fromUserId);
            }
          }
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
    // On socket reconnect, the server dropped our previous socket from the huddle.
    // Rebuild the mesh cleanly and re-announce presence + media state so we don't
    // silently fall out of the meeting after a network blip (§21 resilience).
    const onReconnect = () => {
      const target = activeTargetRef.current;
      if (!joinedRef.current || !target || admitStatusRef.current === 'denied') return;
      for (const peerId of [...peers.current.keys()]) closePeer(peerId);
      pendingIce.current.clear();
      screenReoffered.current.clear();
      needsRenegotiation.current.clear();
      const body = bodyFor(target);
      socket.emit(CLIENT_EVENTS.HUDDLE_JOIN, body);
      socket.emit(CLIENT_EVENTS.HUDDLE_STATE, {
        ...body,
        audioEnabled: !mutedRef.current,
        videoEnabled: !!cameraTrack.current,
        screenSharing: !!screenStream.current,
        handRaised: handRaisedRef.current,
        cameraStreamId: cameraTrack.current ? (localStream.current?.id ?? null) : null,
        screenStreamId: screenStream.current?.id ?? null,
      });
    };
    socket.on(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
    socket.on(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off(SOCKET_EVENTS.HUDDLE_PARTICIPANTS, onParticipants);
      socket.off(SOCKET_EVENTS.HUDDLE_SIGNAL, onSignal);
      socket.io.off('reconnect', onReconnect);
    };
  }, [me, handleSignal, closePeer, bodyFor]);

  const participants = useMemo(
    () => (activeTarget ? (participantsByContainer[activeTarget.id] ?? []) : []),
    [activeTarget, participantsByContainer],
  );

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    handRaisedRef.current = handRaised;
  }, [handRaised]);
  useEffect(() => {
    admitStatusRef.current = admitStatus;
  }, [admitStatus]);

  // Keep the authoritative source map in sync with server state and reclassify any
  // video streams that arrived before their map (or were placed optimistically).
  useEffect(() => {
    const map: Record<string, { cameraStreamId: string | null; screenStreamId: string | null }> = {};
    for (const p of participants) {
      map[p.userId] = { cameraStreamId: p.cameraStreamId ?? null, screenStreamId: p.screenStreamId ?? null };
    }
    mediaMapRef.current = map;
    for (const [streamId, { peerId, stream }] of [...pendingVideo.current.entries()]) {
      const m = map[peerId];
      if (!m) continue;
      if (m.screenStreamId === streamId) {
        setRemoteScreens((s) => ({ ...s, [peerId]: stream }));
        // If it was optimistically filed as this peer's A/V, drop that.
        setRemoteStreams((s) => (s[peerId]?.id === streamId ? (() => { const n = { ...s }; delete n[peerId]; return n; })() : s));
        pendingVideo.current.delete(streamId);
      } else if (m.cameraStreamId === streamId) {
        setRemoteStreams((s) => ({ ...s, [peerId]: stream }));
        // If it was optimistically filed as a screen, drop that.
        setRemoteScreens((s) => (s[peerId]?.id === streamId ? (() => { const n = { ...s }; delete n[peerId]; return n; })() : s));
        pendingVideo.current.delete(streamId);
      }
    }
  }, [participants]);

  const me_ = participants.find((p) => p.userId === myId);
  const myRole: HuddleRole = me_?.role ?? 'participant';
  const canAnnotate = me_?.canAnnotate ?? true;

  const myBreakoutId = me_?.breakoutId ?? null;

  // Reconcile the mesh whenever the active huddle's participant set changes.
  // Peers are only connected within the SAME breakout group, so each breakout is
  // an isolated audio/video space. While waiting to be admitted we build nothing.
  useEffect(() => {
    if (!joinedRef.current || admitStatus !== 'admitted') return;
    const sameGroup = (p: HuddleParticipant) => (p.breakoutId ?? null) === myBreakoutId;
    for (const p of participants) {
      if (p.userId === myId) continue;
      if (sameGroup(p)) {
        if (!peers.current.has(p.userId) && myId < p.userId) createPeer(p.userId, true);
      } else if (peers.current.has(p.userId)) {
        closePeer(p.userId); // moved to another breakout — drop the connection
      }
    }
    for (const peerId of [...peers.current.keys()]) {
      const stillHere = participants.some((p) => p.userId === peerId && sameGroup(p));
      if (!stillHere) closePeer(peerId);
    }
  }, [participants, myId, myBreakoutId, admitStatus, createPeer, closePeer]);

  // Screen/camera renegotiation is always driven by the sharer, so peers only
  // ever answer (the existing offer→answer path). Guard against a negotiation
  // already in flight (rapid camera+screen toggling) so we never call
  // setLocalDescription in a non-stable state, and swallow transient errors so a
  // failed renegotiation can't become an unhandled rejection.
  const renegotiate = useCallback(
    async (peerId: string) => {
      const pc = peers.current.get(peerId);
      if (!pc) return;
      if (pc.signalingState !== 'stable') {
        // A negotiation is already in flight; retry when it settles (see
        // onsignalingstatechange) so this track change isn't dropped.
        needsRenegotiation.current.add(peerId);
        return;
      }
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') {
          needsRenegotiation.current.add(peerId);
          return;
        }
        await pc.setLocalDescription(offer);
        sendSignal(peerId, { kind: 'sdp', description: pc.localDescription!.toJSON() });
      } catch {
        needsRenegotiation.current.add(peerId);
      }
    },
    [sendSignal],
  );
  renegotiateRef.current = renegotiate;

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
    screenReoffered.current.clear();
    stream.getTracks().forEach((t) => t.stop());
    screenStream.current = null;
    setLocalScreen(null);
    setScreenSharing(false);
    const target = activeTargetRef.current;
    if (target)
      getSocket().emit(CLIENT_EVENTS.HUDDLE_STATE, { ...bodyFor(target), screenSharing: false, screenStreamId: null });
  }, [renegotiate, bodyFor]);

  const startScreenShare = useCallback(async () => {
    if (!joinedRef.current || screenStream.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // Ask for a real frame rate — without this Chrome throttles screen
        // capture to a few fps to favour resolution, which reads as a static
        // image the moment anything moves (mouse, scroll, video).
        video: { frameRate: { ideal: 30, max: 60 } },
        // Offer to share tab/system audio (the browser shows a checkbox). Screen
        // audio is classified explicitly by stream id, so it never disturbs the
        // camera/mic classification.
        audio: true,
      });
    } catch {
      return; // user dismissed the picker
    }
    screenStream.current = stream;
    setLocalScreen(stream);
    setScreenSharing(true);
    const track = stream.getVideoTracks()[0];
    // Hint the encoder that this is motion content (cursor, scrolling, video),
    // so it trades a little sharpness for fluidity instead of freezing on detail.
    track.contentHint = 'motion';
    // Ending the share from the browser's own "Stop sharing" bar cleans up too.
    track.addEventListener('ended', () => stopScreenShare());
    for (const [peerId, pc] of peers.current) {
      const sender = pc.addTrack(track, stream);
      screenSenders.current.set(peerId, sender);
      void tuneScreenSender(sender);
      await renegotiate(peerId);
    }
    const target = activeTargetRef.current;
    if (target)
      getSocket().emit(CLIENT_EVENTS.HUDDLE_STATE, {
        ...bodyFor(target),
        screenSharing: true,
        screenStreamId: stream.id,
      });
  }, [renegotiate, stopScreenShare, bodyFor]);

  // Tear down the mesh + local media without touching the active-target React
  // state, so it can be called from `join` (switching huddles) and from `leave`.
  const leaveInternal = useCallback(() => {
    const target = activeTargetRef.current;
    if (target) getSocket().emit(CLIENT_EVENTS.HUDDLE_LEAVE, bodyFor(target));
    stopScreenShare();
    cameraTrack.current?.stop();
    cameraTrack.current = null;
    for (const peerId of [...peers.current.keys()]) closePeer(peerId);
    pendingIce.current.clear();
    pendingVideo.current.clear();
    mediaMapRef.current = {};
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    joinedRef.current = false;
    activeTargetRef.current = null;
    setRemoteStreams({});
    setRemoteScreens({});
    setCameraOn(false);
    setLocalVideo(null);
    setSpeaking({});
    setHandRaised(false);
    setChat([]);
    setUnreadChat(0);
    setReactions([]);
    setAnnotations([]);
    setLasers({});
    setPoll(null);
    setNotes('');
    setControl(null);
    setControlRequests([]);
    setConnectionState('connected');
    setCaptions({});
    setCaptionsOn(false);
    captionsOnRef.current = false;
    setAdmitStatus('pending');
    admitStatusRef.current = 'pending';
    setWaitingList([]);
    setWhiteboard([]);
    setBreakoutRooms([]);
    setBreakoutsOpen(false);
    setBreakoutAssignments({});
    setSettings({ waitingRoomEnabled: false, locked: false, whiteboardOn: false });
    // Tear down the blur pipeline; the raw device track is stopped with the mesh.
    blurProcessor.current?.stop();
    blurProcessor.current = null;
    rawCamTrack.current = null;
    setPttActive(false);
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
        setAdmitStatus('pending');
        admitStatusRef.current = 'pending';
        // Push-to-talk starts muted (hold the key to speak); otherwise live.
        const startMuted = pttEnabledRef.current;
        stream.getAudioTracks().forEach((t) => (t.enabled = !startMuted));
        setMuted(startMuted);
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

  // Emit a client→server event scoped to the active huddle. Used for every
  // meeting-state and collaboration channel so membership is enforced serverside.
  const emit = useCallback(
    (event: string, extra: Record<string, unknown> = {}) => {
      const target = activeTargetRef.current;
      if (!target || !joinedRef.current) return;
      getSocket().emit(event, { ...bodyFor(target), ...extra });
    },
    [bodyFor],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      localStream.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      emit(CLIENT_EVENTS.HUDDLE_STATE, { audioEnabled: !next });
      return next;
    });
  }, [emit]);

  const toggleCamera = useCallback(async () => {
    if (!joinedRef.current) return;
    const existing = cameraTrack.current;
    if (existing) {
      // Turn the camera off: stop the track and drop it from every peer.
      for (const [peerId, pc] of peers.current) {
        const sender = pc.getSenders().find((s) => s.track === existing);
        if (sender) {
          try {
            pc.removeTrack(sender);
          } catch {
            /* peer gone */
          }
          void renegotiate(peerId);
        }
      }
      existing.stop();
      // Also tear down the blur pipeline and the underlying raw device track.
      rawCamTrack.current?.stop();
      rawCamTrack.current = null;
      blurProcessor.current?.stop();
      blurProcessor.current = null;
      localStream.current?.removeTrack(existing);
      cameraTrack.current = null;
      setCameraOn(false);
      setLocalVideo(null);
      emit(CLIENT_EVENTS.HUDDLE_STATE, { videoEnabled: false, cameraStreamId: null });
      return;
    }
    let cam: MediaStream;
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    } catch {
      useUiStore.getState().pushToast('Camera unavailable. Check browser permissions.', 'error');
      return;
    }
    const rawTrack = cam.getVideoTracks()[0];
    rawCamTrack.current = rawTrack;
    // If background blur is on, run the raw camera through the segmentation
    // pipeline and send the processed track instead (falls back to raw on error).
    let sentTrack = rawTrack;
    if (blurEnabledRef.current) {
      try {
        const proc = new BackgroundBlurProcessor();
        sentTrack = await proc.start(rawTrack);
        blurProcessor.current = proc;
      } catch {
        useUiStore.getState().pushToast('Background blur is unavailable; using your normal camera.', 'error');
        setBlurEnabled(false);
        blurEnabledRef.current = false;
      }
    }
    cameraTrack.current = sentTrack;
    // Put the sent track into the A/V stream so remote peers can tell it apart
    // from the (audio-less) screen share.
    localStream.current?.addTrack(sentTrack);
    setLocalVideo(new MediaStream([sentTrack]));
    setCameraOn(true);
    // The raw device track is the one that 'ends' on unplug/revoke.
    rawTrack.addEventListener('ended', () => {
      cameraTrack.current = null;
      rawCamTrack.current = null;
      blurProcessor.current?.stop();
      blurProcessor.current = null;
      setCameraOn(false);
      setLocalVideo(null);
      emit(CLIENT_EVENTS.HUDDLE_STATE, { videoEnabled: false, cameraStreamId: null });
    });
    for (const [peerId, pc] of peers.current) {
      pc.addTrack(sentTrack, localStream.current!);
      await renegotiate(peerId);
    }
    emit(CLIENT_EVENTS.HUDDLE_STATE, { videoEnabled: true, cameraStreamId: localStream.current?.id ?? null });
  }, [renegotiate, emit]);

  /** Toggle background blur. When the camera is live, swap the outgoing track in
   *  place (replaceTrack keeps the transceiver, so no renegotiation is needed). */
  const toggleBlur = useCallback(async () => {
    const next = !blurEnabledRef.current;
    blurEnabledRef.current = next;
    setBlurEnabled(next);
    const raw = rawCamTrack.current;
    if (!cameraOn || !raw) return; // applies when the camera is next turned on
    try {
      let newSent: MediaStreamTrack;
      if (next) {
        const proc = new BackgroundBlurProcessor();
        newSent = await proc.start(raw);
        blurProcessor.current = proc;
      } else {
        blurProcessor.current?.stop();
        blurProcessor.current = null;
        newSent = raw;
      }
      const old = cameraTrack.current;
      for (const [, pc] of peers.current) {
        const sender = pc.getSenders().find((s) => s.track === old);
        if (sender) await sender.replaceTrack(newSent);
      }
      if (old && old !== raw) {
        localStream.current?.removeTrack(old);
        old.stop();
      }
      if (!localStream.current?.getVideoTracks().includes(newSent)) {
        localStream.current?.addTrack(newSent);
      }
      cameraTrack.current = newSent;
      setLocalVideo(new MediaStream([newSent]));
    } catch {
      useUiStore.getState().pushToast('Background blur is unavailable on this device.', 'error');
      blurEnabledRef.current = false;
      setBlurEnabled(false);
    }
  }, [cameraOn]);

  const toggleHand = useCallback(() => {
    setHandRaised((h) => {
      const next = !h;
      emit(CLIENT_EVENTS.HUDDLE_STATE, { handRaised: next });
      return next;
    });
  }, [emit]);

  const sendChat = useCallback(
    (text: string, replyTo: string | null = null) => {
      const t = text.trim();
      if (t) emit(CLIENT_EVENTS.HUDDLE_CHAT, { text: t, replyTo });
    },
    [emit],
  );
  const markChatRead = useCallback(() => setUnreadChat(0), []);

  const sendReaction = useCallback(
    (emoji: string) => emit(CLIENT_EVENTS.HUDDLE_REACTION, { emoji }),
    [emit],
  );

  const toggleCaptions = useCallback(() => {
    setCaptionsOn((v) => {
      captionsOnRef.current = !v;
      return !v;
    });
  }, []);

  const sendAnnotation = useCallback(
    (op: HuddleAnnotationOp) => emit(CLIENT_EVENTS.HUDDLE_ANNOTATION, { op }),
    [emit],
  );
  const clearAnnotations = useCallback(
    () => emit(CLIENT_EVENTS.HUDDLE_ANNOTATION, { op: { kind: 'clear' } }),
    [emit],
  );

  // Laser is high-frequency; the caller throttles. We just relay.
  const sendLaser = useCallback(
    (point: { x: number; y: number } | null) => emit(CLIENT_EVENTS.HUDDLE_LASER, { point }),
    [emit],
  );

  const requestControl = useCallback(
    (presenterId: string) => emit(CLIENT_EVENTS.HUDDLE_CONTROL, { action: 'request', targetUserId: presenterId }),
    [emit],
  );
  const respondControl = useCallback(
    (requesterId: string, action: 'grant' | 'deny') =>
      emit(CLIENT_EVENTS.HUDDLE_CONTROL, { action, targetUserId: requesterId }),
    [emit],
  );
  const revokeControl = useCallback(() => {
    const c = control;
    if (c) emit(CLIENT_EVENTS.HUDDLE_CONTROL, { action: 'revoke', targetUserId: c.controllerId });
  }, [emit, control]);

  const createPoll = useCallback(
    (question: string, options: string[]) =>
      emit(CLIENT_EVENTS.HUDDLE_POLL, { action: 'create', question, options }),
    [emit],
  );
  const votePoll = useCallback(
    (optionIndex: number) => {
      if (poll) emit(CLIENT_EVENTS.HUDDLE_POLL, { action: 'vote', pollId: poll.id, optionIndex });
    },
    [emit, poll],
  );
  const closePoll = useCallback(() => {
    if (poll) emit(CLIENT_EVENTS.HUDDLE_POLL, { action: 'close', pollId: poll.id });
  }, [emit, poll]);

  const updateNotes = useCallback(
    (content: string) => emit(CLIENT_EVENTS.HUDDLE_NOTES, { content }),
    [emit],
  );

  const moderate = useCallback(
    (
      targetUserId: string,
      action: 'mute-request' | 'lower-hand' | 'remove' | 'set-role',
      role?: HuddleRole,
    ) => emit(CLIENT_EVENTS.HUDDLE_MODERATION, { targetUserId, action, role }),
    [emit],
  );

  // ----- room settings / waiting room -----
  const updateSettings = useCallback(
    (patch: Partial<HuddleSettings>) => emit(CLIENT_EVENTS.HUDDLE_SETTINGS, patch),
    [emit],
  );
  const admit = useCallback(
    (userId: string, action: 'admit' | 'deny') =>
      emit(CLIENT_EVENTS.HUDDLE_ADMIT, { targetUserId: userId, action }),
    [emit],
  );

  // ----- whiteboard -----
  const sendWhiteboardOp = useCallback(
    (op: HuddleWhiteboardOp) => emit(CLIENT_EVENTS.HUDDLE_WHITEBOARD, { op }),
    [emit],
  );
  const clearWhiteboard = useCallback(
    () => emit(CLIENT_EVENTS.HUDDLE_WHITEBOARD, { op: { kind: 'clear' } }),
    [emit],
  );

  // ----- breakout rooms -----
  const openBreakouts = useCallback(
    (count: number, autoAssign: boolean) =>
      emit(CLIENT_EVENTS.HUDDLE_BREAKOUT, { action: 'open', count, autoAssign }),
    [emit],
  );
  const assignBreakout = useCallback(
    (userId: string, roomId: string | null) =>
      emit(CLIENT_EVENTS.HUDDLE_BREAKOUT, { action: 'assign', targetUserId: userId, roomId }),
    [emit],
  );
  const closeBreakouts = useCallback(() => emit(CLIENT_EVENTS.HUDDLE_BREAKOUT, { action: 'close' }), [emit]);

  // ----- push-to-talk -----
  const setPttEnabled = useCallback(
    (enabled: boolean) => {
      pttEnabledRef.current = enabled;
      setPttEnabledState(enabled);
      // Entering PTT mode mutes until the key is held; leaving it stays as-is.
      if (enabled) {
        localStream.current?.getAudioTracks().forEach((t) => (t.enabled = false));
        setMuted(true);
        setPttActive(false);
        emit(CLIENT_EVENTS.HUDDLE_STATE, { audioEnabled: false });
      }
    },
    [emit],
  );

  // ---- collaboration listeners (chat / reactions / annotation / laser /
  //      control / poll / notes / moderation), all scoped to the active huddle ----
  useEffect(() => {
    if (!me) return;
    const socket = getSocket();
    const my = me.id;
    const forActive = (p: { channelId?: string; conversationId?: string }) => {
      const target = activeTargetRef.current;
      const containerId = p.channelId ?? p.conversationId;
      return !!target && joinedRef.current && containerId === target.id;
    };
    const toast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') =>
      useUiStore.getState().pushToast(msg, kind);

    const onChat = (p: HuddleChatPayload) => {
      if (!forActive(p)) return;
      setChat((c) => [
        ...c.slice(-199),
        {
          id: p.id,
          userId: p.userId,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          text: p.text,
          replyTo: p.replyTo ?? null,
          createdAt: p.createdAt,
        },
      ]);
      if (p.userId !== my) setUnreadChat((n) => n + 1);
    };
    const onReaction = (p: HuddleReactionPayload) => {
      if (!forActive(p)) return;
      const r = { id: p.id, userId: p.userId, displayName: p.displayName, emoji: p.emoji };
      setReactions((s) => [...s, r]);
      setTimeout(() => setReactions((s) => s.filter((x) => x.id !== r.id)), 4000);
    };
    const onAnnotation = (p: HuddleAnnotationPayload) => {
      if (!forActive(p)) return;
      const op = p.op;
      if (op.kind === 'clear') setAnnotations([]);
      else if (op.kind === 'sync') setAnnotations(op.shapes);
      else if (op.kind === 'create')
        // Idempotent: a re-broadcast create must not duplicate the shape.
        setAnnotations((s) => (s.some((x) => x.id === op.shape.id) ? s.map((x) => (x.id === op.shape.id ? op.shape : x)) : [...s, op.shape]));
      else if (op.kind === 'update')
        setAnnotations((s) => s.map((sh) => (sh.id === op.shape.id ? op.shape : sh)));
      else if (op.kind === 'delete') setAnnotations((s) => s.filter((sh) => sh.id !== op.id));
    };
    const onLaser = (p: HuddleLaserPayload) => {
      if (!forActive(p)) return;
      setLasers((s) => {
        if (!p.point) {
          if (!(p.userId in s)) return s;
          const n = { ...s };
          delete n[p.userId];
          return n;
        }
        return { ...s, [p.userId]: { userId: p.userId, displayName: p.displayName, point: p.point, at: Date.now() } };
      });
    };
    const onControl = (p: HuddleControlPayload) => {
      if (!forActive(p)) return;
      if (p.action === 'request') {
        if (p.presenterId === my)
          setControlRequests((s) =>
            s.some((r) => r.requesterId === p.requesterId)
              ? s
              : [...s, { requesterId: p.requesterId, requesterName: p.requesterName }],
          );
      } else if (p.action === 'cancel') {
        setControlRequests((s) => s.filter((r) => r.requesterId !== p.requesterId));
      } else if (p.action === 'grant') {
        setControl({ controllerId: p.requesterId, presenterId: p.presenterId });
        setControlRequests((s) => s.filter((r) => r.requesterId !== p.requesterId));
        if (p.requesterId === my) toast('You can now draw and point on the shared screen.', 'success');
      } else if (p.action === 'deny') {
        if (p.requesterId === my) toast('Your control request was declined.', 'info');
        setControlRequests((s) => s.filter((r) => r.requesterId !== p.requesterId));
      } else if (p.action === 'revoke') {
        setControl(null);
        setControlRequests((s) => s.filter((r) => r.requesterId !== p.requesterId));
      }
    };
    const onPoll = (p: HuddlePollPayload) => {
      if (!forActive(p)) return;
      setPoll(p.poll);
    };
    const onNotes = (p: HuddleNotesPayload) => {
      if (!forActive(p)) return;
      if (p.updatedBy !== my) setNotes(p.content);
    };
    const onCaption = (p: HuddleCaptionPayload) => {
      if (!forActive(p)) return;
      setCaptions((s) => ({
        ...s,
        [p.userId]: { userId: p.userId, displayName: p.displayName, text: p.text, final: p.final, at: Date.now() },
      }));
    };
    const onModeration = (p: HuddleModerationPayload) => {
      if (!forActive(p) || p.targetUserId !== my) return;
      if (p.action === 'mute-request') {
        localStream.current?.getAudioTracks().forEach((t) => (t.enabled = false));
        setMuted(true);
        emit(CLIENT_EVENTS.HUDDLE_STATE, { audioEnabled: false });
        toast('A host asked you to mute.', 'info');
      } else if (p.action === 'remove') {
        toast('You were removed from the huddle.', 'info');
        leaveInternal();
        setActiveTarget(null);
        setJoined(false);
      }
    };

    socket.on(SOCKET_EVENTS.HUDDLE_CHAT, onChat);
    socket.on(SOCKET_EVENTS.HUDDLE_REACTION, onReaction);
    socket.on(SOCKET_EVENTS.HUDDLE_ANNOTATION, onAnnotation);
    socket.on(SOCKET_EVENTS.HUDDLE_LASER, onLaser);
    socket.on(SOCKET_EVENTS.HUDDLE_CONTROL, onControl);
    socket.on(SOCKET_EVENTS.HUDDLE_POLL, onPoll);
    socket.on(SOCKET_EVENTS.HUDDLE_NOTES, onNotes);
    socket.on(SOCKET_EVENTS.HUDDLE_MODERATION, onModeration);
    socket.on(SOCKET_EVENTS.HUDDLE_CAPTION, onCaption);
    return () => {
      socket.off(SOCKET_EVENTS.HUDDLE_CHAT, onChat);
      socket.off(SOCKET_EVENTS.HUDDLE_REACTION, onReaction);
      socket.off(SOCKET_EVENTS.HUDDLE_ANNOTATION, onAnnotation);
      socket.off(SOCKET_EVENTS.HUDDLE_LASER, onLaser);
      socket.off(SOCKET_EVENTS.HUDDLE_CONTROL, onControl);
      socket.off(SOCKET_EVENTS.HUDDLE_POLL, onPoll);
      socket.off(SOCKET_EVENTS.HUDDLE_NOTES, onNotes);
      socket.off(SOCKET_EVENTS.HUDDLE_MODERATION, onModeration);
      socket.off(SOCKET_EVENTS.HUDDLE_CAPTION, onCaption);
    };
  }, [me, emit, leaveInternal]);

  // ---- settings / waiting room / whiteboard / breakout listeners ----
  useEffect(() => {
    if (!me) return;
    const socket = getSocket();
    const forActive = (p: { channelId?: string; conversationId?: string }) => {
      const target = activeTargetRef.current;
      const containerId = p.channelId ?? p.conversationId;
      return !!target && joinedRef.current && containerId === target.id;
    };

    const onSettings = (p: HuddleSettingsPayload) => {
      if (!forActive(p)) return;
      setSettings({ waitingRoomEnabled: p.waitingRoomEnabled, locked: p.locked, whiteboardOn: p.whiteboardOn });
    };
    const onWaiting = (p: HuddleWaitingPayload) => {
      if (!forActive(p)) return;
      if (p.status) {
        // A personal admission update (waiting / admitted / denied).
        setAdmitStatus(p.status);
        admitStatusRef.current = p.status;
        if (p.status === 'denied') {
          useUiStore.getState().pushToast('The host did not admit you to the huddle.', 'info');
        }
      } else {
        // The moderator's live pending list.
        setWaitingList(p.waiting);
      }
    };
    const onWhiteboard = (p: HuddleWhiteboardPayload) => {
      if (!forActive(p)) return;
      const op = p.op;
      if (op.kind === 'sync') setWhiteboard(op.shapes);
      else if (op.kind === 'clear') setWhiteboard([]);
      else if (op.kind === 'create') setWhiteboard((s) => [...s, op.shape]);
      else if (op.kind === 'update')
        setWhiteboard((s) => s.map((sh) => (sh.id === op.shape.id ? op.shape : sh)));
      else if (op.kind === 'delete') setWhiteboard((s) => s.filter((sh) => sh.id !== op.id));
    };
    const onBreakout = (p: HuddleBreakoutPayload) => {
      if (!forActive(p)) return;
      setBreakoutsOpen(p.open);
      setBreakoutRooms(p.rooms);
      setBreakoutAssignments(p.assignments);
    };

    socket.on(SOCKET_EVENTS.HUDDLE_SETTINGS, onSettings);
    socket.on(SOCKET_EVENTS.HUDDLE_WAITING, onWaiting);
    socket.on(SOCKET_EVENTS.HUDDLE_WHITEBOARD, onWhiteboard);
    socket.on(SOCKET_EVENTS.HUDDLE_BREAKOUT, onBreakout);
    return () => {
      socket.off(SOCKET_EVENTS.HUDDLE_SETTINGS, onSettings);
      socket.off(SOCKET_EVENTS.HUDDLE_WAITING, onWaiting);
      socket.off(SOCKET_EVENTS.HUDDLE_WHITEBOARD, onWhiteboard);
      socket.off(SOCKET_EVENTS.HUDDLE_BREAKOUT, onBreakout);
    };
  }, [me]);

  // ---- push-to-talk: hold Space (or the PTT key) to speak while in PTT mode ----
  useEffect(() => {
    if (!joined || !pttEnabled) return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const talk = (on: boolean) => {
      localStream.current?.getAudioTracks().forEach((t) => (t.enabled = on));
      setPttActive(on);
      setMuted(!on);
      emit(CLIENT_EVENTS.HUDDLE_STATE, { audioEnabled: on });
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping()) return;
      e.preventDefault();
      talk(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      talk(false);
    };
    // Releasing focus/blur must also drop the mic so it isn't left hot.
    const blur = () => talk(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [joined, pttEnabled, emit]);

  // ---- active-speaker detection via WebAudio (throttled, audio-activity based) ----
  // One AudioContext + rAF loop for the life of the huddle; the loop reads from a
  // ref-backed analyser map so it never re-subscribes on media changes.
  useEffect(() => {
    if (!joined) return;
    const AC: typeof AudioContext | undefined =
      (window.AudioContext as typeof AudioContext | undefined) ??
      ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    // Autoplay policy can create the context suspended; resume so the analyser runs.
    void ctx.resume().catch(() => undefined);
    audioCtxRef.current = ctx;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 150) return; // ~7Hz, not per-frame
      last = t;
      const next: Record<string, boolean> = {};
      for (const [userId, a] of analysersRef.current) {
        a.analyser.getByteFrequencyData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) sum += a.data[i];
        const avg = sum / a.data.length;
        const activeLocal = userId === myId ? !mutedRef.current : true; // local counts only when unmuted
        next[userId] = avg > 18 && activeLocal;
      }
      setSpeaking((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of keys) if ((prev[k] ?? false) !== (next[k] ?? false)) return next;
        return prev;
      });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      for (const [, a] of analysersRef.current) {
        try {
          a.source.disconnect();
        } catch {
          /* already gone */
        }
      }
      analysersRef.current.clear();
      void ctx.close();
      audioCtxRef.current = null;
    };
  }, [joined, myId]);

  // Incrementally add/remove analysers as the local + remote A/V streams change,
  // reusing the persistent AudioContext (no context churn on join/leave/camera).
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!joined || !ctx) return;
    const want = new Map<string, MediaStream>();
    if (localStream.current) want.set(myId, localStream.current);
    for (const [peerId, stream] of Object.entries(remoteStreams)) want.set(peerId, stream);
    for (const [userId, a] of [...analysersRef.current]) {
      if (!want.has(userId)) {
        try {
          a.source.disconnect();
        } catch {
          /* already gone */
        }
        analysersRef.current.delete(userId);
      }
    }
    for (const [userId, stream] of want) {
      if (analysersRef.current.has(userId) || stream.getAudioTracks().length === 0) continue;
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analysersRef.current.set(userId, {
          analyser,
          source,
          data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
        });
      } catch {
        /* stream not analysable */
      }
    }
  }, [joined, remoteStreams, myId]);

  // ---- aggregate connection health across peers ----
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(() => {
      const states = [...peers.current.values()].map((pc) => pc.connectionState);
      let next: ConnectionState = 'connected';
      if (states.some((s) => s === 'failed')) next = 'unstable';
      else if (states.some((s) => s === 'connecting' || s === 'disconnected')) next = 'reconnecting';
      setConnectionState((prev) => (prev === next ? prev : next));
    }, 2000);
    return () => clearInterval(id);
  }, [joined]);

  // ---- live captions: transcribe the local mic and relay lines to the room ----
  const captionsSupported =
    typeof window !== 'undefined' &&
    !!(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );

  useEffect(() => {
    if (!joined || !captionsOn) return;
    const SR = (
      window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
    ).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    let stopped = false;
    let lastInterim = 0;
    rec.onresult = (e: SpeechRecognitionEventLike) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final.trim()) emit(CLIENT_EVENTS.HUDDLE_CAPTION, { text: final.trim(), final: true });
      else if (interim.trim()) {
        const now = performance.now();
        if (now - lastInterim > 400) {
          lastInterim = now;
          emit(CLIENT_EVENTS.HUDDLE_CAPTION, { text: interim.trim(), final: false });
        }
      }
    };
    rec.onend = () => {
      // The API auto-stops periodically; restart while captions are still on.
      if (!stopped && captionsOnRef.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    rec.onerror = () => undefined;
    try {
      rec.start();
    } catch {
      /* start throws if already running */
    }
    return () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* not running */
      }
    };
  }, [joined, captionsOn, emit]);

  // Expire stale caption lines so the overlay doesn't linger.
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(() => {
      setCaptions((s) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, CaptionState> = {};
        for (const [k, v] of Object.entries(s)) {
          if (now - v.at < (v.final ? 6000 : 4000)) next[k] = v;
          else changed = true;
        }
        return changed ? next : s;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [joined]);

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
    cameraOn,
    localVideo,
    speaking,
    connectionState,
    myRole,
    canAnnotate,
    handRaised,
    chat,
    unreadChat,
    reactions,
    annotations,
    lasers,
    poll,
    notes,
    control,
    controlRequests,
    captions,
    captionsOn,
    captionsSupported,
    settings,
    admitStatus,
    waitingList,
    updateSettings,
    admit,
    whiteboard,
    sendWhiteboardOp,
    clearWhiteboard,
    breakoutRooms,
    breakoutsOpen,
    breakoutAssignments,
    myBreakoutId,
    openBreakouts,
    assignBreakout,
    closeBreakouts,
    blurEnabled,
    blurSupported: backgroundBlurSupported(),
    toggleBlur,
    pttEnabled,
    pttActive,
    setPttEnabled,
    join,
    leave,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    toggleHand,
    sendChat,
    markChatRead,
    sendReaction,
    sendAnnotation,
    clearAnnotations,
    sendLaser,
    requestControl,
    respondControl,
    revokeControl,
    createPoll,
    votePoll,
    closePoll,
    toggleCaptions,
    updateNotes,
    moderate,
  };
}
