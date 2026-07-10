import { z } from 'zod';
import { UserDtoSchema } from './auth';
import { MAX_CONVERSATION_MEMBERS } from '../constants';

export const CreateConversationSchema = z.object({
  /** Other participants (the caller is always included). 1 = 1:1 DM, 2..8 = group DM. */
  memberIds: z.array(z.string().min(1)).min(1).max(MAX_CONVERSATION_MEMBERS - 1),
});
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

export const ConversationDtoSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  isGroup: z.boolean(),
  /** Set for integration inboxes (e.g. "Jira"); null for normal DMs. */
  title: z.string().nullable(),
  members: z.array(UserDtoSchema),
});
export type ConversationDto = z.infer<typeof ConversationDtoSchema>;
