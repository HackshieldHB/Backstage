import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AtlassianApiService } from './atlassian-api.service';
import { decryptToken, encryptToken } from './crypto';

export interface SyncStats {
  scanned: number;
  provisionalCreated: number;
  linkedExisting: number;
  reactivated: number;
  deactivated: number;
}

/**
 * Member directory sync: after a workspace connects an Atlassian site, every
 * member of that site becomes chattable in Backstages — existing accounts get
 * linked by email, everyone else becomes a provisional member immediately.
 */
@Injectable()
export class AtlassianSyncService {
  private readonly logger = new Logger(AtlassianSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: AtlassianApiService,
  ) {}

  async syncWorkspace(workspaceId: string): Promise<SyncStats> {
    const connection = await this.prisma.atlassianConnection.findUnique({ where: { workspaceId } });
    if (!connection) throw new NotFoundException('Workspace is not connected to Atlassian');

    // Refresh if the stored token is stale (best effort; api mock ignores).
    let accessToken = decryptToken(connection.accessTokenEnc);
    if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now() + 60_000) {
      const fresh = await this.api.refreshTokens(decryptToken(connection.refreshTokenEnc));
      accessToken = fresh.accessToken;
      await this.prisma.atlassianConnection.update({
        where: { id: connection.id },
        data: {
          accessTokenEnc: encryptToken(fresh.accessToken),
          refreshTokenEnc: encryptToken(fresh.refreshToken),
          tokenExpiresAt: new Date(Date.now() + fresh.expiresInSeconds * 1000),
        },
      });
    }

    const directory = await this.api.listUsers(accessToken, connection.siteId);
    const humans = directory.filter((u) => u.accountType === 'atlassian');

    const stats: SyncStats = {
      scanned: humans.length,
      provisionalCreated: 0,
      linkedExisting: 0,
      reactivated: 0,
      deactivated: 0,
    };
    const seenAccountIds = new Set<string>();

    for (const au of humans) {
      seenAccountIds.add(au.accountId);

      let link = await this.prisma.atlassianAccountLink.findUnique({
        where: { atlassianAccountId: au.accountId },
        include: { user: true },
      });

      if (!link) {
        // Try matching an existing Backstages account by email.
        const existing = au.email
          ? await this.prisma.user.findUnique({ where: { email: au.email } })
          : null;

        if (existing) {
          link = await this.prisma.atlassianAccountLink.create({
            data: {
              userId: existing.id,
              atlassianAccountId: au.accountId,
              siteUrl: connection.siteUrl,
            },
            include: { user: true },
          });
          stats.linkedExisting++;
        } else {
          // Provisional member: appears in the member list and DM picker now;
          // activates on first Atlassian SSO login or invite/signup claim.
          const email = au.email ?? `${au.accountId}@atlassian.invalid`;
          const user = await this.prisma.user.create({
            data: {
              email,
              displayName: au.displayName,
              avatarUrl: au.avatarUrl,
              isProvisional: true,
              passwordHash: null,
            },
          });
          link = await this.prisma.atlassianAccountLink.create({
            data: {
              userId: user.id,
              atlassianAccountId: au.accountId,
              siteUrl: connection.siteUrl,
            },
            include: { user: true },
          });
          stats.provisionalCreated++;
        }
      } else if (link.user.isProvisional) {
        // Keep provisional profiles fresh from the directory.
        await this.prisma.user.update({
          where: { id: link.userId },
          data: { displayName: au.displayName, avatarUrl: au.avatarUrl },
        });
      }

      // Membership in the connected workspace.
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: link.userId } },
      });
      if (!membership) {
        await this.prisma.workspaceMember.create({
          data: {
            workspaceId,
            userId: link.userId,
            role: 'MEMBER',
            deactivatedAt: au.active ? null : new Date(),
          },
        });
      } else if (au.active && membership.deactivatedAt) {
        await this.prisma.workspaceMember.update({
          where: { id: membership.id },
          data: { deactivatedAt: null },
        });
        stats.reactivated++;
      } else if (!au.active && !membership.deactivatedAt) {
        await this.prisma.workspaceMember.update({
          where: { id: membership.id },
          data: { deactivatedAt: new Date() },
        });
        stats.deactivated++;
      }
    }

    // Users previously synced from this site but no longer in the directory get flagged.
    const staleLinks = await this.prisma.atlassianAccountLink.findMany({
      where: {
        siteUrl: connection.siteUrl,
        atlassianAccountId: { notIn: [...seenAccountIds] },
        user: { workspaceMemberships: { some: { workspaceId, deactivatedAt: null } } },
      },
      select: { userId: true },
    });
    for (const stale of staleLinks) {
      await this.prisma.workspaceMember.updateMany({
        where: { workspaceId, userId: stale.userId, deactivatedAt: null, role: { not: 'OWNER' } },
        data: { deactivatedAt: new Date() },
      });
      stats.deactivated++;
    }

    await this.prisma.atlassianConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date() },
    });

    this.logger.log(
      `Synced workspace ${workspaceId}: ${JSON.stringify(stats)} (site ${connection.siteName})`,
    );
    return stats;
  }
}
