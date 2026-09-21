import type { UserDto } from './schemas/auth';
import type { MessageDto, ReactionGroupDto } from './schemas/message';

/** Every realtime event name — the single source of truth for both apps. */
export const SOCKET_EVENTS = {
  /** Emitted once per connection after the server has joined all rooms — clients
   * must wait for this (not 'connect') before relying on broadcasts. */
  READY: 'ready',
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  REACTION_ADDED: 'reaction:added',
  REACTION_REMOVED: 'reaction:removed',
  THREAD_REPLY: 'thread:reply',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  PRESENCE_CHANGED: 'presence:changed',
  NOTIFICATION_NEW: 'notification:new',
  UNREAD_UPDATED: 'unread:updated',
  MEMBER_JOINED: 'member:joined',
  MEMBER_LEFT: 'member:left',
  CHANNEL_CREATED: 'channel:created',
  CHANNEL_UPDATED: 'channel:updated',
  /** Huddle (voice) — who is currently in a channel's huddle. */
  HUDDLE_PARTICIPANTS: 'huddle:participants',
  /** Huddle WebRTC signaling relayed to a specific peer. */
  HUDDLE_SIGNAL: 'huddle:signal',
  /** Ephemeral in-meeting chat message. */
  HUDDLE_CHAT: 'huddle:chat',
  /** A floating emoji reaction from a participant. */
  HUDDLE_REACTION: 'huddle:reaction',
  /** A collaborative annotation operation over the shared screen. */
  HUDDLE_ANNOTATION: 'huddle:annotation',
  /** A throttled laser-pointer position (ephemeral, not persisted). */
  HUDDLE_LASER: 'huddle:laser',
  /** Remote-control permission signalling (request/grant/deny/revoke). */
  HUDDLE_CONTROL: 'huddle:control',
  /** Live poll lifecycle (created/updated/closed). */
  HUDDLE_POLL: 'huddle:poll',
  /** Collaborative meeting-notes document changed. */
  HUDDLE_NOTES: 'huddle:notes',
  /** A moderation directive addressed to a specific participant (e.g. please mute). */
  HUDDLE_MODERATION: 'huddle:moderation',
  /** A live caption (speech-to-text) line from a participant (ephemeral). */
  HUDDLE_CAPTION: 'huddle:caption',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export interface MessageNewPayload {
  message: MessageDto;
}

export interface MessageUpdatedPayload {
  message: MessageDto;
}

export interface MessageDeletedPayload {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  parentId: string | null;
}

export interface ReactionChangedPayload {
  messageId: string;
  channelId: string | null;
  conversationId: string | null;
  emoji: string;
  userId: string;
  /** Full regrouped reactions after the change. */
  reactions: ReactionGroupDto[];
}

export interface ThreadReplyPayload {
  parentId: string;
  channelId: string | null;
  conversationId: string | null;
  replyCount: number;
  lastReplyAt: string;
}

export interface TypingPayload {
  channelId: string | null;
  conversationId: string | null;
  user: Pick<UserDto, 'id' | 'displayName'>;
}

export type PresenceState = 'ACTIVE' | 'AWAY' | 'DND' | 'OFFLINE';

export interface PresenceChangedPayload {
  userId: string;
  state: PresenceState;
}

export interface NotificationNewPayload {
  id: string;
  type: string;
  actor: UserDto | null;
  messageId: string | null;
  channelId: string | null;
  conversationId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface UnreadUpdatedPayload {
  channelId: string | null;
  conversationId: string | null;
  unread: number;
  mentions: number;
}

export interface MemberChangedPayload {
  channelId: string;
  user: UserDto;
}

export type HuddleRole = 'host' | 'cohost' | 'participant';

/** A participant currently in a huddle. Media/hand/role fields default sensibly
 *  so older clients that only read userId/displayName/avatarUrl keep working. */
export interface HuddleParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Server-tracked meeting state (authoritative for moderation/UI). */
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  screenSharing?: boolean;
  handRaised?: boolean;
  role?: HuddleRole;
  /** Whether this participant is currently allowed to annotate the shared screen. */
  canAnnotate?: boolean;
  /** MediaStream ids the sender reports for each source, so a receiver can classify
   *  an incoming video track deterministically (WebRTC MSIDs match end-to-end)
   *  instead of guessing from audio-track presence. Null when that source is off. */
  cameraStreamId?: string | null;
  screenStreamId?: string | null;
}

/** Client→server: the caller's own media/hand state changed. */
export interface ClientHuddleStatePayload {
  channelId?: string;
  conversationId?: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  screenSharing?: boolean;
  handRaised?: boolean;
  /** Source→stream mapping so peers classify video tracks without heuristics. */
  cameraStreamId?: string | null;
  screenStreamId?: string | null;
}

/** A single in-meeting chat message (ephemeral — not persisted to the DB). */
export interface HuddleChatPayload {
  channelId?: string;
  conversationId?: string;
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  text: string;
  /** Optional id of the message this one replies to. */
  replyTo?: string | null;
  createdAt: string;
}
export interface ClientHuddleChatPayload {
  channelId?: string;
  conversationId?: string;
  text: string;
  replyTo?: string | null;
}

export const HUDDLE_REACTIONS = ['👍', '❤️', '😂', '👏', '🎉', '❓'] as const;
export type HuddleReactionEmoji = (typeof HUDDLE_REACTIONS)[number];

export interface HuddleReactionPayload {
  channelId?: string;
  conversationId?: string;
  userId: string;
  displayName: string;
  emoji: string;
  /** Client-generated id so the floating animation can be keyed/deduped. */
  id: string;
}
export interface ClientHuddleReactionPayload {
  channelId?: string;
  conversationId?: string;
  emoji: string;
}

/** Annotation shapes are stored in normalized (0..1) coordinates relative to the
 *  shared-screen surface so they line up across differing viewport sizes. */
export type HuddleAnnotationTool =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text';

export interface HuddleAnnotationShape {
  id: string;
  userId: string;
  tool: HuddleAnnotationTool;
  color: string;
  /** Normalized points (0..1). Freehand tools carry many; shapes carry two. */
  points: { x: number; y: number }[];
  text?: string;
  createdAt: number;
}

export type HuddleAnnotationOp =
  | { kind: 'create'; shape: HuddleAnnotationShape }
  | { kind: 'update'; shape: HuddleAnnotationShape }
  | { kind: 'delete'; id: string }
  | { kind: 'clear' };

export interface HuddleAnnotationPayload {
  channelId?: string;
  conversationId?: string;
  userId: string;
  op: HuddleAnnotationOp;
}
export interface ClientHuddleAnnotationPayload {
  channelId?: string;
  conversationId?: string;
  op: HuddleAnnotationOp;
}

/** Ephemeral laser-pointer position in normalized coords (null = pointer lifted). */
export interface HuddleLaserPayload {
  channelId?: string;
  conversationId?: string;
  userId: string;
  displayName: string;
  point: { x: number; y: number } | null;
}
export interface ClientHuddleLaserPayload {
  channelId?: string;
  conversationId?: string;
  point: { x: number; y: number } | null;
}

/** Remote-control permission handshake. NOTE: this is a permission/session
 *  architecture only — the browser cannot control another machine's OS without a
 *  native agent, so no client claims actual OS control (see the meeting UI). */
export type HuddleControlAction =
  | 'request'
  | 'grant'
  | 'deny'
  | 'revoke'
  | 'cancel';

export interface HuddleControlPayload {
  channelId?: string;
  conversationId?: string;
  action: HuddleControlAction;
  /** The participant asking to control the presenter's screen. */
  requesterId: string;
  requesterName: string;
  /** The presenter whose screen is the target of the request. */
  presenterId: string;
}
export interface ClientHuddleControlPayload {
  channelId?: string;
  conversationId?: string;
  action: HuddleControlAction;
  /** Required for grant/deny/revoke to name the other party. */
  targetUserId: string;
}

/** A live in-meeting poll. Results are recomputed from `votes` (userId→index). */
export interface HuddlePollPayload {
  channelId?: string;
  conversationId?: string;
  poll: {
    id: string;
    question: string;
    options: string[];
    /** userId → chosen option index. */
    votes: Record<string, number>;
    createdBy: string;
    closed: boolean;
  } | null;
}
export interface ClientHuddlePollPayload {
  channelId?: string;
  conversationId?: string;
  action: 'create' | 'vote' | 'close';
  question?: string;
  options?: string[];
  pollId?: string;
  optionIndex?: number;
}

export interface HuddleNotesPayload {
  channelId?: string;
  conversationId?: string;
  content: string;
  updatedBy: string;
}
export interface ClientHuddleNotesPayload {
  channelId?: string;
  conversationId?: string;
  content: string;
}

/** Host→participant moderation directives (server-validated). */
export type HuddleModerationAction = 'mute-request' | 'lower-hand' | 'remove' | 'set-role';

export interface HuddleModerationPayload {
  channelId?: string;
  conversationId?: string;
  action: HuddleModerationAction;
  targetUserId: string;
  role?: HuddleRole;
  by: string;
}
export interface ClientHuddleModerationPayload {
  channelId?: string;
  conversationId?: string;
  action: HuddleModerationAction;
  targetUserId: string;
  role?: HuddleRole;
}

/** Live caption line (speech-to-text). `final` marks a completed utterance;
 *  interim lines update in place until then. Ephemeral — never persisted. */
export interface HuddleCaptionPayload {
  channelId?: string;
  conversationId?: string;
  userId: string;
  displayName: string;
  text: string;
  final: boolean;
}
export interface ClientHuddleCaptionPayload {
  channelId?: string;
  conversationId?: string;
  text: string;
  final: boolean;
}

/** A huddle runs in a channel OR a DM/group conversation — exactly one id is set. */
export interface HuddleParticipantsPayload {
  channelId?: string;
  conversationId?: string;
  participants: HuddleParticipant[];
}

/** A WebRTC signaling message (offer/answer/ICE) relayed between two peers. */
export interface HuddleSignalPayload {
  channelId?: string;
  conversationId?: string;
  fromUserId: string;
  data: unknown;
}

/** Client→server events (server→client use the payloads above). */
export const CLIENT_EVENTS = {
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  HUDDLE_JOIN: 'huddle:join',
  HUDDLE_LEAVE: 'huddle:leave',
  HUDDLE_SIGNAL: 'huddle:signal',
  HUDDLE_STATE: 'huddle:state',
  HUDDLE_CHAT: 'huddle:chat',
  HUDDLE_REACTION: 'huddle:reaction',
  HUDDLE_ANNOTATION: 'huddle:annotation',
  HUDDLE_LASER: 'huddle:laser',
  HUDDLE_CONTROL: 'huddle:control',
  HUDDLE_POLL: 'huddle:poll',
  HUDDLE_NOTES: 'huddle:notes',
  HUDDLE_MODERATION: 'huddle:moderation',
  HUDDLE_CAPTION: 'huddle:caption',
} as const;

export interface ClientTypingPayload {
  channelId?: string;
  conversationId?: string;
}

export interface ClientHuddlePayload {
  channelId?: string;
  conversationId?: string;
}

export interface ClientHuddleSignalPayload {
  channelId?: string;
  conversationId?: string;
  toUserId: string;
  data: unknown;
}
