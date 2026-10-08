import { createHash } from 'crypto';
import type { ApiTokenScope } from '@backstages/shared';
import type { PrismaService } from '../prisma/prisma.service';

export const API_TOKEN_PREFIX = 'bs_pat_';

export const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** The identity an API token authenticates as. */
export interface TokenIdentity {
  userId: string;
  email: string;
  scope: ApiTokenScope;
  tokenId: string;
}

/**
 * Resolve a raw `bs_pat_…` token; null when unknown, revoked or expired.
 * Standalone (Prisma only) so the global auth guard can use it without
 * pulling the security module into the auth module.
 */
export async function resolveApiToken(prisma: PrismaService, raw: string): Promise<TokenIdentity | null> {
  if (!raw.startsWith(API_TOKEN_PREFIX) || raw.length > 200) return null;
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date())) return null;
  // Cheap "last used" bookkeeping, at most once a minute per token.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return {
    userId: row.user.id,
    email: row.user.email,
    scope: row.scope === 'write' ? 'write' : 'read',
    tokenId: row.id,
  };
}
