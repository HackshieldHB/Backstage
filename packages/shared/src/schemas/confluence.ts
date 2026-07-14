import { z } from 'zod';

/** A Confluence space the connected site exposes. */
export interface ConfluenceSpace {
  key: string;
  name: string;
  id: string;
}

/** A Confluence page (content of type "page"). */
export interface ConfluencePage {
  id: string;
  title: string;
  /** Current version number — required to update (optimistic concurrency). */
  version: number;
  url: string | null;
}

export const CreatePageSchema = z.object({
  spaceKey: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  /** Plain text; the server wraps it into Confluence storage format. */
  body: z.string().max(50000).default(''),
});
export type CreatePageInput = z.infer<typeof CreatePageSchema>;

export const UpdatePageSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().max(50000).default(''),
  /** The page's current version number; the update writes version + 1. */
  version: z.number().int().min(1),
});
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>;
