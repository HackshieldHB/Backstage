import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import type {
  AuthResponse,
  ConnectedAccountsDto,
  MfaChallengeDto,
  OAuthProvider,
  OAuthProvidersDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisClient } from '../redis/redis.module';
import { pkceChallenge, randomUrlToken, trimSlash } from '../security/oidc';
import { ssoEnforcedFor } from '../security/sso-policy';
import { sha256, TokenService } from './token.service';
import { toUserDto } from './auth.service';
import { encryptToken } from '../atlassian/crypto';
import {
  authorizeUrl,
  googleExchange,
  type GoogleTokens,
  githubExchange,
  githubProfile,
  githubProfileFromToken,
  googleProfile,
  issuerFor,
  providerCredentials,
  providerForIssuer,
  type ProviderProfile,
} from './oauth-providers';

const STATE_TTL_S = 600;
const LOGIN_CODE_TTL_S = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PendingAuth {
  provider: OAuthProvider;
  /** login: sign in/up. link: add this provider to the signed-in account.
   *  connect: GitHub only — keep a token so the person can create issues. */
  mode: 'login' | 'link' | 'connect';
  /** Link/connect mode: who started it. The browser must confirm with this session. */
  userId?: string;
  verifier: string;
  nonce: string;
  /** Login mode: sha256 of the browser-binding cookie set at start. */
  browserHash?: string;
}

/** Read/write events on the person's calendars (no access to calendar settings). */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export interface PendingGoogleCalendar {
  googleSub: string;
  email: string;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: string;
  scopes: string;
}

/** A sign-in failure; `reason` becomes ?error=oauth-<reason> on the login page. */
export class SocialLoginError extends Error {
  /** Which flow failed, once known from the stored state (decides where to report it). */
  mode?: 'login' | 'link' | 'connect';
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

const webOrigin = () => trimSlash(process.env.WEB_ORIGIN ?? 'http://localhost:3000');
export const oauthRedirectUri = (p: OAuthProvider) =>
  `${trimSlash(process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`)}/auth/oauth/${p}/callback`;

/**
 * "Continue with Google / GitHub" — sign up, sign in, and link to an account.
 *
 * Security properties (each guards a known OAuth attack):
 *  - Authorization-code flow with PKCE, single-use `state` (and a nonce for
 *    Google's ID token): stolen or replayed codes are useless.
 *  - Login is bound to the browser that started it (HttpOnly cookie checked at
 *    the callback), so nobody can finish *their* login in *your* browser.
 *  - Linking an account to an existing user is confirmed by that user's own
 *    session, never by the callback alone (link-CSRF).
 *  - Identities are keyed by the provider's stable user id; an existing account
 *    is matched by email only when the provider says the email is verified, and
 *    never when it's an unverified password account (pre-account hijacking:
 *    someone could have registered your address first).
 *  - Sessions are never put in URLs: the callback hands out a one-time code
 *    the web app exchanges, and 2FA / "SSO required" policies still apply.
 */
@Injectable()
export class SocialLoginService {
  private readonly logger = new Logger(SocialLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClient,
    private readonly tokens: TokenService,
  ) {}

  providers(): OAuthProvidersDto {
    return { google: !!providerCredentials('google'), github: !!providerCredentials('github') };
  }

  // ---------- start ----------

  /** Begin sign-in. Returns the provider URL and the browser-binding secret to set as a cookie. */
  async startLogin(provider: OAuthProvider, loginHint?: string): Promise<{ url: string; browserSecret: string }> {
    const browserSecret = randomUrlToken(24);
    const url = await this.start({ provider, mode: 'login', browserHash: sha256(browserSecret) }, loginHint);
    return { url, browserSecret };
  }

  /** Begin linking a provider to the signed-in user. */
  async startLink(userId: string, provider: OAuthProvider): Promise<{ url: string }> {
    return { url: await this.start({ provider, mode: 'link', userId }) };
  }

  /**
   * Connect a GitHub account with repo access so the person can create issues as
   * themselves. Confirmed by the signed-in session, like linking.
   */
  async startGithubConnect(userId: string): Promise<{ url: string }> {
    return { url: await this.start({ provider: 'github', mode: 'connect', userId }, undefined, 'repo read:user user:email') };
  }

  /** Connect Google Calendar (calendar.events + offline access) for two-way sync. */
  async startGoogleCalendarConnect(userId: string): Promise<{ url: string }> {
    return {
      url: await this.start({ provider: 'google', mode: 'connect', userId }, undefined, `openid email ${GOOGLE_CALENDAR_SCOPE}`, true),
    };
  }

  /** Called by the signed-in app with the code from /app?google-calendar=… */
  async takeGoogleCalendarConnect(userId: string, code: string): Promise<PendingGoogleCalendar> {
    const raw = await this.takeOnce(`oauth:gconnect:${sha256(code)}`);
    if (!raw) throw new BadRequestException('This request expired — try connecting Google Calendar again');
    const pending = JSON.parse(raw) as PendingGoogleCalendar & { userId: string };
    if (pending.userId !== userId) throw new BadRequestException('This request belongs to another account');
    return pending;
  }

  /** Called by the signed-in app with the code from /app?github-connect=… */
  async takeGithubConnect(
    userId: string,
    code: string,
  ): Promise<{ githubUserId: string; login: string; accessTokenEnc: string; scopes: string }> {
    const raw = await this.takeOnce(`oauth:connect:${sha256(code)}`);
    if (!raw) throw new BadRequestException('This request expired — try connecting GitHub again');
    const pending = JSON.parse(raw) as { userId: string; githubUserId: string; login: string; accessTokenEnc: string; scopes: string };
    if (pending.userId !== userId) throw new BadRequestException('This request belongs to another account');
    return pending;
  }

  private async start(
    base: Pick<PendingAuth, 'provider' | 'mode' | 'userId' | 'browserHash'>,
    loginHint?: string,
    scope?: string,
    offline?: boolean,
  ): Promise<string> {
    const creds = providerCredentials(base.provider);
    if (!creds) throw new SocialLoginError('not-configured', `${label(base.provider)} sign-in is not set up`);
    const pending: PendingAuth = { ...base, verifier: randomUrlToken(48), nonce: randomUrlToken(16) };
    const state = randomUrlToken(24);
    await this.redis.set(`oauth:state:${state}`, JSON.stringify(pending), 'EX', STATE_TTL_S);
    return authorizeUrl(base.provider, creds, {
      redirectUri: oauthRedirectUri(base.provider),
      state,
      codeChallenge: pkceChallenge(pending.verifier),
      nonce: pending.nonce,
      loginHint: loginHint && EMAIL_RE.test(loginHint) ? loginHint : undefined,
      scope,
      offline,
    });
  }

  // ---------- callback ----------

  /**
   * Finish the provider round-trip. Returns where to send the browser:
   *  - login: `<web>/sso#code=…` (exchanged by the web app for a session)
   *  - link:  `<web>/app?oauth-link=…` (confirmed by the signed-in web app)
   */
  async handleCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
    browserSecret: string | undefined,
  ): Promise<{ redirect: string; mode: 'login' | 'link' | 'connect' }> {
    const pending = await this.takeState(state);
    try {
      return await this.finishCallback(provider, code, pending, browserSecret);
    } catch (err) {
      if (err instanceof SocialLoginError) err.mode = pending.mode;
      throw err;
    }
  }

  /** The provider sent the person back without a code (cancelled): spend the state
   *  and say which flow it was, so the error is shown in the right place. */
  async abandon(state: string | undefined): Promise<PendingAuth['mode'] | null> {
    if (!state || state.length > 100) return null;
    const raw = await this.takeOnce(`oauth:state:${state}`);
    return raw ? (JSON.parse(raw) as PendingAuth).mode : null;
  }

  private async finishCallback(
    provider: OAuthProvider,
    code: string,
    pending: PendingAuth,
    browserSecret: string | undefined,
  ): Promise<{ redirect: string; mode: 'login' | 'link' | 'connect' }> {
    if (pending.provider !== provider) throw new SocialLoginError('state', 'Sign-in state does not match');
    if (pending.mode === 'login' && (!browserSecret || sha256(browserSecret) !== pending.browserHash)) {
      throw new SocialLoginError('browser', 'This sign-in was started in a different browser — start again here');
    }
    if (pending.mode === 'connect') {
      return pending.provider === 'github' ? this.finishGithubConnect(code, pending) : this.finishGoogleConnect(code, pending);
    }
    const profile = await this.fetchProfile(provider, code, pending);


    if (pending.mode === 'link') {
      const linkCode = randomUrlToken(32);
      await this.redis.set(
        `oauth:link:${sha256(linkCode)}`,
        JSON.stringify({ userId: pending.userId, provider, profile }),
        'EX',
        LOGIN_CODE_TTL_S,
      );
      return { redirect: `${webOrigin()}/app?oauth-link=${encodeURIComponent(linkCode)}`, mode: 'link' };
    }

    const user = await this.resolveUser(provider, profile);
    return { redirect: await this.loginRedirect(user), mode: 'login' };
  }

  /**
   * Hand a signed-in user to the web app via a one-time code (also used by
   * "Log in with Atlassian"). Enforces the "SSO required" policy first.
   */
  async loginRedirect(user: User): Promise<string> {
    if (user.isBot) throw new SocialLoginError('denied', 'This account cannot sign in');
    if (await ssoEnforcedFor(this.prisma, user.email, user.id)) {
      throw new SocialLoginError('sso-required', 'Your organization requires single sign-on');
    }
    const code = randomUrlToken(32);
    await this.redis.set(`oauth:login:${sha256(code)}`, JSON.stringify({ userId: user.id }), 'EX', LOGIN_CODE_TTL_S);
    return `${webOrigin()}/sso#code=${encodeURIComponent(code)}`;
  }

  /** Trade the one-time code for a session — or a 2FA challenge if the account has 2FA on. */
  async exchange(code: string): Promise<AuthResponse | MfaChallengeDto> {
    const raw = await this.takeOnce(`oauth:login:${sha256(code)}`);
    if (!raw) throw new UnauthorizedException('This sign-in link expired — please sign in again');
    const { userId } = JSON.parse(raw) as { userId: string };
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isBot) throw new UnauthorizedException('This account cannot sign in');
    if (user.totpEnabledAt) {
      return { mfaRequired: true, mfaToken: await this.tokens.signMfaToken(user) };
    }
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccessToken(user),
      this.tokens.issueRefreshToken(user.id),
    ]);
    return { user: toUserDto(user), accessToken, refreshToken };
  }

  /** Called by the signed-in web app to finish linking. */
  async confirmLink(userId: string, code: string): Promise<ConnectedAccountsDto> {
    const raw = await this.takeOnce(`oauth:link:${sha256(code)}`);
    if (!raw) throw new BadRequestException('This link request expired — try connecting again');
    const pending = JSON.parse(raw) as { userId: string; provider: OAuthProvider; profile: ProviderProfile };
    // Only the person who started the link may complete it (link-CSRF guard).
    if (pending.userId !== userId) throw new BadRequestException('This link request belongs to another account');

    const issuer = issuerFor(pending.provider);
    const existing = await this.prisma.ssoIdentity.findUnique({
      where: { issuer_subject: { issuer, subject: pending.profile.subject } },
    });
    if (existing && existing.userId !== userId) {
      throw new BadRequestException(`That ${label(pending.provider)} account is already connected to another Backstages account`);
    }
    if (!existing) {
      const sameProvider = await this.prisma.ssoIdentity.findFirst({ where: { userId, issuer } });
      if (sameProvider) {
        throw new BadRequestException(`A different ${label(pending.provider)} account is already connected — disconnect it first`);
      }
      await this.prisma.ssoIdentity.create({
        data: { userId, issuer, subject: pending.profile.subject, label: pending.profile.label },
      });
    }
    return this.connected(userId);
  }

  private async finishGoogleConnect(code: string, pending: PendingAuth): Promise<{ redirect: string; mode: 'connect' }> {
    const creds = providerCredentials('google');
    if (!creds || !pending.userId) throw new SocialLoginError('not-configured', 'Google is not set up');
    let tokens: GoogleTokens;
    try {
      tokens = await googleExchange(creds, code, {
        redirectUri: oauthRedirectUri('google'),
        codeVerifier: pending.verifier,
        nonce: pending.nonce,
      });
    } catch (err) {
      throw new SocialLoginError('provider', `Google Calendar connection failed: ${errText(err)}`);
    }
    // Google's consent screen lets people untick individual permissions.
    if (!tokens.scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) {
      throw new SocialLoginError('scope', 'Calendar access was not granted');
    }
    if (!tokens.refreshToken) throw new SocialLoginError('provider', 'Google did not grant offline access');
    const linkCode = randomUrlToken(32);
    const payload: PendingGoogleCalendar & { userId: string } = {
      userId: pending.userId,
      googleSub: tokens.profile.subject,
      email: tokens.profile.verifiedEmail ?? tokens.profile.label,
      refreshTokenEnc: encryptToken(tokens.refreshToken),
      accessTokenEnc: encryptToken(tokens.accessToken),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString(),
      scopes: tokens.scope,
    };
    await this.redis.set(`oauth:gconnect:${sha256(linkCode)}`, JSON.stringify(payload), 'EX', LOGIN_CODE_TTL_S);
    return { redirect: `${webOrigin()}/app?google-calendar=${encodeURIComponent(linkCode)}`, mode: 'connect' };
  }

  private async finishGithubConnect(code: string, pending: PendingAuth): Promise<{ redirect: string; mode: 'connect' }> {
    const creds = providerCredentials('github');
    if (pending.provider !== 'github' || !creds || !pending.userId) {
      throw new SocialLoginError('not-configured', 'GitHub is not set up');
    }
    let token: { accessToken: string; scope: string };
    let profile: ProviderProfile;
    try {
      token = await githubExchange(creds, code, { redirectUri: oauthRedirectUri('github'), codeVerifier: pending.verifier });
      profile = await githubProfileFromToken(token.accessToken);
    } catch (err) {
      throw new SocialLoginError('provider', `GitHub connection failed: ${errText(err)}`);
    }
    const linkCode = randomUrlToken(32);
    await this.redis.set(
      `oauth:connect:${sha256(linkCode)}`,
      JSON.stringify({
        userId: pending.userId,
        githubUserId: profile.subject,
        login: profile.label.replace(/^@/, ''),
        // Never keep a plaintext token, even for two minutes.
        accessTokenEnc: encryptToken(token.accessToken),
        scopes: token.scope,
      }),
      'EX',
      LOGIN_CODE_TTL_S,
    );
    return { redirect: `${webOrigin()}/app?github-connect=${encodeURIComponent(linkCode)}`, mode: 'connect' };
  }

  // ---------- connected accounts ----------

  async connected(userId: string): Promise<ConnectedAccountsDto> {
    const [user, identities] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } }),
      this.prisma.ssoIdentity.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      hasPassword: !!user.passwordHash,
      providers: this.providers(),
      accounts: identities.map((i) => ({
        id: i.id,
        provider: providerForIssuer(i.issuer) ?? 'sso',
        label: i.label,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  /** Disconnect a social login, unless it's the account's only way in. */
  async unlink(userId: string, identityId: string): Promise<ConnectedAccountsDto> {
    const identity = await this.prisma.ssoIdentity.findFirst({ where: { id: identityId, userId } });
    if (!identity || !providerForIssuer(identity.issuer)) throw new NotFoundException('Connected account not found');
    const [user, others, atlassian] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } }),
      this.prisma.ssoIdentity.count({ where: { userId, id: { not: identityId } } }),
      this.prisma.atlassianAccountLink.count({ where: { userId } }),
    ]);
    if (!user.passwordHash && others === 0 && atlassian === 0) {
      throw new BadRequestException(
        'This is your only way to sign in. Set a password first (Sign out → “Forgot password?”), then disconnect it.',
      );
    }
    await this.prisma.ssoIdentity.delete({ where: { id: identityId } });
    return this.connected(userId);
  }

  // ---------- internals ----------

  private async fetchProfile(provider: OAuthProvider, code: string, pending: PendingAuth): Promise<ProviderProfile> {
    const creds = providerCredentials(provider);
    if (!creds) throw new SocialLoginError('not-configured', `${label(provider)} sign-in is not set up`);
    try {
      return provider === 'google'
        ? await googleProfile(creds, code, {
            redirectUri: oauthRedirectUri(provider),
            codeVerifier: pending.verifier,
            nonce: pending.nonce,
          })
        : await githubProfile(creds, code, { redirectUri: oauthRedirectUri(provider), codeVerifier: pending.verifier });
    } catch (err) {
      throw new SocialLoginError('provider', `${label(provider)} sign-in failed: ${errText(err)}`);
    }
  }

  /** Find or create the user for a provider identity (login mode). */
  async resolveUser(provider: OAuthProvider, profile: ProviderProfile, retried = false): Promise<User> {
    const issuer = issuerFor(provider);
    const linked = await this.prisma.ssoIdentity.findUnique({
      where: { issuer_subject: { issuer, subject: profile.subject } },
      include: { user: true },
    });
    if (linked) {
      if (linked.label !== profile.label) {
        await this.prisma.ssoIdentity.update({ where: { id: linked.id }, data: { label: profile.label } }).catch(() => undefined);
      }
      return linked.user;
    }

    const email = profile.verifiedEmail;
    if (!email || !EMAIL_RE.test(email)) {
      throw new SocialLoginError('no-verified-email', `${label(provider)} did not share a verified email address`);
    }

    try {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.isBot) throw new SocialLoginError('denied', 'This account cannot sign in');
        // Pre-account-hijacking guard: an unverified password account may have
        // been registered by someone else with this address. The owner proves the
        // mailbox first (password + email link, or "Forgot password").
        if (existing.passwordHash && !existing.emailVerifiedAt && !existing.isProvisional) {
          throw new SocialLoginError(
            'unverified-account',
            'An account with this email exists but its email was never confirmed',
          );
        }
        if (await ssoEnforcedFor(this.prisma, email, existing.id)) {
          throw new SocialLoginError('sso-required', 'Your organization requires single sign-on');
        }
        await this.prisma.ssoIdentity.create({
          data: { userId: existing.id, issuer, subject: profile.subject, label: profile.label },
        });
        // The provider verified this exact address, so the person owns it.
        return this.prisma.user.update({
          where: { id: existing.id },
          data: {
            emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
            ...(existing.isProvisional
              ? { isProvisional: false, displayName: profile.displayName ?? existing.displayName }
              : {}),
            ...(existing.avatarUrl ? {} : { avatarUrl: profile.avatarUrl }),
          },
        });
      }

      if (await ssoEnforcedFor(this.prisma, email)) {
        throw new SocialLoginError('sso-required', 'Your organization requires single sign-on');
      }
      return await this.prisma.user.create({
        data: {
          email,
          displayName: profile.displayName ?? email.split('@')[0],
          avatarUrl: profile.avatarUrl,
          passwordHash: null,
          emailVerifiedAt: new Date(),
          ssoIdentities: { create: { issuer, subject: profile.subject, label: profile.label } },
        },
      });
    } catch (err) {
      // Two sign-ins racing to create the same user/identity: the loser retries once.
      if (!retried && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.resolveUser(provider, profile, true);
      }
      throw err;
    }
  }

  private async takeState(state: string): Promise<PendingAuth> {
    if (!state || state.length > 100) throw new SocialLoginError('state', 'Missing sign-in state');
    const raw = await this.takeOnce(`oauth:state:${state}`);
    if (!raw) throw new SocialLoginError('expired', 'The sign-in link expired — try again');
    return JSON.parse(raw) as PendingAuth;
  }

  /** Read and delete a key atomically (single use). */
  private async takeOnce(key: string): Promise<string | null> {
    const res = await this.redis.multi().get(key).del(key).exec();
    const raw = res?.[0]?.[1];
    return typeof raw === 'string' ? raw : null;
  }

  logFailure(err: unknown) {
    this.logger.warn(`Social sign-in failed: ${errText(err)}`);
  }
}

const label = (p: OAuthProvider) => (p === 'google' ? 'Google' : 'GitHub');
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
