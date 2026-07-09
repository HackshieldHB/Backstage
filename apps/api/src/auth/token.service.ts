import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async signAccessToken(user: { id: string; email: string }): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, email: user.email });
  }

  /** Issues a new crypto-random refresh token; only its SHA-256 hash is persisted. */
  async issueRefreshToken(userId: string, familyId?: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        familyId: familyId ?? randomUUID(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return raw;
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new one from the
   * same family is issued. Presenting an already-revoked token is treated as theft
   * (reuse detection) and revokes the entire family.
   */
  async rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!record) throw new UnauthorizedException('Invalid refresh token');

    if (record.revokedAt) {
      // Reuse of a rotated/revoked token — assume the family is compromised.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const refreshToken = await this.issueRefreshToken(record.userId, record.familyId);
    return { userId: record.userId, refreshToken };
  }

  /** Revokes the presented token and its whole family (logout). */
  async revokeRefreshToken(raw: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!record) return; // logout is idempotent; don't leak token validity
    await this.prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active refresh token for a user (e.g. after a password reset). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
