import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { SsoConnection, User } from '@prisma/client';
import type { SsoConnectionDto, SsoConnectionInput, SsoDiscoveryDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';
import { RedisClient } from '../redis/redis.module';
import { TokenService } from '../auth/token.service';
import { decryptToken, encryptToken } from '../atlassian/crypto';
import { privateOutboundAllowed, safeGetText, safeRequest, validatePublicUrl } from '../common/safe-http';
import { DomainsService, emailDomain } from './domains.service';
import {
  parseDiscovery,
  pkceChallenge,
  randomUrlToken,
  trimSlash,
  verifyIdToken,
  type IdTokenClaims,
  type Jwk,
  type OidcDiscovery,
} from './oidc';

const STATE_TTL_S = 600;
const HTTP = { timeoutMs: 10_000, maxBytes: 512 * 1024, maxRedirects: 2 };
const JWKS_TTL_MS = 10 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PendingLogin {
  workspaceId: string;
  nonce: string;
  verifier: string;
}

/** Thrown for any sign-in failure; `reason` becomes ?error=sso-<reason> on the login page. */
export class SsoLoginError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
  }
}

const schemes = () => (privateOutboundAllowed() ? ['https:', 'http:'] : ['https:']);
const webOrigin = () => process.env.WEB_ORIGIN ?? 'http://localhost:3000';
export const ssoRedirectUri = () =>
  `${trimSlash(process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`)}/auth/sso/callback`;

/**
 * OpenID Connect single sign-on, one IdP per workspace (Okta, Entra ID, Google
 * Workspace, Auth0, Keycloak, …). Authorization-code flow with PKCE, state and
 * nonce; the ID token signature is checked against the IdP's JWKS.
 *
 * Accounts are matched by (issuer, subject) once linked; the first sign-in
 * links by email — but only for emails on the workspace's DNS-verified domains,
 * so an IdP can't assert someone else's address.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly redis: RedisClient,
    private readonly tokens: TokenService,
    private readonly domains: DomainsService,
  ) {}

  // ---------- configuration ----------

  async getConnection(userId: string, workspaceId: string): Promise<SsoConnectionDto | null> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const conn = await this.prisma.ssoConnection.findUnique({ where: { workspaceId } });
    return conn ? toDto(conn) : null;
  }

  async saveConnection(userId: string, workspaceId: string, input: SsoConnectionInput): Promise<SsoConnectionDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'OWNER');
    const existing = await this.prisma.ssoConnection.findUnique({ where: { workspaceId } });
    if (!existing && !input.clientSecret) throw new BadRequestException('Enter the client secret');

    const problem = validatePublicUrl(input.issuer, schemes());
    if (problem) throw new BadRequestException(problem);
    let discovery: OidcDiscovery;
    try {
      discovery = await this.discovery(input.issuer);
    } catch (err) {
      throw new BadRequestException(
        `Couldn't read ${trimSlash(input.issuer)}/.well-known/openid-configuration — ${errText(err)}`,
      );
    }
    if (input.enforced) {
      const verified = await this.prisma.workspaceDomain.count({ where: { workspaceId, verifiedAt: { not: null } } });
      if (verified === 0) throw new BadRequestException('Verify at least one domain before enforcing SSO');
    }

    const data = {
      issuer: discovery.issuer,
      clientId: input.clientId,
      enforced: input.enforced,
      ...(input.clientSecret ? { clientSecretEnc: encryptToken(input.clientSecret) } : {}),
    };
    const conn = existing
      ? await this.prisma.ssoConnection.update({ where: { workspaceId }, data })
      : await this.prisma.ssoConnection.create({
          data: { workspaceId, ...data, clientSecretEnc: encryptToken(input.clientSecret!) },
        });
    this.audit.record(workspaceId, userId, 'sso.update', {
      targetType: 'workspace',
      targetId: workspaceId,
      meta: { issuer: conn.issuer, enforced: conn.enforced },
    });
    return toDto(conn);
  }

  async deleteConnection(userId: string, workspaceId: string): Promise<{ ok: boolean }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'OWNER');
    await this.prisma.ssoConnection.deleteMany({ where: { workspaceId } });
    this.audit.record(workspaceId, userId, 'sso.delete', { targetType: 'workspace', targetId: workspaceId });
    return { ok: true };
  }

  // ---------- sign-in ----------

  async discover(email: string): Promise<SsoDiscoveryDto> {
    const none = { sso: false, enforced: false, workspaceId: null };
    if (!EMAIL_RE.test(email)) return none;
    const workspaceId = await this.domains.verifiedOwner(email);
    if (!workspaceId) return none;
    const conn = await this.prisma.ssoConnection.findUnique({ where: { workspaceId } });
    return conn ? { sso: true, enforced: conn.enforced, workspaceId } : none;
  }

  /** Build the IdP authorization URL and remember the state for the callback. */
  async startUrl(workspaceId: string, loginHint?: string): Promise<string> {
    const conn = await this.prisma.ssoConnection.findUnique({ where: { workspaceId } });
    if (!conn) throw new SsoLoginError('not-configured', 'SSO is not set up for this workspace');
    const discovery = await this.discovery(conn.issuer);
    const pending: PendingLogin = { workspaceId, nonce: randomUrlToken(16), verifier: randomUrlToken(48) };
    const state = randomUrlToken(24);
    await this.redis.set(`sso:state:${state}`, JSON.stringify(pending), 'EX', STATE_TTL_S);

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', conn.clientId);
    url.searchParams.set('redirect_uri', ssoRedirectUri());
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', pending.nonce);
    url.searchParams.set('code_challenge', pkceChallenge(pending.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    if (loginHint && EMAIL_RE.test(loginHint)) url.searchParams.set('login_hint', loginHint);
    return url.toString();
  }

  /** Finish the code flow; returns where to send the browser (web /sso#… on success). */
  async handleCallback(code: string, state: string): Promise<string> {
    const pending = await this.takeState(state);
    const conn = await this.prisma.ssoConnection.findUnique({ where: { workspaceId: pending.workspaceId } });
    if (!conn) throw new SsoLoginError('not-configured', 'SSO was removed for this workspace');
    const discovery = await this.discovery(conn.issuer);

    const idToken = await this.exchangeCode(discovery, conn, code, pending.verifier);
    const claims = await this.validate(discovery, conn, idToken, pending.nonce);
    const user = await this.resolveUser(conn, claims);

    const accessToken = await this.tokens.signAccessToken(user);
    const refreshToken = await this.tokens.issueRefreshToken(user.id);
    this.audit.record(conn.workspaceId, user.id, 'sso.login', { targetType: 'user', targetId: user.id });
    const fragment = new URLSearchParams({ access: accessToken, refresh: refreshToken, ws: conn.workspaceId });
    return `${webOrigin()}/sso#${fragment.toString()}`;
  }

  private async takeState(state: string): Promise<PendingLogin> {
    if (!state || state.length > 100) throw new SsoLoginError('state', 'Missing sign-in state');
    const key = `sso:state:${state}`;
    // Single use: read and delete atomically.
    const res = await this.redis.multi().get(key).del(key).exec();
    const raw = res?.[0]?.[1];
    if (typeof raw !== 'string') throw new SsoLoginError('expired', 'The sign-in link expired — try again');
    return JSON.parse(raw) as PendingLogin;
  }

  private async exchangeCode(
    discovery: OidcDiscovery,
    conn: SsoConnection,
    code: string,
    verifier: string,
  ): Promise<string> {
    const secret = decryptToken(conn.clientSecretEnc);
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ssoRedirectUri(),
      code_verifier: verifier,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    const methods = discovery.token_endpoint_auth_methods_supported;
    if (methods && !methods.includes('client_secret_basic') && methods.includes('client_secret_post')) {
      form.set('client_id', conn.clientId);
      form.set('client_secret', secret);
    } else {
      // RFC 6749 §2.3.1: form-encode each part before base64.
      const basic = `${encodeURIComponent(conn.clientId)}:${encodeURIComponent(secret)}`;
      headers.Authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
    }
    const body = form.toString();
    headers['Content-Length'] = String(Buffer.byteLength(body));
    const res = await safeRequest(discovery.token_endpoint, {
      method: 'POST',
      schemes: schemes(),
      headers,
      body,
      timeoutMs: HTTP.timeoutMs,
      maxBytes: HTTP.maxBytes,
    }).catch((err) => {
      throw new SsoLoginError('idp', `Token request failed: ${errText(err)}`);
    });
    let json: { id_token?: unknown; error?: unknown; error_description?: unknown };
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new SsoLoginError('idp', `Token endpoint returned HTTP ${res.status} (not JSON)`);
    }
    if (res.status !== 200 || typeof json.id_token !== 'string') {
      throw new SsoLoginError('idp', `Token endpoint error: ${String(json.error_description ?? json.error ?? res.status)}`);
    }
    return json.id_token;
  }

  private async validate(
    discovery: OidcDiscovery,
    conn: SsoConnection,
    idToken: string,
    nonce: string,
  ): Promise<IdTokenClaims> {
    const expected = { issuer: conn.issuer, clientId: conn.clientId, nonce };
    try {
      return verifyIdToken(idToken, await this.jwks(discovery.jwks_uri), expected);
    } catch (first) {
      // The IdP may have rotated keys since we cached them: refetch once.
      if (!/signing key|signature/.test(errText(first))) throw new SsoLoginError('token', errText(first));
      try {
        return verifyIdToken(idToken, await this.jwks(discovery.jwks_uri, true), expected);
      } catch (err) {
        throw new SsoLoginError('token', errText(err));
      }
    }
  }

  private async resolveUser(conn: SsoConnection, claims: IdTokenClaims): Promise<User> {
    const linked = await this.prisma.ssoIdentity.findUnique({
      where: { issuer_subject: { issuer: conn.issuer, subject: claims.sub } },
      include: { user: true },
    });
    let user = linked?.user ?? null;

    if (!user) {
      const email = claimedEmail(claims);
      if (!email) throw new SsoLoginError('no-email', 'Your identity provider did not share an email address');
      if (claims.email_verified === false || claims.email_verified === 'false') {
        throw new SsoLoginError('unverified', 'Your identity provider says this email is not verified');
      }
      if (!(await this.domains.isVerifiedFor(conn.workspaceId, email))) {
        throw new SsoLoginError(
          'domain',
          `${emailDomain(email)} is not a verified domain of this workspace — ask an admin to verify it`,
        );
      }
      user =
        (await this.prisma.user.findUnique({ where: { email } })) ??
        (await this.prisma.user.create({
          data: { email, displayName: claimedName(claims) ?? email.split('@')[0], passwordHash: null },
        }));
      await this.prisma.ssoIdentity.create({
        data: { userId: user.id, issuer: conn.issuer, subject: claims.sub },
      });
    }
    if (user.isBot) throw new SsoLoginError('denied', 'This account cannot sign in');

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: conn.workspaceId, userId: user.id } },
    });
    if (member?.deactivatedAt) throw new SsoLoginError('deactivated', 'Your account in this workspace is deactivated');
    if (!member) {
      await this.prisma.workspaceMember.create({
        data: { workspaceId: conn.workspaceId, userId: user.id, role: 'MEMBER' },
      });
    }
    if (user.isProvisional) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { isProvisional: false, displayName: claimedName(claims) ?? user.displayName },
      });
    }
    // The IdP vouching for this exact address on a verified domain proves ownership.
    const asserted = claimedEmail(claims);
    if (
      !user.emailVerifiedAt &&
      asserted === user.email.toLowerCase() &&
      claims.email_verified !== false &&
      claims.email_verified !== 'false' &&
      (await this.domains.isVerifiedFor(conn.workspaceId, asserted))
    ) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }
    return user;
  }

  private async discovery(issuer: string): Promise<OidcDiscovery> {
    const raw = await safeGetText(`${trimSlash(issuer)}/.well-known/openid-configuration`, {
      schemes: schemes(),
      ...HTTP,
    });
    const doc = parseDiscovery(raw);
    if (trimSlash(doc.issuer) !== trimSlash(issuer)) {
      throw new Error(`the document's issuer (${doc.issuer}) does not match`);
    }
    for (const url of [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri]) {
      const problem = validatePublicUrl(url, schemes());
      if (problem) throw new Error(`${url}: ${problem}`);
    }
    return doc;
  }

  private async jwks(uri: string, refresh = false): Promise<Jwk[]> {
    const cached = this.jwksCache.get(uri);
    if (!refresh && cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
    const raw = await safeGetText(uri, { schemes: schemes(), ...HTTP });
    const keys = (JSON.parse(raw) as { keys?: Jwk[] }).keys;
    if (!Array.isArray(keys)) throw new SsoLoginError('idp', 'The IdP key set is malformed');
    this.jwksCache.set(uri, { keys, at: Date.now() });
    return keys;
  }

  logFailure(err: unknown) {
    this.logger.warn(`SSO sign-in failed: ${errText(err)}`);
  }
}

function claimedEmail(c: IdTokenClaims): string | null {
  for (const v of [c.email, c.preferred_username]) {
    if (typeof v === 'string' && EMAIL_RE.test(v.trim())) return v.trim().toLowerCase();
  }
  return null;
}

function claimedName(c: IdTokenClaims): string | null {
  if (typeof c.name === 'string' && c.name.trim()) return c.name.trim().slice(0, 80);
  const parts = [c.given_name, c.family_name].filter((p): p is string => typeof p === 'string' && !!p.trim());
  return parts.length ? parts.join(' ').slice(0, 80) : null;
}

function toDto(c: SsoConnection): SsoConnectionDto {
  return { issuer: c.issuer, clientId: c.clientId, enforced: c.enforced, redirectUri: ssoRedirectUri() };
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
