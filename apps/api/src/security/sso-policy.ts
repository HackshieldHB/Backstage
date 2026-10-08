import type { PrismaService } from '../prisma/prisma.service';

/**
 * When a workspace enforces SSO, people with an email on one of its verified
 * domains must sign in through the IdP — password login and signup are refused.
 * The workspace owner keeps password access as a break-glass account (an IdP
 * outage or misconfiguration must not lock everyone out).
 *
 * Prisma-only so the auth module can use it without depending on the security module.
 */
export async function ssoEnforcedFor(
  prisma: PrismaService,
  email: string,
  userId?: string,
): Promise<{ workspaceId: string } | null> {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  const row = await prisma.workspaceDomain.findFirst({
    where: { domain, verifiedAt: { not: null }, workspace: { sso: { enforced: true } } },
    select: { workspaceId: true },
  });
  if (!row) return null;
  if (userId) {
    const owner = await prisma.workspaceMember.findFirst({
      where: { workspaceId: row.workspaceId, userId, role: 'OWNER', deactivatedAt: null },
    });
    if (owner) return null;
  }
  return { workspaceId: row.workspaceId };
}
