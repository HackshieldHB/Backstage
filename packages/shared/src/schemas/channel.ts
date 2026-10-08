import { z } from 'zod';

export const ChannelNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'lowercase letters, numbers, dashes and underscores only');

/** Sidebar grouping for integration channels. */
export const ChannelGroupSchema = z.enum(['jira', 'confluence']);
export type ChannelGroup = z.infer<typeof ChannelGroupSchema>;

export const CreateChannelSchema = z.object({
  name: ChannelNameSchema,
  topic: z.string().max(250).optional(),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
  /** Places the channel under an integration group in the sidebar. */
  groupKey: ChannelGroupSchema.optional(),
});
export type CreateChannelInput = z.infer<typeof CreateChannelSchema>;

export const UpdateChannelSchema = z.object({
  name: ChannelNameSchema.optional(),
  topic: z.string().max(250).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});
export type UpdateChannelInput = z.infer<typeof UpdateChannelSchema>;

export const AddChannelMemberSchema = z.object({
  userId: z.string().min(1),
});
export type AddChannelMemberInput = z.infer<typeof AddChannelMemberSchema>;

export const NotificationPrefSchema = z.enum(['ALL', 'MENTIONS', 'MUTED']);
export type NotificationPrefValue = z.infer<typeof NotificationPrefSchema>;

export const ChannelDtoSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  topic: z.string().nullable(),
  description: z.string().nullable(),
  isPrivate: z.boolean(),
  isArchived: z.boolean(),
  isDefault: z.boolean(),
  groupKey: z.string().nullable().optional(),
  memberCount: z.number().optional(),
  isMember: z.boolean().optional(),
});
export type ChannelDto = z.infer<typeof ChannelDtoSchema>;

// ---------- shared channels (with another workspace) ----------

/** Extra fields on a sidebar channel that involves a partner workspace. */
export interface ChannelShareInfo {
  /** Host side: the channel is shared with at least one partner workspace. */
  isShared?: boolean;
  /** Guest side: the workspace that owns this channel. */
  sharedFrom?: { workspaceId: string; name: string } | null;
}

export const AcceptChannelShareSchema = z.object({
  token: z.string().trim().min(10).max(200),
});
export type AcceptChannelShareInput = z.infer<typeof AcceptChannelShareSchema>;

/** A share as the host channel's admins see it. */
export interface ChannelShareDto {
  id: string;
  status: 'pending' | 'active' | 'revoked';
  partner: { workspaceId: string; name: string } | null;
  inviteExpiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/** Returned once when an invite is created — the token is shown only here. */
export interface ChannelShareInviteDto extends ChannelShareDto {
  token: string;
}

/** A channel another workspace shared into this one (guest side). */
export interface IncomingSharedChannelDto {
  shareId: string;
  channelId: string;
  name: string;
  topic: string | null;
  host: { workspaceId: string; name: string };
  isMember: boolean;
  isArchived: boolean;
}
