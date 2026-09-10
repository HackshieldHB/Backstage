import { z } from 'zod';

export const AskSchema = z.object({
  question: z.string().min(3).max(500),
});
export type AskInput = z.infer<typeof AskSchema>;

export interface AskSourceDto {
  kind: 'decision' | 'message';
  label: string;
  ref: string;
  channelId: string | null;
}

export interface AskAnswerDto {
  answer: string;
  sources: AskSourceDto[];
}
