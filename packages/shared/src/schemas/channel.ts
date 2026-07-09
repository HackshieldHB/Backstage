import { z } from 'zod';

export const ChannelNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'lowercase letters, numbers, dashes and underscores only');

export const CreateChannelSchema = z.object({
  name: ChannelNameSchema,
  topic: z.string().max(250).optional(),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
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
  memberCount: z.number().optional(),
  isMember: z.boolean().optional(),
});
export type ChannelDto = z.infer<typeof ChannelDtoSchema>;
