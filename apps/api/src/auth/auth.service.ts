import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  AuthResponse,
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

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isProvisional: user.isProvisional,
    statusEmoji: user.statusEmoji,
    statusText: user.statusText,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
  ) {}

  async signup(input: SignupInput): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing && !existing.isProvisional) {
      throw new ConflictException('An account with this email already exists');
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

    return this.buildAuthResponse(user);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
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
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    ]);
    // A password reset invalidates every existing session.
    await this.tokenService.revokeAllForUser(record.userId);
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
