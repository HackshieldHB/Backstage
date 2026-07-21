import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import type { AtlassianConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianApiService } from './atlassian-api.service';
import { AtlassianSyncService } from './sync.service';
import { decryptToken, encryptToken } from './crypto';
import { hasGranularConfluence } from './scopes';
import { TokenService } from '../auth/token.service';
import { toUserDto } from '../auth/auth.service';

const CONNECT_SCOPES = [
  'read:jira-user',
  'read:jira-work',
  'write:jira-work',
  // Confluence GRANULAR scopes — required by the v2 REST API. The classic
  // read:confluence-* scopes only work with the v1 API, which Atlassian has
  // removed (it now returns 410 Gone).
  'read:space:confluence',
  'read:page:confluence',
  'write:page:confluence',
  'delete:page:confluence',
  'offline_access',
];
const SSO_SCOPES = ['read:me', 'offline_access'];

interface OAuthState {
  kind: 'connect' | 'sso' | 'user-connect';
  workspaceId?: string;
  userId?: string;
  nonce: string;
}

@Injectable()
export class AtlassianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly jwtService: JwtService,
    private readonly api: AtlassianApiService,
    private readonly sync: AtlassianSyncService,
    private readonly tokens: TokenService,
  ) {}

  // ---------- connect (workspace OWNER/ADMIN) ----------

  async connectUrl(userId: string, workspaceId: string): Promise<{ url: string }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const state = await this.jwtService.signAsync(
      { kind: 'connect', workspaceId, userId, nonce: randomBytes(8).toString('hex') } satisfies OAuthState,
      { expiresIn: '10m' },
    );
    return { url: this.api.authorizeUrl(state, CONNECT_SCOPES) };
  }

  async status(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const row = await this.prisma.atlassianConnection.findUnique({
      where: { workspaceId },
      select: { id: true, siteUrl: true, siteName: true, lastSyncAt: true, createdAt: true, scopes: true },
    });
    // Strip scopes from the client-facing connection object; expose only the
    // derived readiness flag so the UI can prompt a reconnect when needed.
    const connection = row
      ? { id: row.id, siteUrl: row.siteUrl, siteName: row.siteName, lastSyncAt: row.lastSyncAt, createdAt: row.createdAt }
      : null;
    const confluenceReady = hasGranularConfluence(row?.scopes);
    const link = await this.prisma.atlassianAccountLink.findUnique({
      where: { userId },
      select: { accessTokenEnc: true, scopes: true },
    });
    // "canAct": the caller has personally granted write access, so Jira actions
    // are attributed to them rather than the shared workspace connection.
    const canAct = Boolean(link?.accessTokenEnc && link.scopes?.includes('write:jira-work'));
    return { connected: !!connection, connection, confluenceReady, me: { linked: !!link, canAct } };
  }

  // ---------- per-user connect ("Connect my Jira account") ----------

  /** Any workspace member may grant their own write access for correct attribution. */
  async userConnectUrl(userId: string, workspaceId: string): Promise<{ url: string }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    await this.connectionForWorkspace(workspaceId); // workspace must be connected first
    const state = await this.jwtService.signAsync(
      { kind: 'user-connect', workspaceId, userId, nonce: randomBytes(8).toString('hex') } satisfies OAuthState,
      { expiresIn: '10m' },
    );
    return { url: this.api.authorizeUrl(state, CONNECT_SCOPES) };
  }

  /** OAuth redirect target for ALL flows; dispatches on the signed state. */
  async handleCallback(code: string, rawState: string): Promise<{ redirect: string }> {
    let state: OAuthState;
    try {
      state = await this.jwtService.verifyAsync<OAuthState>(rawState);
    } catch {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (state.kind === 'connect') return this.completeConnect(code, state);
    if (state.kind === 'user-connect') return this.completeUserConnect(code, state);
    return this.completeSso(code);
  }

  private async completeUserConnect(code: string, state: OAuthState): Promise<{ redirect: string }> {
    const userId = state.userId!;
    const workspaceId = state.workspaceId!;
    const tokens = await this.api.exchangeCode(code);
    const profile = await this.api.me(tokens.accessToken);
    await this.prisma.atlassianAccountLink.upsert({
      where: { userId },
      create: {
        userId,
        atlassianAccountId: profile.accountId,
        siteUrl: 'https://api.atlassian.com',
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      },
      update: {
        atlassianAccountId: profile.accountId,
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      },
    });
    const web = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    return { redirect: `${web}/app?ws=${workspaceId}&atlassian=account-connected` };
  }

  private async completeConnect(code: string, state: OAuthState): Promise<{ redirect: string }> {
    const workspaceId = state.workspaceId!;
    const userId = state.userId!;
    // Re-verify the initiator still administers this workspace.
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');

    const tokens = await this.api.exchangeCode(code);
    const sites = await this.api.accessibleResources(tokens.accessToken);
    if (sites.length === 0) throw new BadRequestException('No accessible Atlassian sites');
    const site = sites[0]; // single-site grant is the common case

    await this.prisma.atlassianConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        siteId: site.id,
        siteUrl: site.url,
        siteName: site.name,
        connectedById: userId,
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        webhookSecret: randomBytes(24).toString('base64url'),
      },
      update: {
        siteId: site.id,
        siteUrl: site.url,
        siteName: site.name,
        connectedById: userId,
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      },
    });

    // First directory sync happens immediately.
    await this.sync.syncWorkspace(workspaceId);

    const web = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    return { redirect: `${web}/app?ws=${workspaceId}&atlassian=connected` };
  }

  // ---------- SSO ("Log in with Atlassian") ----------

  async ssoUrl(): Promise<{ url: string }> {
    const state = await this.jwtService.signAsync(
      { kind: 'sso', nonce: randomBytes(8).toString('hex') } satisfies OAuthState,
      { expiresIn: '10m' },
    );
    return { url: this.api.authorizeUrl(state, SSO_SCOPES) };
  }

  private async completeSso(code: string): Promise<{ redirect: string }> {
    const tokens = await this.api.exchangeCode(code);
    const profile = await this.api.me(tokens.accessToken);
    const web = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

    // Match strictly by VERIFIED email; otherwise only an existing account link works.
    let user = await this.prisma.user.findFirst({
      where: { atlassianLink: { atlassianAccountId: profile.accountId } },
    });
    if (!user && profile.email && profile.emailVerified) {
      user = await this.prisma.user.findUnique({ where: { email: profile.email } });
    }
    if (!user) {
      if (!profile.email || !profile.emailVerified) {
        return { redirect: `${web}/login?error=atlassian-email-unverified` };
      }
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          passwordHash: null, // Atlassian-only login
        },
      });
    }

    // SSO activates provisional members created by directory sync.
    if (user.isProvisional) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          isProvisional: false,
          displayName: profile.displayName,
          avatarUrl: user.avatarUrl ?? profile.avatarUrl,
        },
      });
    }

    await this.prisma.atlassianAccountLink.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        atlassianAccountId: profile.accountId,
        siteUrl: 'https://api.atlassian.com',
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      },
      update: {
        atlassianAccountId: profile.accountId,
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      },
    });

    const accessToken = await this.tokens.signAccessToken(user);
    const refreshToken = await this.tokens.issueRefreshToken(user.id);
    const fragment = new URLSearchParams({ access: accessToken, refresh: refreshToken });
    return { redirect: `${web}/sso#${fragment.toString()}` };
  }

  // ---------- token access for API calls (auto-refresh) ----------

  async connectionForWorkspace(workspaceId: string): Promise<AtlassianConnection> {
    const connection = await this.prisma.atlassianConnection.findUnique({ where: { workspaceId } });
    if (!connection) throw new NotFoundException('Workspace is not connected to Atlassian');
    return connection;
  }

  async accessTokenFor(connection: AtlassianConnection): Promise<string> {
    const expiresSoon =
      !connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() < Date.now() + 60_000;
    if (!expiresSoon) return decryptToken(connection.accessTokenEnc);

    const fresh = await this.api.refreshTokens(decryptToken(connection.refreshTokenEnc));
    await this.prisma.atlassianConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptToken(fresh.accessToken),
        refreshTokenEnc: encryptToken(fresh.refreshToken),
        tokenExpiresAt: new Date(Date.now() + fresh.expiresInSeconds * 1000),
      },
    });
    return fresh.accessToken;
  }

  /**
   * Returns the caller's PERSONAL Jira access token if they've granted write
   * access (so actions are attributed to them), refreshing if near expiry.
   * Returns null when the user hasn't personally connected — callers then fall
   * back to the shared workspace connection token.
   */
  async userAccessTokenFor(userId: string): Promise<string | null> {
    const link = await this.prisma.atlassianAccountLink.findUnique({ where: { userId } });
    if (!link?.accessTokenEnc || !link.refreshTokenEnc) return null;
    if (!link.scopes?.includes('write:jira-work')) return null;

    const expiresSoon =
      !link.tokenExpiresAt || link.tokenExpiresAt.getTime() < Date.now() + 60_000;
    if (!expiresSoon) return decryptToken(link.accessTokenEnc);

    try {
      const fresh = await this.api.refreshTokens(decryptToken(link.refreshTokenEnc));
      await this.prisma.atlassianAccountLink.update({
        where: { userId },
        data: {
          accessTokenEnc: encryptToken(fresh.accessToken),
          refreshTokenEnc: encryptToken(fresh.refreshToken),
          scopes: fresh.scopes,
          tokenExpiresAt: new Date(Date.now() + fresh.expiresInSeconds * 1000),
        },
      });
      return fresh.accessToken;
    } catch {
      return null; // fall back to the workspace connection token
    }
  }

  // ---------- member-facing helpers ----------

  async linkedUserByAccountId(accountId: string) {
    const link = await this.prisma.atlassianAccountLink.findUnique({
      where: { atlassianAccountId: accountId },
      include: { user: true },
    });
    return link ? toUserDto(link.user) : null;
  }
}
