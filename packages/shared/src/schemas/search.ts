import { z } from 'zod';
import { UserDtoSchema } from './auth';
import { ChannelDtoSchema } from './channel';
import { AttachmentDtoSchema, MessageDtoSchema } from './message';

export const SearchQuerySchema = z.object({
  /** Free text plus modifiers: from: in: before: after: has:link has:file */
  q: z.string().min(1).max(500),
  type: z.enum(['messages', 'files', 'channels', 'people', 'decisions', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;

export const SearchDecisionResultSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  title: z.string(),
  detail: z.string(),
  status: z.enum(['OPEN', 'DECIDED']),
  outcome: z.string().nullable(),
  createdAt: z.string(),
});
export type SearchDecisionResult = z.infer<typeof SearchDecisionResultSchema>;

export const SearchFileResultSchema = AttachmentDtoSchema.extend({
  messageId: z.string().nullable(),
  channelId: z.string().nullable(),
  conversationId: z.string().nullable(),
  uploader: UserDtoSchema.nullable(),
  createdAt: z.string(),
});
export type SearchFileResult = z.infer<typeof SearchFileResultSchema>;

export const SearchResponseSchema = z.object({
  messages: z.array(MessageDtoSchema),
  files: z.array(SearchFileResultSchema),
  channels: z.array(ChannelDtoSchema),
  people: z.array(UserDtoSchema),
  decisions: z.array(SearchDecisionResultSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
