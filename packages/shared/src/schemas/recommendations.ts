import { z } from 'zod';

/**
 * Contracts for the recommendation engine. Every list item carries a normalized
 * `score` (0..1) and a human `reason` string so the UI never has to re-derive
 * why something was surfaced. `refId` is the stable target key used for feedback.
 */

export const RECOMMENDATION_KINDS = [
  'PERSON',
  'CHANNEL',
  'PRIORITY',
  'FOCUS',
  'EXPERT',
  'CATCHUP',
  'KNOWLEDGE',
  'FOLLOWUP',
] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

export const RECOMMENDATION_ACTIONS = ['DISMISSED', 'ACTED'] as const;
export type RecommendationActionKind = (typeof RECOMMENDATION_ACTIONS)[number];

export const RecommendationFeedbackSchema = z.object({
  kind: z.enum(RECOMMENDATION_KINDS),
  refId: z.string().min(1).max(200),
  action: z.enum(RECOMMENDATION_ACTIONS),
});
export type RecommendationFeedbackInput = z.infer<typeof RecommendationFeedbackSchema>;

// ---- R1: people you should connect with ----
export interface PersonRecommendationDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isProvisional: boolean;
  score: number;
  reason: string;
  sharedChannels: number;
}

// ---- R2: channels worth joining ----
export interface ChannelRecommendationDto {
  channelId: string;
  name: string;
  memberCount: number;
  score: number;
  reason: string;
}

// ---- R3: prioritized inbox ----
export interface PriorityItemDto {
  id: string;
  source: 'mention' | 'dm' | 'thread' | 'reaction' | 'decision' | 'system';
  score: number;
  reason: string;
  title: string;
  preview: string | null;
  actorName: string | null;
  channelId: string | null;
  conversationId: string | null;
  messageId: string | null;
  createdAt: string;
}
export interface PriorityInboxDto {
  items: PriorityItemDto[];
}

// ---- R4: focus & meeting-load ----
export type FocusLevel = 'ok' | 'watch' | 'high';
export interface FocusRecommendationDto {
  key: string;
  level: FocusLevel;
  title: string;
  detail: string;
  /** Suggested action label, or null when it's purely informational. */
  action: string | null;
}
export interface FocusReportDto {
  /** False when there isn't enough activity data yet to advise. */
  available: boolean;
  daysCovered: number;
  meetingHoursPerDay: number;
  focusHoursPerDay: number;
  meetingsPerDay: number;
  /** Longest uninterrupted implementation block, in minutes (recent average). */
  longestFocusBlockMin: number;
  recommendations: FocusRecommendationDto[];
}

// ---- R5: best time to reach someone ----
export interface BestTimeDto {
  userId: string;
  displayName: string;
  /** Current effective presence. */
  status: 'ACTIVE' | 'AWAY' | 'DND' | 'OFFLINE';
  /** True when they can be reached right now. */
  reachableNow: boolean;
  /** ISO time of the next good window, or null when reachable now / unknown. */
  suggestedAt: string | null;
  reason: string;
}

// ---- R6: ask the right person ----
export interface ExpertDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  reason: string;
}
export interface ExpertsResponseDto {
  experts: ExpertDto[];
}

// ---- R7: catch-up picks ----
export interface CatchupPickDto {
  channelId: string | null;
  conversationId: string | null;
  label: string;
  unread: number;
  mentions: number;
  score: number;
  reason: string;
  latestMessageId: string | null;
}
export interface CatchupPicksDto {
  picks: CatchupPickDto[];
}

// ---- R8: related knowledge ----
export interface KnowledgeItemDto {
  kind: 'decision' | 'canvas';
  id: string;
  title: string;
  channelId: string | null;
  score: number;
  reason: string;
}
export interface KnowledgeResponseDto {
  items: KnowledgeItemDto[];
}

// ---- R9: follow-ups & stale items ----
export interface FollowupItemDto {
  kind: 'decision';
  id: string;
  title: string;
  reason: string;
  dueAt: string | null;
  overdue: boolean;
  channelId: string | null;
}
export interface FollowupsDto {
  items: FollowupItemDto[];
}

// ---- Combined overview for the Discover pane ----
export interface DiscoverDto {
  people: PersonRecommendationDto[];
  channels: ChannelRecommendationDto[];
  followups: FollowupItemDto[];
}
