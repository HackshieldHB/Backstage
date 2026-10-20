import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { GITHUB } from '../src/auth/oauth-providers';

/** GitHub: repo webhooks → channel cards, link previews, create issues as yourself. */
describe('GitHub integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const repo = `acme-${run}/app`;
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  let owner: { id: string; token: string };
  let outsider: { id: string; token: string };
  let workspaceId: string;
  let channelId: string;
  let subId: string;
  let secret: string;

  // ---- fake GitHub ----
  const realFetch = global.fetch;
  const ghRequests: { url: string; method: string; body: unknown; auth: string | null }[] = [];
  let issueStatus = 201;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const savedEnv: Record<string, string | undefined> = {};

  const signup = async (name: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ email: `gh-${name}-${run}@test.local`, password: 'password123!', displayName: `${name} gh` })
      .expect(201);
    return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
  };

  /** Deliver a webhook signed like GitHub does. */
  const deliver = (event: string, payload: Record<string, unknown>, opts: { secret?: string; delivery?: string; sub?: string } = {}) => {
    const raw = JSON.stringify({ repository: { full_name: repo }, ...payload });
    const sig = `sha256=${createHmac('sha256', opts.secret ?? secret).update(raw).digest('hex')}`;
    return api()
      .post(`/webhooks/github/${opts.sub ?? subId}`)
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', event)
      .set('X-GitHub-Delivery', opts.delivery ?? randomUUID())
      .set('X-Hub-Signature-256', sig)
      .send(raw);
  };
  const ghMessages = () =>
    prisma.message.findMany({ where: { channelId, appName: 'GitHub' }, orderBy: { createdAt: 'asc' } });
  const pr = (over: Record<string, unknown> = {}) => ({
    number: 42,
    title: 'Ship the thing',
    html_url: `https://github.com/${repo}/pull/42`,
    state: 'open',
    draft: false,
    merged: false,
    user: { login: 'octocat' },
    head: { ref: 'feat' },
    base: { ref: 'main' },
    ...over,
  });

  beforeAll(async () => {
    for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_API_TOKEN']) savedEnv[k] = process.env[k];
    process.env.GITHUB_CLIENT_ID = 'gh-client';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    delete process.env.GITHUB_API_TOKEN;

    jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const authz = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      if (url.startsWith('https://api.github.com/') || url === GITHUB.tokenUrl) {
        ghRequests.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null, auth: authz });
      }
      if (url === GITHUB.tokenUrl) return json({ access_token: 'gho_usertoken', scope: 'repo,read:user,user:email', token_type: 'bearer' });
      if (url === 'https://api.github.com/user') return json({ id: 777, login: `issuer-${run}`, name: 'Issuer', avatar_url: null });
      if (url.startsWith('https://api.github.com/user/emails')) return json([]);
      // Public repo PR (no token needed).
      if (url === 'https://api.github.com/repos/public-org/lib/pulls/5') {
        return json({ title: 'Public PR', html_url: 'https://github.com/public-org/lib/pull/5', state: 'closed', merged: true });
      }
      // Anything else unauthenticated looks private.
      if (url.startsWith('https://api.github.com/repos/') && (init?.method ?? 'GET') === 'GET') return json({ message: 'Not Found' }, 404);
      if (url === `https://api.github.com/repos/${repo}/issues` && init?.method === 'POST') {
        if (issueStatus !== 201) return json({ message: 'Bad credentials' }, issueStatus);
        return json({ number: 99, html_url: `https://github.com/${repo}/issues/99` }, 201);
      }
      return realFetch(input as string, init);
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);

    owner = await signup('owner');
    outsider = await signup('outsider');
    workspaceId = (await api().post('/workspaces').set(auth(owner.token)).send({ name: `GH ${run}` }).expect(201)).body.data.id;
    channelId = (await api().post(`/workspaces/${workspaceId}/channels`).set(auth(owner.token)).send({ name: `gh-${run}` }).expect(201)).body.data.id;
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

  describe('subscriptions', () => {
    it('lets channel members subscribe a channel to a repo and shows the secret once', async () => {
      await api().post('/github/subscriptions').set(auth(owner.token)).send({ channelId, repo: 'not a repo', events: ['pr_opened'] }).expect(400);
      await api().post('/github/subscriptions').set(auth(outsider.token)).send({ channelId, repo, events: ['pr_opened'] }).expect(404);
      const res = await api()
        .post('/github/subscriptions')
        .set(auth(owner.token))
        .send({ channelId, repo: repo.toUpperCase(), events: ['pr_opened', 'pr_ready', 'pr_merged', 'pr_review', 'comment', 'ci_failed', 'issue_opened', 'release'] })
        .expect(201);
      subId = res.body.data.id;
      secret = res.body.data.webhookSecret;
      expect(res.body.data).toMatchObject({ repo, channelId, webhookUrl: expect.stringMatching(new RegExp(`/webhooks/github/${subId}$`)) });
      expect(secret).toMatch(/^[0-9a-f]{48}$/);
      await api().post('/github/subscriptions').set(auth(owner.token)).send({ channelId, repo, events: ['pr_opened'] }).expect(400);
      const list = await api().get(`/workspaces/${workspaceId}/github/subscriptions`).set(auth(owner.token)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].webhookSecret).toBeUndefined();
    });
  });

  describe('webhooks', () => {
    it('rejects bad or missing signatures and answers pings', async () => {
      await deliver('ping', { zen: 'hi' }, { secret: 'wrong' }).expect(401);
      await api().post(`/webhooks/github/${subId}`).set('X-GitHub-Event', 'ping').send({ zen: 'hi' }).expect(401);
      await deliver('ping', { zen: 'hi' }, { sub: 'nope' }).expect(404);
      const ok = await deliver('ping', { zen: 'hi' }).expect(200);
      expect(ok.body.data).toMatchObject({ posted: false });
    });

    it('posts a PR card, threads later events under it, and keeps its status current', async () => {
      await deliver('pull_request', { action: 'opened', pull_request: pr({ draft: true }) }).expect(200);
      expect(await ghMessages()).toHaveLength(0); // drafts wait

      await deliver('pull_request', { action: 'ready_for_review', pull_request: pr() }).expect(200);
      let msgs = await ghMessages();
      expect(msgs).toHaveLength(1);
      const card = msgs[0];
      expect(card.contentText).toBe('PR #42 is ready for review: Ship the thing');
      expect(card.unfurls).toEqual([expect.objectContaining({ type: 'github', key: `${repo}#42`, status: 'open' })]);

      await deliver('pull_request_review', { action: 'submitted', pull_request: pr(), review: { state: 'approved', user: { login: 'ann' } } }).expect(200);
      await deliver(
        'workflow_run',
        { action: 'completed', workflow_run: { name: 'CI', conclusion: 'failure', head_branch: 'feat', pull_requests: [{ number: 42 }] } },
      ).expect(200);
      await deliver('pull_request', { action: 'closed', pull_request: pr({ merged: true, state: 'closed' }), sender: { login: 'bob' } }).expect(200);

      msgs = await ghMessages();
      const replies = msgs.filter((m) => m.parentId === card.id).map((m) => m.contentText);
      expect(replies).toEqual(['ann ✅ approved PR #42: Ship the thing', '❌ CI failed on feat', 'PR #42 merged by bob: Ship the thing']);
      const refreshed = await prisma.message.findUniqueOrThrow({ where: { id: card.id } });
      expect(refreshed.unfurls).toEqual([expect.objectContaining({ status: 'merged' })]);
    });

    it('posts each delivery once, ignores other repos and unsubscribed events', async () => {
      const before = (await ghMessages()).length;
      const delivery = randomUUID();
      const issue = { number: 7, title: 'Crash', html_url: `https://github.com/${repo}/issues/7`, state: 'open', user: { login: 'eve' } };
      await deliver('issues', { action: 'opened', issue }, { delivery }).expect(200);
      await deliver('issues', { action: 'opened', issue }, { delivery }).expect(200);
      expect((await ghMessages()).length).toBe(before + 1);

      // Not subscribed to issue_closed.
      await deliver('issues', { action: 'closed', issue: { ...issue, state: 'closed' } }).expect(200);
      // A payload for another repo, even correctly signed, never posts here.
      const raw = JSON.stringify({ repository: { full_name: 'evil/other' }, action: 'opened', issue: { ...issue, number: 8 } });
      await api()
        .post(`/webhooks/github/${subId}`)
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'issues')
        .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
        .send(raw)
        .expect(200);
      expect((await ghMessages()).length).toBe(before + 1);
    });

    it('posts releases on their own', async () => {
      await deliver('release', { action: 'published', release: { tag_name: 'v2.0.0', name: 'v2.0.0', html_url: 'https://x' }, sender: { login: 'ann' } }).expect(200);
      const last = (await ghMessages()).at(-1)!;
      expect(last.contentText).toBe('🚀 Release v2.0.0 published by ann');
      expect(last.parentId).toBeNull();
    });
  });

  describe('link previews', () => {
    const post = (text: string) =>
      api()
        .post(`/channels/${channelId}/messages`)
        .set(auth(owner.token))
        .send({ clientMsgId: randomUUID(), contentJson: doc(text), contentText: text })
        .expect(201);
    const unfurlsOf = async (id: string) => {
      for (let i = 0; i < 30; i++) {
        const m = await prisma.message.findUniqueOrThrow({ where: { id } });
        if (m.unfurls) return m.unfurls;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    };

    it('previews a public repo link', async () => {
      const m = await post('look https://github.com/public-org/lib/pull/5 please');
      expect(await unfurlsOf(m.body.data.id)).toEqual([
        { type: 'github', url: 'https://github.com/public-org/lib/pull/5', key: 'public-org/lib#5', title: 'Public PR', status: 'merged' },
      ]);
    });

    it('never previews a private repo nobody here subscribed to', async () => {
      process.env.GITHUB_API_TOKEN = 'server-token';
      try {
        const m = await post('secret https://github.com/someone-else/private/pull/1');
        expect(await unfurlsOf(m.body.data.id)).toBeNull();
        expect(ghRequests.some((r) => r.url.includes('someone-else/private') && r.auth)).toBe(false);
      } finally {
        delete process.env.GITHUB_API_TOKEN;
      }
    });
  });

  describe('create issues as yourself', () => {
    let messageId: string;

    beforeAll(async () => {
      messageId = (
        await api()
          .post(`/channels/${channelId}/messages`)
          .set(auth(owner.token))
          .send({ clientMsgId: randomUUID(), contentJson: doc('Login button does nothing on Safari'), contentText: 'Login button does nothing on Safari' })
          .expect(201)
      ).body.data.id;
    });

    it('needs a connected GitHub account', async () => {
      expect((await api().get('/me/github').set(auth(owner.token)).expect(200)).body.data).toEqual({ available: true, connected: false, login: null });
      await api().post('/github/issues').set(auth(owner.token)).send({ repo, title: 'x', messageId }).expect(400);
    });

    it('connects through GitHub with repo scope, confirmed by the same session', async () => {
      const start = await api().post('/me/github/connect').set(auth(owner.token)).expect(200);
      const url = new URL(start.body.data.url);
      expect(url.searchParams.get('scope')).toBe('repo read:user user:email');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const cb = await api().get(`/auth/oauth/github/callback?code=c&state=${url.searchParams.get('state')}`).expect(302);
      const code = new URL(cb.headers.location).searchParams.get('github-connect')!;
      expect(code).toBeTruthy();
      await api().post('/me/github/connect/confirm').set(auth(outsider.token)).send({ code }).expect(400);

      const again = await api().post('/me/github/connect').set(auth(owner.token)).expect(200);
      const state = new URL(again.body.data.url).searchParams.get('state');
      const cb2 = await api().get(`/auth/oauth/github/callback?code=c&state=${state}`).expect(302);
      const code2 = new URL(cb2.headers.location).searchParams.get('github-connect')!;
      const done = await api().post('/me/github/connect/confirm').set(auth(owner.token)).send({ code: code2 }).expect(200);
      expect(done.body.data).toEqual({ available: true, connected: true, login: `issuer-${run}` });
      const link = await prisma.githubUserLink.findUniqueOrThrow({ where: { userId: owner.id } });
      expect(link.accessTokenEnc).not.toContain('gho_usertoken');
    });

    it('creates the issue with a link back and replies in the message thread', async () => {
      const res = await api()
        .post('/github/issues')
        .set(auth(owner.token))
        .send({ repo, title: 'Login broken on Safari', body: 'Steps…', messageId })
        .expect(201);
      expect(res.body.data).toEqual({ number: 99, url: `https://github.com/${repo}/issues/99`, repo });
      const call = ghRequests.filter((r) => r.method === 'POST' && r.url.endsWith('/issues')).at(-1)!;
      expect(call.auth).toBe('Bearer gho_usertoken');
      expect(JSON.parse(String(call.body))).toMatchObject({ title: 'Login broken on Safari', body: expect.stringContaining(`From Backstages #gh-${run}`) });
      const reply = await prisma.message.findFirstOrThrow({ where: { parentId: messageId, appName: 'GitHub' } });
      expect(reply.contentText).toBe(`📌 Created ${repo}#99 from this message: Login broken on Safari`);
    });

    it("can't create from a message you can't read, and forgets a revoked token", async () => {
      await api().post('/github/issues').set(auth(outsider.token)).send({ repo, title: 'x', messageId }).expect(400); // not connected
      issueStatus = 401;
      try {
        await api().post('/github/issues').set(auth(owner.token)).send({ repo, title: 'x' }).expect(400);
        expect(await prisma.githubUserLink.count({ where: { userId: owner.id } })).toBe(0);
      } finally {
        issueStatus = 201;
      }
    });
  });
});
