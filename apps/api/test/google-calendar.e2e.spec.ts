import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { GOOGLE, resetGoogleKeyCache } from '../src/auth/oauth-providers';
import { CALENDAR_API } from '../src/google-calendar/google-calendar-api';
import { GoogleCalendarService } from '../src/google-calendar/google-calendar.service';
import { RedisClient } from '../src/redis/redis.module';

/** Two-way Google Calendar sync against a fake Google (OAuth + Calendar v3). */
describe('Google Calendar sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gcal: GoogleCalendarService;
  let redis: RedisClient;
  const run = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

  // ---- fake Google ----
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = (claims: Record<string, unknown>) => {
    const h = b64({ alg: 'RS256', kid: 'k1' });
    const p = b64(claims);
    return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
  };
  type GEvent = Record<string, unknown> & { id: string };
  /** account → its events (access tokens are "acc-<account>-<n>"). */
  const calendars = new Map<string, GEvent[]>();
  const revoked = new Set<string>();
  let grantScope = `openid email ${SCOPE}`;
  let nonce = '';
  let tokenSeq = 0;
  const tokenRequests: URLSearchParams[] = [];
  const accountOf = (authz: string | null) => /^Bearer acc-(.+)-\d+$/.exec(authz ?? '')?.[1] ?? null;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const realFetch = global.fetch;
  const saved: Record<string, string | undefined> = {};

  let alice: { id: string; token: string };
  let bob: { id: string; token: string };
  let workspaceId: string;
  let channelId: string;

  const signup = async (name: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ email: `gc-${name}-${run}@test.local`, password: 'password123!', displayName: `${name} gc` })
      .expect(201);
    return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
  };
  const waitFor = async <T>(fn: () => T | Promise<T>, ok: (v: T) => boolean, ms = 6000): Promise<T> => {
    const until = Date.now() + ms;
    let v = await fn();
    while (!ok(v) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
      v = await fn();
    }
    return v;
  };
  /** Wait until no background sync is running for this person (they hold a per-user lock). */
  const settle = (userId: string) =>
    waitFor(async () => (await redis.exists(`gcal:lock:${userId}`)) + (await redis.exists(`gcal:dirty:${userId}`)), (n) => n === 0);
  const ours = (account: string) => (calendars.get(account) ?? []).filter((e) => (e.extendedProperties as { private?: object } | undefined)?.private);
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const schedule = async (title: string, hours: number) =>
    (
      await api()
        .post(`/channels/${channelId}/scheduled-huddles`)
        .set(auth(bob.token))
        .send({ title, scheduledFor: inHours(hours), durationMins: 30, reminderMins: 15, timeZone: 'Asia/Jakarta' })
        .expect(201)
    ).body.data as { id: string };

  /** Connect `who` to Google account `account`; returns the confirm response. */
  const connect = async (who: { token: string }, account: string) => {
    const start = await api().post('/me/google-calendar/connect').set(auth(who.token)).expect(200);
    const url = new URL(start.body.data.url);
    nonce = url.searchParams.get('nonce')!;
    const cb = await api().get(`/auth/oauth/google/callback?code=code-${account}&state=${url.searchParams.get('state')}`).expect(302);
    return { url, location: cb.headers.location as string };
  };

  beforeAll(async () => {
    for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) saved[k] = process.env[k];
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
    resetGoogleKeyCache();

    jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? 'GET';
      const authz = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      if (url === GOOGLE.jwksUrl) return json({ keys: [jwk] });
      if (url === GOOGLE.tokenUrl) {
        const form = new URLSearchParams(String(init?.body));
        tokenRequests.push(form);
        if (form.get('grant_type') === 'refresh_token') {
          const account = form.get('refresh_token')!.replace(/^refresh-/, '');
          if (revoked.has(account)) return json({ error: 'invalid_grant' }, 400);
          return json({ access_token: `acc-${account}-${++tokenSeq}`, expires_in: 3600 });
        }
        const account = form.get('code')!.replace(/^code-/, '');
        const now = Math.floor(Date.now() / 1000);
        return json({
          access_token: `acc-${account}-${++tokenSeq}`,
          refresh_token: `refresh-${account}`,
          expires_in: 3600,
          scope: grantScope,
          id_token: idToken({
            iss: 'https://accounts.google.com',
            aud: 'g-client',
            sub: `sub-${account}`,
            email: `${account}@gmail.test`,
            email_verified: true,
            nonce,
            iat: now,
            exp: now + 3600,
          }),
        });
      }
      if (url.startsWith(`${CALENDAR_API}/calendars/primary/events`)) {
        const account = accountOf(authz);
        if (!account || revoked.has(account)) return json({ error: { message: 'Invalid Credentials' } }, 401);
        const list = calendars.get(account) ?? [];
        calendars.set(account, list);
        const id = decodeURIComponent(new URL(url).pathname.split('/events/')[1] ?? '');
        if (method === 'POST') {
          const ev = { ...(JSON.parse(String(init?.body)) as object), id: `ev-${randomUUID().slice(0, 8)}` };
          list.push(ev);
          return json(ev);
        }
        if (method === 'PATCH') {
          const i = list.findIndex((e) => e.id === id);
          if (i < 0) return json({ error: { message: 'Not Found' } }, 404);
          list[i] = { ...list[i], ...(JSON.parse(String(init?.body)) as object) };
          return json(list[i]);
        }
        if (method === 'DELETE') {
          const i = list.findIndex((e) => e.id === id);
          if (i < 0) return json({ error: { message: 'Gone' } }, 410);
          list.splice(i, 1);
          return new Response(null, { status: 204 });
        }
        return json({ items: list });
      }
      return realFetch(input as string, init);
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    gcal = app.get(GoogleCalendarService);
    redis = app.get(RedisClient);

    alice = await signup('alice');
    bob = await signup('bob');
    workspaceId = (await api().post('/workspaces').set(auth(bob.token)).send({ name: `GC ${run}` }).expect(201)).body.data.id;
    channelId = (await api().post(`/workspaces/${workspaceId}/channels`).set(auth(bob.token)).send({ name: `gc-${run}` }).expect(201)).body.data.id;
    const invite = await api().post(`/workspaces/${workspaceId}/invites`).set(auth(bob.token)).send({}).expect(201);
    await api().post('/invites/accept').set(auth(alice.token)).send({ token: invite.body.data.token }).expect(200);
    await api().post(`/channels/${channelId}/join`).set(auth(alice.token)).expect((r) => expect([200, 201]).toContain(r.status));
  });

  afterAll(async () => {
    await prisma.googleCalendarEvent.deleteMany({ where: { userId: { in: [alice.id, bob.id] } } });
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
    jest.restoreAllMocks();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('refuses when calendar access was not granted on the consent screen', async () => {
    grantScope = 'openid email';
    try {
      const { location } = await connect(alice, 'alice');
      expect(location).toContain('/app?oauth-link-error=scope');
    } finally {
      grantScope = `openid email ${SCOPE}`;
    }
  });

  it('connects with offline calendar access, confirmed by the same session, and copies existing meetings', async () => {
    const before = await schedule('Planning', 30); // exists before connecting
    expect((await api().get('/me/google-calendar').set(auth(alice.token)).expect(200)).body.data).toMatchObject({ available: true, connected: false });

    const { url, location } = await connect(alice, 'alice');
    expect(url.searchParams.get('scope')).toBe(`openid email ${SCOPE}`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    const code = new URL(location).searchParams.get('google-calendar')!;
    await api().post('/me/google-calendar/connect/confirm').set(auth(bob.token)).send({ code }).expect(400);

    const again = await connect(alice, 'alice');
    const code2 = new URL(again.location).searchParams.get('google-calendar')!;
    const done = await api().post('/me/google-calendar/connect/confirm').set(auth(alice.token)).send({ code: code2 }).expect(200);
    expect(done.body.data).toMatchObject({ connected: true, email: 'alice@gmail.test', pushMeetings: true, broken: false });
    const link = await prisma.googleCalendarLink.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(link.refreshTokenEnc).not.toContain('refresh-alice');

    const copies = await waitFor(() => ours('alice'), (l) => l.length === 1);
    expect(copies[0]).toMatchObject({
      summary: 'Planning',
      start: { timeZone: 'Asia/Jakarta' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      extendedProperties: { private: { backstagesMeetingId: before.id } },
    });
    expect(String(copies[0].description)).toContain('Join the huddle in Backstages:');
    expect(copies[0].attendees).toBeUndefined(); // nobody gets emailed by Google
  });

  it('follows meetings as they are created, renamed, declined and cancelled', async () => {
    const m = await schedule('Design review', 48);
    let copy = await waitFor(
      () => ours('alice').find((e) => (e.extendedProperties as { private: { backstagesMeetingId: string } }).private.backstagesMeetingId === m.id),
      (e) => !!e,
    );
    expect(copy?.summary).toBe('Design review');

    await api().patch(`/scheduled-huddles/${m.id}`).set(auth(bob.token)).send({ title: 'Design review v2' }).expect(200);
    copy = await waitFor(() => ours('alice').find((e) => e.id === copy!.id), (e) => e?.summary === 'Design review v2');
    expect(copy?.summary).toBe('Design review v2');

    await api().post(`/scheduled-huddles/${m.id}/respond`).set(auth(alice.token)).send({ response: 'DECLINED' }).expect(201);
    await waitFor(() => ours('alice').length, (n) => n === 1);
    expect(ours('alice').some((e) => e.summary === 'Design review v2')).toBe(false);

    await api().post(`/scheduled-huddles/${m.id}/respond`).set(auth(alice.token)).send({ response: 'ACCEPTED' }).expect(201);
    await waitFor(() => ours('alice').length, (n) => n === 2);

    await api().delete(`/scheduled-huddles/${m.id}`).set(auth(bob.token)).expect(200);
    await waitFor(() => ours('alice').length, (n) => n === 1);
    expect(await prisma.googleCalendarEvent.count({ where: { userId: alice.id, scheduledHuddleId: m.id } })).toBe(0);
  });

  it('puts back a copy the person deleted in Google, and skips no-op updates', async () => {
    const [copy] = ours('alice');
    calendars.set('alice', (calendars.get('alice') ?? []).filter((e) => e.id !== copy.id));
    await settle(alice.id);
    const writesBefore = tokenRequests.length;
    await gcal.reconcileUser(alice.id);
    expect(ours('alice')).toHaveLength(1);
    expect(ours('alice')[0].id).not.toBe(copy.id);
    // Nothing changed now: a second pass writes nothing.
    const count = (calendars.get('alice') ?? []).length;
    await gcal.reconcileUser(alice.id);
    expect((calendars.get('alice') ?? []).length).toBe(count);
    expect(tokenRequests.length).toBe(writesBefore); // token still valid, no refresh
  });

  it("shows the person's own Google events (not our copies) and uses them as busy time", async () => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 1);
    const at = (h: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h)).toISOString();
    calendars.get('alice')!.push(
      { id: 'ext-1', summary: 'Dentist', start: { dateTime: at(9) }, end: { dateTime: at(10) } },
      { id: 'ext-2', summary: 'Lunch (free)', transparency: 'transparent', start: { dateTime: at(12) }, end: { dateTime: at(13) } },
      { id: 'ext-3', summary: 'Holiday', start: { date: at(0).slice(0, 10) }, end: { date: at(0).slice(0, 10) + 'x' } },
      { id: 'ext-4', status: 'cancelled', summary: 'Gone', start: { dateTime: at(15) }, end: { dateTime: at(16) } },
    );
    const from = at(0);
    const to = new Date(Date.parse(at(0)) + 24 * 3600_000).toISOString();
    const mine = await api().get(`/me/calendar/events?from=${from}&to=${to}`).set(auth(alice.token)).expect(200);
    expect(mine.body.data.source).toBe('google');
    const titles = mine.body.data.events.map((e: { title: string }) => e.title);
    expect(titles).toEqual(expect.arrayContaining(['Dentist', 'Lunch (free)']));
    expect(titles).not.toContain('Gone');
    expect(titles).not.toContain('Planning'); // our own copy is skipped

    await api().put(`/workspaces/${workspaceId}/calendar-sharing`).set(auth(alice.token)).send({ visibility: 'DETAILS' }).expect(200);
    const shared = await api().get(`/workspaces/${workspaceId}/people-calendars?users=${alice.id}&from=${from}&to=${to}`).set(auth(bob.token)).expect(200);
    const ext = shared.body.data[0].events.filter((e: { source: string }) => e.source === 'external').map((e: { title: string }) => e.title);
    expect(ext).toEqual(['Dentist']); // free time isn't busy
  });

  it('refreshes an expired token, and marks the link broken when access is revoked', async () => {
    await settle(alice.id);
    await prisma.googleCalendarLink.update({ where: { userId: alice.id }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });
    const before = tokenRequests.length;
    await gcal.reconcileUser(alice.id);
    expect(tokenRequests.slice(before).some((f) => f.get('grant_type') === 'refresh_token')).toBe(true);

    revoked.add('alice');
    await settle(alice.id);
    await expect(gcal.reconcileUser(alice.id)).rejects.toThrow();
    const status = await api().get('/me/google-calendar').set(auth(alice.token)).expect(200);
    expect(status.body.data).toMatchObject({ connected: true, broken: true });
    revoked.delete('alice');
  });

  it('turning sync off removes the copies; disconnecting forgets everything', async () => {
    // Reconnect (clears "broken").
    const { location } = await connect(alice, 'alice');
    await api()
      .post('/me/google-calendar/connect/confirm')
      .set(auth(alice.token))
      .send({ code: new URL(location).searchParams.get('google-calendar') })
      .expect(200);
    await waitFor(() => ours('alice').length, (n) => n >= 1);

    await api().put('/me/google-calendar').set(auth(alice.token)).send({ pushMeetings: false }).expect(200);
    await waitFor(() => ours('alice').length, (n) => n === 0);

    await api().put('/me/google-calendar').set(auth(alice.token)).send({ pushMeetings: true }).expect(200);
    await waitFor(() => ours('alice').length, (n) => n >= 1);
    await api().delete('/me/google-calendar').set(auth(alice.token)).expect(200);
    expect(ours('alice')).toHaveLength(0);
    expect(await prisma.googleCalendarLink.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.googleCalendarEvent.count({ where: { userId: alice.id } })).toBe(0);
  });
});
