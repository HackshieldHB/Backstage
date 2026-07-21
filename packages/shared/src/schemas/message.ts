import { z } from 'zod';
import { UserDtoSchema } from './auth';
import { MESSAGES_PAGE_SIZE } from '../constants';

/** Shortcode form, e.g. "thumbsup", "+1", "woman-shrugging". */
export const EmojiShortcodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_+\-]+$/i);

export const SendMessageSchema = z
  .object({
    clientMsgId: z.string().uuid(),
    /** TipTap JSON document; opaque to the server beyond mention extraction. */
    contentJson: z.unknown(),
    contentText: z.string().max(40000),
    parentId: z.string().min(1).optional(),
    /** For thread replies: also display the reply in the main channel view. */
    alsoSendToChannel: z.boolean().optional(),
    attachmentIds: z.array(z.string().min(1)).max(10).default([]),
  })
  .refine((v) => v.contentText.trim().length > 0 || v.attachmentIds.length > 0, {
    message: 'Message must have text or attachments',
    path: ['contentText'],
  })
  .refine((v) => JSON.stringify(v.contentJson ?? null).length <= 100_000, {
    message: 'Message content too large',
    path: ['contentJson'],
  });
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const EditMessageSchema = z
  .object({
    contentJson: z.unknown(),
    contentText: z.string().min(1).max(40000),
  })
  .refine((v) => JSON.stringify(v.contentJson ?? null).length <= 100_000, {
    message: 'Message content too large',
    path: ['contentJson'],
  });
export type EditMessageInput = z.infer<typeof EditMessageSchema>;

export const ToggleReactionSchema = z.object({
  emoji: EmojiShortcodeSchema,
});
export type ToggleReactionInput = z.infer<typeof ToggleReactionSchema>;

export const ListMessagesQuerySchema = z.object({
  /** Message id to page backwards from (exclusive). */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(MESSAGES_PAGE_SIZE),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

export const MarkReadSchema = z.object({
  messageId: z.string().min(1),
});
export type MarkReadInput = z.infer<typeof MarkReadSchema>;

export const ReactionGroupDtoSchema = z.object({
  emoji: z.string(),
  count: z.number(),
  userIds: z.array(z.string()),
});
export type ReactionGroupDto = z.infer<typeof ReactionGroupDtoSchema>;

export const AttachmentDtoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  url: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type AttachmentDto = z.infer<typeof AttachmentDtoSchema>;

export const MessageDtoSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  channelId: z.string().nullable(),
  conversationId: z.string().nullable(),
  user: UserDtoSchema.nullable(),
  kind: z.enum(['USER', 'SYSTEM', 'INTEGRATION']),
  contentJson: z.unknown(),
  contentText: z.string(),
  parentId: z.string().nullable(),
  showInChannel: z.boolean(),
  isEdited: z.boolean(),
  isDeleted: z.boolean(),
  clientMsgId: z.string().nullable(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  reactions: z.array(ReactionGroupDtoSchema),
  attachments: z.array(AttachmentDtoSchema),
  replyCount: z.number(),
  threadParticipants: z.array(UserDtoSchema),
  lastReplyAt: z.string().nullable(),
  /** Link previews, e.g. Jira issue status cards. */
  unfurls: z.unknown().nullable(),
});
export type MessageDto = z.infer<typeof MessageDtoSchema>;

/** Shape of a single unfurl entry produced by the Atlassian integration. */
export interface JiraUnfurl {
  type: 'jira' | 'confluence' | 'bitbucket';
  url: string;
  key?: string;
  title: string;
  status?: string;
  issueType?: string | null;
  priority?: string | null;
  assigneeAccountId?: string | null;
}

/** One row in the caller's personal Jira work queue. */
export interface JiraMyIssue {
  key: string;
  summary: string;
  status: string | null;
  priority: string | null;
  /** ISO date (no time), or null when unset. */
  dueDate: string | null;
  /** Server-computed so client and server agree on "today". */
  overdue: boolean;
  url: string;
}

/** Interactive action fired from a Jira card. */
export const JiraActionSchema = z.object({
  issueKey: z.string().min(3).max(30),
  action: z.enum(['assign_me', 'assign', 'transition', 'comment']),
  /** Required when action === 'transition'. */
  transitionId: z.string().min(1).max(30).optional(),
  /** Required when action === 'assign'. */
  assigneeAccountId: z.string().min(1).max(128).optional(),
  /** Required when action === 'comment'. */
  text: z.string().min(1).max(4000).optional(),
});
export type JiraActionInput = z.infer<typeof JiraActionSchema>;

/** A workspace member who can be assigned a Jira issue (has a linked account). */
export interface JiraAssignableUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  accountId: string;
}

/** One selectable Jira workflow transition for the "Move" picker. */
export interface JiraTransition {
  id: string;
  name: string;
}

export interface MessagePage {
  messages: MessageDto[];
  /** Cursor for the next (older) page, null when exhausted. */
  nextCursor: string | null;
}
