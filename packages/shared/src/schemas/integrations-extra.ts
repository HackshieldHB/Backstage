import { z } from 'zod';

// ---------- incoming webhooks ----------

export const CreateWebhookSchema = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1).max(80),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookSchema>;

export interface IncomingWebhookDto {
  id: string;
  channelId: string;
  name: string;
  /** Full URL external tools POST to. */
  url: string;
  active: boolean;
  createdAt: string;
}

/** Body accepted by the public webhook endpoint. */
export const WebhookPayloadSchema = z.object({
  text: z.string().min(1).max(4000),
  username: z.string().max(80).optional(),
});
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ---------- custom slash commands ----------

export const CreateCustomCommandSchema = z.object({
  trigger: z.string().min(1).max(32),
  description: z.string().max(120).default(''),
  responseText: z.string().min(1).max(4000),
});
export type CreateCustomCommandInput = z.infer<typeof CreateCustomCommandSchema>;

export interface CustomCommandDto {
  id: string;
  trigger: string;
  description: string;
  responseText: string;
}

// ---------- email-to-channel ----------

export interface ChannelEmailDto {
  channelId: string;
  /** The address a mail provider forwards to post into the channel. */
  address: string;
}

/** Body accepted by the public inbound-email endpoint (mail-provider webhook). */
export const InboundEmailSchema = z.object({
  from: z.string().max(320).optional(),
  subject: z.string().max(300).optional(),
  text: z.string().max(20000).optional(),
});
export type InboundEmailInput = z.infer<typeof InboundEmailSchema>;
