import { z } from 'zod';

export const AskSchema = z.object({
  question: z.string().min(3).max(500),
});
export type AskInput = z.infer<typeof AskSchema>;

export interface AskSourceDto {
  kind: 'decision' | 'message' | 'task' | 'web';
  label: string;
  ref: string;
  channelId: string | null;
  /** Set for a message found in one of your DMs. */
  conversationId?: string | null;
  /** Set for a web result: the page to open. */
  url?: string;
}

export interface AskAnswerDto {
  answer: string;
  sources: AskSourceDto[];
}

/** The assistant chat: the conversation so far, ending with the user's new message. */
export const AssistantChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]?.role === 'user', { message: 'The last message must be from the user' }),
});
export type AssistantChatInput = z.infer<typeof AssistantChatSchema>;
