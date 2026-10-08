import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { TwoFactorSetupDto, TwoFactorStatusDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { decryptToken, encryptToken } from '../atlassian/crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

const RECOVERY_CODE_COUNT = 10;

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
/** Recovery codes are shown as `xxxxx-xxxxx`; accept any case, spaces or dashes. */
const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[\s-]/g, '');

/**
 * TOTP two-factor authentication (RFC 6238; any authenticator app).
 *  - setup() stores a fresh secret (AES-GCM encrypted) that is NOT active until
 *    enable() confirms a code from the app.
 *  - Each accepted TOTP step is recorded, so a code can't be replayed.
 *  - Ten single-use recovery codes are issued on enable (hashed at rest).
 */
@Injectable()
export class TwoFactorService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string): Promise<TwoFactorStatusDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const recoveryCodesLeft = user.totpEnabledAt
      ? await this.prisma.recoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return { enabled: !!user.totpEnabledAt, recoveryCodesLeft };
  }

  async setup(userId: string): Promise<TwoFactorSetupDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isBot) throw new BadRequestException('Bots cannot use two-factor authentication');
    if (user.totpEnabledAt) throw new BadRequestException('Two-factor authentication is already on');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: encryptToken(secret), totpLastStep: null },
    });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  /** Confirm the app is set up; returns the recovery codes (shown once). */
  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new BadRequestException('Two-factor authentication is already on');
    if (!user.totpSecretEnc) throw new BadRequestException('Start setup first');
    const step = verifyTotp(decryptToken(user.totpSecretEnc), code);
    if (step === null) throw new BadRequestException('That code is not valid — check the time on your device');
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, totpEnabledAt: null },
      data: { totpEnabledAt: new Date(), totpLastStep: step },
    });
    if (count === 0) throw new BadRequestException('Two-factor authentication is already on');
    return { recoveryCodes: await this.replaceRecoveryCodes(userId) };
  }

  async disable(userId: string, code: string): Promise<{ ok: boolean }> {
    await this.requireCode(userId, code);
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null },
      }),
    ]);
    return { ok: true };
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    await this.requireCode(userId, code);
    return { recoveryCodes: await this.replaceRecoveryCodes(userId) };
  }

  async isEnabled(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
    return !!user?.totpEnabledAt;
  }

  /**
   * Check a TOTP or recovery code for a user with 2FA on, consuming it
   * (single-winner: concurrent submissions of the same code can't both pass).
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabledAt || !user.totpSecretEnc) return false;

    const step = verifyTotp(decryptToken(user.totpSecretEnc), code);
    if (step !== null) {
      const { count } = await this.prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpLastStep: step },
      });
      return count === 1;
    }

    const normalized = normalizeRecovery(code);
    if (!/^[0-9a-f]{10}$/.test(normalized)) return false;
    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { userId, codeHash: hashCode(normalized), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  private async requireCode(userId: string, code: string) {
    if (!(await this.isEnabled(userId))) throw new BadRequestException('Two-factor authentication is off');
    // 400, not 401: the caller's session is fine — only the code is wrong.
    if (!(await this.verify(userId, code))) throw new BadRequestException('That code is not valid');
  }

  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(5).toString('hex'));
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashCode(c) })),
      }),
    ]);
    return codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
  }
}
