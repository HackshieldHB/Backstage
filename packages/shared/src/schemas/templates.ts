import { z } from 'zod';

/** A reusable message. `shared` ones are available to the whole workspace. */
export interface MessageTemplateDto {
  id: string;
  name: string;
  content: string;
  shared: boolean;
  owner: { id: string; displayName: string };
  /** The caller may edit or delete it (its owner, or an admin for shared ones). */
  canManage: boolean;
  updatedAt: string;
}

export const MessageTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  content: z.string().trim().min(1).max(4000),
  shared: z.boolean().default(false),
});
export type MessageTemplateInput = z.infer<typeof MessageTemplateSchema>;

export const UpdateMessageTemplateSchema = MessageTemplateSchema.partial();
export type UpdateMessageTemplateInput = z.infer<typeof UpdateMessageTemplateSchema>;
