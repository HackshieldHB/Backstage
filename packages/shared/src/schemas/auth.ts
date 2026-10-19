import { z } from 'zod';

export const SignupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutInput = z.infer<typeof LogoutSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const VerifyEmailSchema = z.object({
  token: z.string().min(10).max(2000),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

/** Public shape of a user, safe to send to any client. */
export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  isProvisional: z.boolean(),
  statusEmoji: z.string().nullable(),
  statusText: z.string().nullable(),
  /** Whether the person has proved they own `email`. */
  emailVerified: z.boolean().optional(),
  /** True right after a Google/GitHub/Atlassian/SSO sign-up, until the person confirms
   *  their name on /welcome. */
  needsOnboarding: z.boolean().optional(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: UserDto;
}

// ---------------------------------------------------------------------------
// Social sign-in (Google / GitHub)
// ---------------------------------------------------------------------------

export const OAuthProviderSchema = z.enum(['google', 'github']);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;

/** Which social sign-in buttons to show (configured on the server). */
export interface OAuthProvidersDto {
  google: boolean;
  github: boolean;
}

/** The one-time code the provider callback hands the web app (/sso#code=…). */
export const OAuthExchangeSchema = z.object({ code: z.string().min(20).max(200) });
export type OAuthExchangeInput = z.infer<typeof OAuthExchangeSchema>;

/** A sign-in method linked to the current account (Account security). */
export interface ConnectedAccountDto {
  id: string;
  provider: OAuthProvider | 'sso';
  /** Email or @login, as the provider reported it. */
  label: string | null;
  createdAt: string;
}

export interface ConnectedAccountsDto {
  hasPassword: boolean;
  accounts: ConnectedAccountDto[];
  providers: OAuthProvidersDto;
}

// ---------------------------------------------------------------------------
// Onboarding (/welcome)
// ---------------------------------------------------------------------------

export const CompleteOnboardingSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});
export type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingSchema>;

/** A workspace invitation addressed to the signed-in person's email. */
export interface MyInvitationDto {
  id: string;
  workspace: { id: string; name: string; memberCount: number };
  invitedBy: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  expiresAt: string;
}
