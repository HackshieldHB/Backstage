import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { totp } from '../src/auth/totp';
import { GITHUB, GOOGLE, resetGoogleKeyCache } from '../src/auth/oauth-providers';

/**
 * "Continue with Google / GitHub" end to end, with the providers' HTTP endpoints
 * faked at the fetch layer (Google's ID tokens are really RSA-signed and
 * verified against a fake JWKS).
 */
describe('social sign-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const email = (name: string) => `soc-${name}-${run}@test.local`;

  const savedEnv: Record<string, string | undefined> = {};
  const ENV = {
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-client',
    GITHUB_CLIENT_SECRET: 'github-secret',
  };

  // ---- fake providers ----
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'g1', alg: 'RS256', use: 'sig' };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = (claims: Record<string, unknown>, key = privateKey) => {
    const head = b64({ alg: 'RS256', kid: 'g1', typ: 'JWT' });
    const body = b64(claims);
    return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
  };

  /** What the fake Google/GitHub return for the next callback. */
  let google: { sub: string; email: string; verified: boolean; name?: string; nonce?: string; badKey?: boolean };
  let github: { id: number; login: string; name: string | null; emails: { email: string; primary: boolean; verified: boolean }[] };
  let lastNonce = '';
  const tokenRequests: { url: string; body: URLSearchParams }[] = [];

  const realFetch = global.fetch;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
    resetGoogleKeyCache();
    jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === GOOGLE.jwksUrl) return json({ keys: [jwk] });
      if (url === GOOGLE.tokenUrl) {
        tokenRequests.push({ url, body: new URLSearchParams(String(init?.body)) });
        const now = Math.floor(Date.now() / 1000);
        const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        return json({
          access_token: 'g-access',
          id_token: idToken(
            {
              iss: 'accounts.google.com', // Google's second issuer spelling
              aud: ENV.GOOGLE_CLIENT_ID,
              sub: google.sub,
              email: google.email,
              email_verified: google.verified,
              name: google.name ?? 'Goo Gle',
              picture: 'https://lh3.googleusercontent.com/a/pic',
              nonce: google.nonce ?? lastNonce,
              iat: now,
              exp: now + 3600,
            },
            google.badKey ? other : privateKey,
          ),
        });
      }
      if (url === GITHUB.tokenUrl) {
        tokenRequests.push({ url, body: new URLSearchParams(String(init?.body)) });
        return json({ access_token: 'gh-access', token_type: 'bearer' });
      }
      if (url === `${GITHUB.apiUrl}/user`) {
        return json({ id: github.id, login: github.login, name: github.name, avatar_url: 'https://avatars.githubusercontent.com/u/1' });
      }
      if (url.startsWith(`${GITHUB.apiUrl}/user/emails`)) return json(github.emails);
      return realFetch(input as string, init);
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
    jest.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** Start a login; returns the provider URL params and the browser cookie. */
  const start = async (provider: 'google' | 'github') => {
    const res = await api().get(`/auth/oauth/${provider}/start`).expect(302);
    const url = new URL(res.headers.location);
    lastNonce = url.searchParams.get('nonce') ?? '';
    return { url, state: url.searchParams.get('state')!, cookie: res.headers['set-cookie'] as unknown as string[] };
  };
  /** Full login round trip; returns the redirect location. */
  const callback = async (provider: 'google' | 'github', s: { state: string; cookie?: string[] }) => {
    const req = api().get(`/auth/oauth/${provider}/callback?code=the-code&state=${encodeURIComponent(s.state)}`);
    if (s.cookie) req.set('Cookie', s.cookie);
    const res = await req.expect(302);
    return res.headers.location as string;
  };
  const codeFrom = (location: string) => new URLSearchParams(location.split('#')[1]).get('code');
  const login = async (provider: 'google' | 'github') => {
    const loc = await callback(provider, await start(provider));
    const code = codeFrom(loc);
    if (!code) throw new Error(`no login code in ${loc}`);
    return api().post('/auth/oauth/exchange').send({ code }).expect(200);
  };

  it('reports which providers are configured', async () => {
    const res = await api().get('/auth/oauth/providers').expect(200);
    expect(res.body.data).toEqual({ google: true, github: true });
  });

  describe('Google', () => {
    it('starts an authorization-code flow with PKCE, state and nonce', async () => {
      const { url, cookie } = await start('google');
      expect(url.origin + url.pathname).toBe(GOOGLE.authorizeUrl);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('redirect_uri')).toMatch(/\/auth\/oauth\/google\/callback$/);
      expect(cookie.join(';')).toMatch(/bs_oauth_browser=.+HttpOnly/i);
    });

    it('signs up a new person, verified, and signs them in again by Google id', async () => {
      google = { sub: `g-${run}-1`, email: email('new'), verified: true, name: 'New Googler' };
      const res = await login('google');
      expect(res.body.data.user).toMatchObject({
        email: email('new'),
        displayName: 'New Googler',
        emailVerified: true,
        // A brand-new account confirms its name on /welcome first.
        needsOnboarding: true,
      });
      expect(res.body.data.user.avatarUrl).toBe('https://lh3.googleusercontent.com/a/pic');
      // PKCE verifier was sent with the code.
      expect(tokenRequests.at(-1)!.body.get('code_verifier')).toMatch(/^[\w-]{43,}$/);

      // Same Google account, new email at Google: still the same Backstages user.
      google = { ...google, email: email('renamed') };
      const again = await login('google');
      expect(again.body.data.user.id).toBe(res.body.data.user.id);
    });

    it('refuses a callback from another browser (login CSRF)', async () => {
      google = { sub: `g-${run}-csrf`, email: email('csrf'), verified: true };
      const s = await start('google');
      expect(await callback('google', { state: s.state })).toContain('/login?error=oauth-browser');
      expect(await prisma.user.count({ where: { email: email('csrf') } })).toBe(0);
    });

    it('uses state once only, and only for its own provider', async () => {
      google = { sub: `g-${run}-replay`, email: email('replay'), verified: true };
      const s = await start('google');
      expect(codeFrom(await callback('google', s))).toBeTruthy();
      expect(await callback('google', s)).toContain('error=oauth-expired');
      const other = await start('google');
      expect(await callback('github', other)).toContain('error=oauth-state');
    });

    it('refuses an unverified Google email and a bad ID token', async () => {
      google = { sub: `g-${run}-unv`, email: email('unv'), verified: false };
      expect(await callback('google', await start('google'))).toContain('error=oauth-no-verified-email');

      google = { sub: `g-${run}-forged`, email: email('forged'), verified: true, badKey: true };
      resetGoogleKeyCache();
      expect(await callback('google', await start('google'))).toContain('error=oauth-provider');

      google = { sub: `g-${run}-nonce`, email: email('nonce'), verified: true, nonce: 'someone-elses' };
      expect(await callback('google', await start('google'))).toContain('error=oauth-provider');
      expect(await prisma.user.count({ where: { email: { in: [email('unv'), email('forged'), email('nonce')] } } })).toBe(0);
    });

    it('links to an existing VERIFIED account with the same email', async () => {
      const signup = await api()
        .post('/auth/signup')
        .send({ email: email('verified'), password: 'password123!', displayName: 'Has Password' })
        .expect(201);
      await prisma.user.update({ where: { id: signup.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
      google = { sub: `g-${run}-v`, email: email('verified'), verified: true };
      const res = await login('google');
      expect(res.body.data.user.id).toBe(signup.body.data.user.id);
      expect(res.body.data.user.needsOnboarding).toBe(false);
      // Password still works too.
      await api().post('/auth/login').send({ email: email('verified'), password: 'password123!' }).expect(200);
    });

    it('never attaches to an UNVERIFIED password account (pre-account hijacking)', async () => {
      const squatter = await api()
        .post('/auth/signup')
        .send({ email: email('victim'), password: 'squatter-pass1', displayName: 'Squatter' })
        .expect(201);
      google = { sub: `g-${run}-victim`, email: email('victim'), verified: true };
      expect(await callback('google', await start('google'))).toContain('error=oauth-unverified-account');
      expect(await prisma.ssoIdentity.count({ where: { userId: squatter.body.data.user.id } })).toBe(0);
    });

    it('still asks for the 2FA code when the account has 2FA on', async () => {
      google = { sub: `g-${run}-tfa`, email: email('tfa'), verified: true };
      const first = await login('google');
      const token = first.body.data.accessToken as string;
      const setup = await api().post('/auth/2fa/setup').set(auth(token)).expect(200);
      const secret = setup.body.data.secret as string;
      await api().post('/auth/2fa/enable').set(auth(token)).send({ code: totp(secret, Date.now()) }).expect(200);

      const second = await login('google');
      expect(second.body.data.accessToken).toBeUndefined();
      expect(second.body.data).toMatchObject({ mfaRequired: true });
      const done = await api()
        .post('/auth/login/2fa')
        .send({ mfaToken: second.body.data.mfaToken, code: totp(secret, Date.now() + 30_000) })
        .expect(200);
      expect(done.body.data.user.id).toBe(first.body.data.user.id);
    });

    it('respects a workspace that requires SSO for its domain', async () => {
      const domain = `sso-${run}.test`;
      const owner = await api()
        .post('/auth/signup')
        .send({ email: email('ssoowner'), password: 'password123!', displayName: 'Owner' })
        .expect(201);
      const ws = await api()
        .post('/workspaces')
        .set(auth(owner.body.data.accessToken))
        .send({ name: `SSO ${run}` })
        .expect(201);
      await prisma.workspaceDomain.create({
        data: { workspaceId: ws.body.data.id, domain, token: 'x', verifiedAt: new Date() },
      });
      await prisma.ssoConnection.create({
        data: { workspaceId: ws.body.data.id, issuer: 'https://idp.example', clientId: 'c', clientSecretEnc: 'x', enforced: true },
      });
      google = { sub: `g-${run}-sso`, email: `someone-${run}@${domain}`, verified: true };
      expect(await callback('google', await start('google'))).toContain('error=oauth-sso-required');
    });

    it('reports a cancelled sign-in on the login page', async () => {
      const s = await start('google');
      const res = await api()
        .get(`/auth/oauth/google/callback?error=access_denied&state=${encodeURIComponent(s.state)}`)
        .set('Cookie', s.cookie)
        .expect(302);
      expect(res.headers.location).toContain('/login?error=oauth-denied');
      // The state is spent.
      expect(await callback('google', s)).toContain('error=oauth-expired');
    });

    it('rejects an unknown or reused exchange code', async () => {
      await api().post('/auth/oauth/exchange').send({ code: 'x'.repeat(43) }).expect(401);
      google = { sub: `g-${run}-once`, email: email('once'), verified: true };
      const code = codeFrom(await callback('google', await start('google')))!;
      await api().post('/auth/oauth/exchange').send({ code }).expect(200);
      await api().post('/auth/oauth/exchange').send({ code }).expect(401);
    });
  });

  describe('GitHub', () => {
    it('signs up with the primary verified email', async () => {
      github = {
        id: 9_000_001,
        login: `octo-${run}`,
        name: null,
        emails: [
          { email: email('ghsecondary'), primary: false, verified: true },
          { email: email('ghprimary'), primary: true, verified: true },
        ],
      };
      const res = await login('github');
      expect(res.body.data.user).toMatchObject({ email: email('ghprimary'), displayName: `octo-${run}`, emailVerified: true });
      expect(tokenRequests.at(-1)!.body.get('code_verifier')).toBeTruthy();
    });

    it('skips unverified and no-reply addresses', async () => {
      github = {
        id: 9_000_002,
        login: `octo2-${run}`,
        name: 'Octo Two',
        emails: [
          { email: email('ghunverified'), primary: true, verified: false },
          { email: email('ghverified2'), primary: false, verified: true },
        ],
      };
      expect((await login('github')).body.data.user.email).toBe(email('ghverified2'));

      github = {
        id: 9_000_003,
        login: `octo3-${run}`,
        name: null,
        emails: [{ email: `123+octo3-${run}@users.noreply.github.com`, primary: true, verified: true }],
      };
      expect(await callback('github', await start('github'))).toContain('error=oauth-no-verified-email');
    });
  });

  describe('connected accounts', () => {
    let token: string;
    let userId: string;

    beforeAll(async () => {
      const res = await api()
        .post('/auth/signup')
        .send({ email: email('linker'), password: 'password123!', displayName: 'Linker' })
        .expect(201);
      token = res.body.data.accessToken;
      userId = res.body.data.user.id;
    });

    /** Start a link as `who`; the callback returns a link code for the app to confirm. */
    const linkCode = async (who: string, provider: 'google' | 'github') => {
      const started = await api().post(`/auth/oauth/${provider}/link`).set(auth(who)).expect(200);
      const url = new URL(started.body.data.url);
      lastNonce = url.searchParams.get('nonce') ?? '';
      const loc = await callback(provider, { state: url.searchParams.get('state')! });
      const code = new URL(loc).searchParams.get('oauth-link');
      if (!code) throw new Error(`no link code in ${loc}`);
      return code;
    };

    it('links a GitHub account with a different email, confirmed by the same session only', async () => {
      github = { id: 9_100_001, login: `linker-${run}`, name: null, emails: [{ email: `other-${run}@elsewhere.test`, primary: true, verified: true }] };
      const intruder = await api()
        .post('/auth/signup')
        .send({ email: email('intruder'), password: 'password123!', displayName: 'Intruder' })
        .expect(201);
      // Someone else's session can't complete this link (link CSRF).
      const stolen = await linkCode(token, 'github');
      await api().post('/auth/oauth/link/confirm').set(auth(intruder.body.data.accessToken)).send({ code: stolen }).expect(400);

      const code = await linkCode(token, 'github');
      const done = await api().post('/auth/oauth/link/confirm').set(auth(token)).send({ code }).expect(200);
      expect(done.body.data.hasPassword).toBe(true);
      expect(done.body.data.accounts).toEqual([expect.objectContaining({ provider: 'github', label: `@linker-${run}` })]);

      // Now "Continue with GitHub" signs in as this user.
      expect((await login('github')).body.data.user.id).toBe(userId);
    });

    it('reports a cancelled link back in the app', async () => {
      const started = await api().post('/auth/oauth/github/link').set(auth(token)).expect(200);
      const state = new URL(started.body.data.url).searchParams.get('state')!;
      const res = await api()
        .get(`/auth/oauth/github/callback?error=access_denied&state=${encodeURIComponent(state)}`)
        .expect(302);
      expect(res.headers.location).toContain('/app?oauth-link-error=denied');
    });

    it("won't link an account that already belongs to someone else", async () => {
      google = { sub: `g-${run}-1`, email: email('new'), verified: true }; // linked to the first Googler
      const code = await linkCode(token, 'google');
      await api().post('/auth/oauth/link/confirm').set(auth(token)).send({ code }).expect(400);
    });

    it('can disconnect when a password remains, but never the only way in', async () => {
      const list = await api().get('/auth/oauth/identities').set(auth(token)).expect(200);
      const id = list.body.data.accounts[0].id;
      const after = await api().delete(`/auth/oauth/identities/${id}`).set(auth(token)).expect(200);
      expect(after.body.data.accounts).toEqual([]);

      google = { sub: `g-${run}-only`, email: email('only'), verified: true };
      const socialOnly = (await login('google')).body.data.accessToken;
      const mine = await api().get('/auth/oauth/identities').set(auth(socialOnly)).expect(200);
      expect(mine.body.data.hasPassword).toBe(false);
      await api().delete(`/auth/oauth/identities/${mine.body.data.accounts[0].id}`).set(auth(socialOnly)).expect(400);
      // And nobody else's.
      await api().delete(`/auth/oauth/identities/${mine.body.data.accounts[0].id}`).set(auth(token)).expect(404);
    });
  });
});
