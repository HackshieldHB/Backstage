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
import { TokenService } from '../auth/token.service';
import { toUserDto } from '../auth/auth.service';

const CONNECT_SCOPES = ['read:jira-user', 'read:jira-work', 'write:jira-work', 'offline_access'];
const SSO_SCOPES = ['read:me', 'offline_access'];

interface OAuthState {
  kind: 'connect' | 'sso';
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
    const connection = await this.prisma.atlassianConnection.findUnique({
      where: { workspaceId },
      select: { id: true, siteUrl: true, siteName: true, lastSyncAt: true, createdAt: true },
    });
    return { connected: !!connection, connection };
  }

  /** OAuth redirect target for BOTH flows; dispatches on the signed state. */
  async handleCallback(code: string, rawState: string): Promise<{ redirect: string }> {
    let state: OAuthState;
    try {
      state = await this.jwtService.verifyAsync<OAuthState>(rawState);
    } catch {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (state.kind === 'connect') return this.completeConnect(code, state);
    return this.completeSso(code);
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

  // ---------- member-facing helpers ----------

  async linkedUserByAccountId(accountId: string) {
    const link = await this.prisma.atlassianAccountLink.findUnique({
      where: { atlassianAccountId: accountId },
      include: { user: true },
    });
    return link ? toUserDto(link.user) : null;
  }
}
