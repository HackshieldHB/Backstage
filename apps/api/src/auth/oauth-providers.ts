import { verifyIdToken, type Jwk } from '../security/oidc';

/**
 * "Sign in with Google / GitHub" provider adapters. Pure HTTP + validation —
 * account linking and session issuing live in SocialLoginService.
 *
 * Both use the authorization-code flow with PKCE (S256). Google additionally
 * returns an OpenID Connect ID token, which is signature-checked against
 * Google's published keys; GitHub has no ID token, so the profile and the
 * *verified* email list are read from its REST API with the fresh access token.
 */

export type OAuthProviderId = 'google' | 'github';

/** What a provider tells us about the person, after validation. */
export interface ProviderProfile {
  /** Stable per-provider user id (Google `sub`, GitHub numeric id). */
  subject: string;
  /** Lower-cased email the provider says is verified, or null if none. */
  verifiedEmail: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Shown in "Connected accounts" (email or @login). */
  label: string;
}

const HTTP_TIMEOUT_MS = 10_000;
const UA = 'Backstages/1.0';

export const GOOGLE = {
  /** Stored as SsoIdentity.issuer for Google identities. */
  issuer: 'https://accounts.google.com',
  /** Google signs ID tokens with either spelling. */
  acceptedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
};

export const GITHUB = {
  /** Stored as SsoIdentity.issuer for GitHub identities. */
  issuer: 'https://github.com',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  apiUrl: 'https://api.github.com',
};

export const issuerFor = (p: OAuthProviderId) => (p === 'google' ? GOOGLE.issuer : GITHUB.issuer);
export const providerForIssuer = (iss: string): OAuthProviderId | null =>
  iss === GOOGLE.issuer ? 'google' : iss === GITHUB.issuer ? 'github' : null;

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/** Credentials from the environment, or null when the provider is off. */
export function providerCredentials(p: OAuthProviderId): ProviderCredentials | null {
  const id = p === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.GITHUB_CLIENT_ID;
  const secret = p === 'google' ? process.env.GOOGLE_CLIENT_SECRET : process.env.GITHUB_CLIENT_SECRET;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

export function authorizeUrl(
  p: OAuthProviderId,
  creds: ProviderCredentials,
  opts: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
    nonce: string;
    loginHint?: string;
    /** Override the default scopes (GitHub "connect to create issues" needs repo). */
    scope?: string;
    /** Google: ask for a refresh token (calendar sync runs while you're away). */
    offline?: boolean;
  },
): string {
  const url = new URL(p === 'google' ? GOOGLE.authorizeUrl : GITHUB.authorizeUrl);
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (p === 'google') {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', opts.scope ?? 'openid email profile');
    url.searchParams.set('nonce', opts.nonce);
    if (opts.offline) {
      url.searchParams.set('access_type', 'offline');
      // Google only returns a refresh token on a fresh consent.
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('include_granted_scopes', 'true');
    } else {
      url.searchParams.set('prompt', 'select_account');
    }
    if (opts.loginHint) url.searchParams.set('login_hint', opts.loginHint);
  } else {
    // user:email is required to read the (verified) email list.
    url.searchParams.set('scope', opts.scope ?? 'read:user user:email');
    url.searchParams.set('allow_signup', 'true');
    if (opts.loginHint) url.searchParams.set('login', opts.loginHint);
  }
  return url.toString();
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`token endpoint returned HTTP ${res.status} (not JSON)`);
  }
  // GitHub reports errors with HTTP 200 and an `error` field.
  if (!res.ok || json.error) {
    throw new Error(`token endpoint error: ${String(json.error_description ?? json.error ?? res.status)}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

let googleKeys: { keys: Jwk[]; at: number } | null = null;
const JWKS_TTL_MS = 60 * 60_000;

async function googleJwks(refresh = false): Promise<Jwk[]> {
  if (!refresh && googleKeys && Date.now() - googleKeys.at < JWKS_TTL_MS) return googleKeys.keys;
  const res = await fetch(GOOGLE.jwksUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google key set: HTTP ${res.status}`);
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys;
  if (!Array.isArray(keys)) throw new Error('Google key set is malformed');
  googleKeys = { keys, at: Date.now() };
  return keys;
}

/** For tests: forget cached Google keys. */
export function resetGoogleKeyCache(): void {
  googleKeys = null;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  scope: string;
  profile: ProviderProfile;
}

export async function googleProfile(
  creds: ProviderCredentials,
  code: string,
  opts: { redirectUri: string; codeVerifier: string; nonce: string },
): Promise<ProviderProfile> {
  return (await googleExchange(creds, code, opts)).profile;
}

/** Code → tokens (+ the verified ID token's profile). */
export async function googleExchange(
  creds: ProviderCredentials,
  code: string,
  opts: { redirectUri: string; codeVerifier: string; nonce: string },
): Promise<GoogleTokens> {
  const tokens = await postForm(GOOGLE.tokenUrl, {
    grant_type: 'authorization_code',
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  const idToken = tokens.id_token;
  if (typeof idToken !== 'string') throw new Error('Google did not return an ID token');

  const expected = { issuer: GOOGLE.acceptedIssuers, clientId: creds.clientId, nonce: opts.nonce };
  let claims;
  try {
    claims = verifyIdToken(idToken, await googleJwks(), expected);
  } catch (first) {
    // Google rotates keys; refetch once if the signing key wasn't in our cache.
    if (!/signing key|signature/.test(String((first as Error).message))) throw first;
    claims = verifyIdToken(idToken, await googleJwks(true), expected);
  }

  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
  // Google: trust the email only when email_verified is true.
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  const picture = (claims as unknown as { picture?: unknown }).picture;
  const profile: ProviderProfile = {
    subject: claims.sub,
    verifiedEmail: email && verified ? email : null,
    displayName: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 80) : null,
    avatarUrl: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
    label: email ?? 'Google account',
  };
  if (typeof tokens.access_token !== 'string') throw new Error('Google did not return an access token');
  return {
    accessToken: tokens.access_token,
    refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null,
    expiresInSeconds: typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600,
    scope: typeof tokens.scope === 'string' ? tokens.scope : '',
    profile,
  };
}

/** Exchange a refresh token for a fresh access token. Throws GoogleGrantError when revoked. */
export async function googleRefresh(
  creds: ProviderCredentials,
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const res = await fetch(GOOGLE.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (json.error === 'invalid_grant') throw new GoogleGrantError('Google access was revoked');
  if (!res.ok || typeof json.access_token !== 'string') throw new Error(`Google token refresh failed: ${json.error ?? res.status}`);
  return { accessToken: json.access_token, expiresInSeconds: json.expires_in ?? 3600 };
}

/** The refresh token no longer works (revoked or expired): reconnect needed. */
export class GoogleGrantError extends Error {}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

async function githubGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}
interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** Trade a GitHub authorization code for an access token (+ the scopes granted). */
export async function githubExchange(
  creds: ProviderCredentials,
  code: string,
  opts: { redirectUri: string; codeVerifier: string },
): Promise<{ accessToken: string; scope: string }> {
  const tokens = await postForm(GITHUB.tokenUrl, {
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  const accessToken = tokens.access_token;
  if (typeof accessToken !== 'string') throw new Error('GitHub did not return an access token');
  return { accessToken, scope: typeof tokens.scope === 'string' ? tokens.scope : '' };
}

export async function githubProfile(
  creds: ProviderCredentials,
  code: string,
  opts: { redirectUri: string; codeVerifier: string },
): Promise<ProviderProfile> {
  const { accessToken } = await githubExchange(creds, code, opts);
  return githubProfileFromToken(accessToken);
}

/** Profile + verified email for a GitHub access token. */
export async function githubProfileFromToken(accessToken: string): Promise<ProviderProfile> {
  const [user, emails] = await Promise.all([
    githubGet<GithubUser>('/user', accessToken),
    githubGet<GithubEmail[]>('/user/emails?per_page=100', accessToken),
  ]);
  if (typeof user?.id !== 'number') throw new Error('GitHub returned no user id');
  // Only a verified address counts; prefer the primary one.
  const verified = (Array.isArray(emails) ? emails : []).filter((e) => e.verified && typeof e.email === 'string');
  const pick = verified.find((e) => e.primary) ?? verified[0];
  const email = pick ? pick.email.trim().toLowerCase() : null;
  // GitHub's "private email" relay addresses can't receive mail from us.
  const usable = email && !email.endsWith('@users.noreply.github.com') ? email : null;
  return {
    subject: String(user.id),
    verifiedEmail: usable,
    displayName: (user.name?.trim() || user.login).slice(0, 80),
    avatarUrl: user.avatar_url?.startsWith('https://') ? user.avatar_url : null,
    label: `@${user.login}`,
  };
}
