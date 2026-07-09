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

/** Public shape of a user, safe to send to any client. */
export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  isProvisional: z.boolean(),
  statusEmoji: z.string().nullable(),
  statusText: z.string().nullable(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: UserDto;
}
