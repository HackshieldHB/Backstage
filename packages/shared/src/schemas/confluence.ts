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

/** Capture a whole thread as a Confluence page. */
export const CreatePageFromThreadSchema = z.object({
  spaceKey: z.string().min(1).max(64),
  /** Defaults to the thread's opening line when omitted. */
  title: z.string().min(1).max(255).optional(),
});
export type CreatePageFromThreadInput = z.infer<typeof CreatePageFromThreadSchema>;

/** Spin up an incident: channel + Jira issue + (optional) postmortem page. */
export const DeclareIncidentSchema = z.object({
  title: z.string().min(3).max(120),
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]+$/),
  /** Omit to skip the postmortem page. */
  spaceKey: z.string().min(1).max(64).optional(),
  severity: z.enum(['sev1', 'sev2', 'sev3']).default('sev2'),
});
export type DeclareIncidentInput = z.infer<typeof DeclareIncidentSchema>;

export interface IncidentResult {
  channelId: string;
  channelName: string;
  issueKey: string;
  issueUrl: string;
  pageId: string | null;
  pageUrl: string | null;
  /** Non-fatal problems, e.g. the postmortem page could not be created. */
  warnings: string[];
}

export const UpdatePageSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().max(50000).default(''),
  /** The page's current version number; the update writes version + 1. */
  version: z.number().int().min(1),
});
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>;
