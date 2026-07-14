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

/** A participant currently in a channel's huddle. */
export interface HuddleParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface HuddleParticipantsPayload {
  channelId: string;
  participants: HuddleParticipant[];
}

/** A WebRTC signaling message (offer/answer/ICE) relayed between two peers. */
export interface HuddleSignalPayload {
  channelId: string;
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
} as const;

export interface ClientTypingPayload {
  channelId?: string;
  conversationId?: string;
}

export interface ClientHuddlePayload {
  channelId: string;
}

export interface ClientHuddleSignalPayload {
  channelId: string;
  toUserId: string;
  data: unknown;
}
