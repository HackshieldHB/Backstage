import { z } from 'zod';

/** What a channel can follow from a GitHub repository. */
export const GITHUB_EVENTS = [
  'pr_opened',
  'pr_ready',
  'pr_merged',
  'pr_closed',
  'pr_reopened',
  'pr_review',
  'issue_opened',
  'issue_closed',
  'issue_reopened',
  'comment',
  'ci_failed',
  'release',
] as const;
export type GithubEvent = (typeof GITHUB_EVENTS)[number];

export const GITHUB_EVENT_LABELS: Record<GithubEvent, string> = {
  pr_opened: 'Pull request opened',
  pr_ready: 'Ready for review',
  pr_merged: 'Pull request merged',
  pr_closed: 'Pull request closed',
  pr_reopened: 'Pull request reopened',
  pr_review: 'Reviews (approved / changes requested)',
  issue_opened: 'Issue opened',
  issue_closed: 'Issue closed',
  issue_reopened: 'Issue reopened',
  comment: 'Comments on PRs & issues',
  ci_failed: 'CI failures (GitHub Actions)',
  release: 'Releases published',
};

/** "owner/repo" — GitHub's allowed characters. */
export const GITHUB_REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export const CreateGithubSubscriptionSchema = z.object({
  channelId: z.string().min(1),
  repo: z.string().trim().regex(GITHUB_REPO_RE, 'Use the form owner/repo'),
  events: z.array(z.enum(GITHUB_EVENTS)).min(1).max(GITHUB_EVENTS.length),
});
export type CreateGithubSubscriptionInput = z.infer<typeof CreateGithubSubscriptionSchema>;

export const UpdateGithubSubscriptionSchema = z.object({
  events: z.array(z.enum(GITHUB_EVENTS)).min(1).max(GITHUB_EVENTS.length),
});
export type UpdateGithubSubscriptionInput = z.infer<typeof UpdateGithubSubscriptionSchema>;

export interface GithubSubscriptionDto {
  id: string;
  channelId: string;
  channelName: string;
  repo: string;
  events: GithubEvent[];
  /** Paste into GitHub → repo Settings → Webhooks → Payload URL. */
  webhookUrl: string;
  createdAt: string;
}

/** Returned once at creation: the secret is never shown again. */
export interface CreatedGithubSubscriptionDto extends GithubSubscriptionDto {
  webhookSecret: string;
}

export interface GithubConnectionDto {
  /** GITHUB_CLIENT_ID/SECRET are set on the server. */
  available: boolean;
  connected: boolean;
  login: string | null;
}

export const CreateGithubIssueSchema = z.object({
  repo: z.string().trim().regex(GITHUB_REPO_RE, 'Use the form owner/repo'),
  title: z.string().trim().min(1).max(256),
  body: z.string().max(20000).optional(),
  /** The message it was created from (gets a link back, and a reply in its thread). */
  messageId: z.string().min(1).optional(),
});
export type CreateGithubIssueInput = z.infer<typeof CreateGithubIssueSchema>;

export interface GithubIssueCreatedDto {
  number: number;
  url: string;
  repo: string;
}

export const GithubConnectConfirmSchema = z.object({ code: z.string().min(20).max(200) });
export type GithubConnectConfirmInput = z.infer<typeof GithubConnectConfirmSchema>;
