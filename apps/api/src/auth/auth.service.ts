import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  AuthResponse,
  MfaChallengeDto,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  SignupInput,
  UserDto,
} from '@backstages/shared';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { sha256, TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { RedisClient } from '../redis/redis.module';
import { ssoEnforcedFor } from '../security/sso-policy';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MFA_MAX_ATTEMPTS = 5;

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isProvisional: user.isProvisional,
    statusEmoji: user.statusEmoji,
    statusText: user.statusText,
    emailVerified: !!user.emailVerifiedAt,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
    private readonly twoFactor: TwoFactorService,
    private readonly redis: RedisClient,
  ) {}

  async signup(input: SignupInput): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing && !existing.isProvisional) {
      throw new ConflictException('An account with this email already exists');
    }
    if (await ssoEnforcedFor(this.prisma, input.email)) {
      throw new ForbiddenException('Your organization requires single sign-on — use “Continue with SSO”');
    }
    // Accounts pre-created by an organization (SCIM) on a verified domain can only be
    // claimed by proving the mailbox (password reset) or via SSO — signup has no email
    // check, so it must not hand someone else's provisioned account to whoever asks.
    if (existing?.isProvisional && (await this.prisma.workspaceDomain.count({
      where: { domain: input.email.slice(input.email.lastIndexOf('@') + 1).toLowerCase(), verifiedAt: { not: null } },
    }))) {
      throw new ConflictException(
        'Your organization already set up this account — sign in with SSO, or use “Forgot password” to set a password',
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    // A provisional member (created by Atlassian sync) claims their account on signup.
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, displayName: input.displayName, isProvisional: false },
        })
      : await this.prisma.user.create({
          data: { email: input.email, passwordHash, displayName: input.displayName },
        });

    // Fire-and-forget: a mail outage must not block signup.
    void this.sendVerification(user.id).catch(() => undefined);
    return this.buildAuthResponse(user);
  }

  /**
   * Password step. With 2FA on, no session is issued yet: the caller gets a
   * 5-minute `mfaToken` to present with a code to loginTwoFactor().
   */
  async login(input: LoginInput): Promise<AuthResponse | MfaChallengeDto> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user?.passwordHash || user.isBot) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (await ssoEnforcedFor(this.prisma, user.email, user.id)) {
      throw new ForbiddenException('Your organization requires single sign-on — use “Continue with SSO”');
    }
    if (user.totpEnabledAt) {
      return { mfaRequired: true, mfaToken: await this.tokenService.signMfaToken(user) };
    }
    return this.buildAuthResponse(user);
  }

  /** Second step: a TOTP or recovery code. Each mfaToken allows a few tries, then it's spent. */
  async loginTwoFactor(mfaToken: string, code: string): Promise<AuthResponse> {
    const { userId, jti } = await this.tokenService.verifyMfaToken(mfaToken);
    const key = `mfa:attempts:${jti}`;
    const attempts = await this.redis.incr(key);
    if (attempts === 1) await this.redis.expire(key, 600);
    if (attempts > MFA_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts — enter your password again');
    }
    if (!(await this.twoFactor.verify(userId, code))) {
      throw new UnauthorizedException('That code is not valid');
    }
    // Spend the challenge so it can't start a second session.
    await this.redis.set(key, String(MFA_MAX_ATTEMPTS + 1), 'EX', 600);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.buildAuthResponse(user);
  }

  async refresh(rawRefreshToken: string): Promise<AuthResponse> {
    const { userId, refreshToken } = await this.tokenService.rotateRefreshToken(rawRefreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const accessToken = await this.tokenService.signAccessToken(user);
    return { user: toUserDto(user), accessToken, refreshToken };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokenService.revokeRefreshToken(rawRefreshToken);
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Always respond identically — never reveal whether the email exists.
    if (!user) return;

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    await this.emailService.send({
      to: user.email,
      subject: 'Reset your Backstages password',
      body: `Use this token to reset your password (valid 1 hour): ${raw}`,
    });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // The reset link went to their inbox, so this also proves they own the address.
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, emailVerifiedAt: new Date() },
      }),
    ]);
    // A password reset invalidates every existing session.
    await this.tokenService.revokeAllForUser(record.userId);
  }

  /**
   * Email a link that proves the person owns their address. No-op when already
   * verified (and for bots, whose addresses are unroutable).
   */
  async sendVerification(userId: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt || user.isBot) return { sent: false };
    const token = await this.tokenService.signEmailVerification(user);
    const web = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    await this.emailService.send({
      to: user.email,
      subject: 'Confirm your email for Backstages',
      body: `Confirm this is your address (link valid 24 hours): ${web}/verify-email#token=${encodeURIComponent(token)}`,
    });
    return { sent: true };
  }

  async verifyEmail(token: string): Promise<UserDto> {
    const { userId, email } = await this.tokenService.verifyEmailToken(token);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // The link only counts for the address it was sent to.
    if (!user || user.email.toLowerCase() !== email.toLowerCase()) {
      throw new UnauthorizedException('This verification link is invalid or has expired');
    }
    const updated = user.emailVerifiedAt
      ? user
      : await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return toUserDto(updated);
  }

  async getMe(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return toUserDto(user);
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken(user),
      this.tokenService.issueRefreshToken(user.id),
    ]);
    return { user: toUserDto(user), accessToken, refreshToken };
  }
}
