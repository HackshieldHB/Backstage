import { z } from 'zod';

// ---------- API tokens & bots ----------

export const API_TOKEN_SCOPES = ['read', 'write'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const CreateApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(API_TOKEN_SCOPES).default('read'),
  /** Days until it expires (omit for no expiry). */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateApiTokenInput = z.infer<typeof CreateApiTokenSchema>;

export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  scope: ApiTokenScope;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Returned once, at creation — the only time the full token is visible. */
export interface CreatedApiTokenDto extends ApiTokenDto {
  token: string;
}

export const CreateBotSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(API_TOKEN_SCOPES).default('write'),
});
export type CreateBotInput = z.infer<typeof CreateBotSchema>;

export interface BotDto {
  id: string;
  displayName: string;
  createdAt: string;
  tokens: ApiTokenDto[];
}

// ---------- 2FA ----------

export interface TwoFactorStatusDto {
  enabled: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetupDto {
  /** Base32 secret, for manual entry. */
  secret: string;
  /** otpauth:// link (authenticator apps scan it as a QR code). */
  otpauthUri: string;
}

export const TwoFactorCodeSchema = z.object({
  code: z.string().trim().min(6).max(32),
});
export type TwoFactorCodeInput = z.infer<typeof TwoFactorCodeSchema>;

/** Second login step: the short-lived token from step one plus a code (TOTP or recovery). */
export const LoginTwoFactorSchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().trim().min(6).max(32),
});
export type LoginTwoFactorInput = z.infer<typeof LoginTwoFactorSchema>;

/** What /auth/login returns when 2FA is on: no session yet. */
export interface MfaChallengeDto {
  mfaRequired: true;
  mfaToken: string;
}

// ---------- retention & export ----------

export const RetentionSettingsSchema = z.object({
  /** Null keeps messages forever; otherwise 7..3650 days. */
  retentionDays: z.number().int().min(7).max(3650).nullable(),
  legalHold: z.boolean(),
});
export type RetentionSettingsInput = z.infer<typeof RetentionSettingsSchema>;

export interface RetentionSettingsDto {
  retentionDays: number | null;
  legalHold: boolean;
}

/** 'public' = public channels (admins); 'all' adds private channels and DMs (owner only). */
export const WORKSPACE_EXPORT_SCOPES = ['public', 'all'] as const;
export type WorkspaceExportScope = (typeof WORKSPACE_EXPORT_SCOPES)[number];

export interface ExportedMessage {
  id: string;
  userId: string | null;
  parentId: string | null;
  kind: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
  files: Array<{ filename: string; mimeType: string; sizeBytes: number }>;
}

export interface WorkspaceExportDto {
  format: 'backstages-export/1';
  exportedAt: string;
  scope: WorkspaceExportScope;
  /** True when the message cap was hit — not everything is included. */
  truncated: boolean;
  workspace: { id: string; name: string };
  members: Array<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    isBot: boolean;
    deactivated: boolean;
  }>;
  channels: Array<{
    id: string;
    name: string;
    isPrivate: boolean;
    isArchived: boolean;
    createdAt: string;
    messages: ExportedMessage[];
  }>;
  conversations: Array<{
    id: string;
    isGroup: boolean;
    title: string | null;
    memberIds: string[];
    messages: ExportedMessage[];
  }>;
}

// ---------- SCIM ----------

export interface ScimStatusDto {
  enabled: boolean;
  tokenPrefix: string | null;
  baseUrl: string;
}

// ---------- SSO (OIDC) ----------

export const SsoConnectionSchema = z.object({
  /** The IdP issuer URL (https; its /.well-known/openid-configuration is read). */
  issuer: z.string().trim().url().max(500),
  clientId: z.string().trim().min(1).max(200),
  /** Required when creating; omit on update to keep the stored secret. */
  clientSecret: z.string().min(1).max(500).optional(),
  enforced: z.boolean().default(false),
});
export type SsoConnectionInput = z.infer<typeof SsoConnectionSchema>;

export interface SsoConnectionDto {
  issuer: string;
  clientId: string;
  enforced: boolean;
  /** Paste this into the IdP as the allowed redirect URI. */
  redirectUri: string;
}

// ---------- verified domains ----------

export const AddDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^(?!-)[a-z0-9-]{1,63}(\.(?!-)[a-z0-9-]{1,63})+$/, 'Enter a domain like acme.com'),
});
export type AddDomainInput = z.infer<typeof AddDomainSchema>;

export interface WorkspaceDomainDto {
  id: string;
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  /** Publish this as a TXT record to prove control of the domain. */
  txtRecordName: string;
  txtRecordValue: string;
}

/** Login-page lookup: does this email's domain use SSO? */
export interface SsoDiscoveryDto {
  sso: boolean;
  enforced: boolean;
  workspaceId: string | null;
}
