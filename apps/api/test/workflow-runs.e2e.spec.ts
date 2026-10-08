import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkflowRunsService } from '../src/workflows/workflow-runs.service';
import { signBody } from '../src/workflows/safe-webhook';

/** Poll until `fn` returns a truthy value (workflow runs start fire-and-forget). */
async function waitFor<T>(
  fn: () => Promise<T | null | undefined | 0 | false>,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('workflow runs: history, approvals, forms, webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
  }
  let alice: Actor; // owner/admin
  let bob: Actor; // member
  let mallory: Actor; // outsider
  let workspaceId: string;
  let watchId: string;
  let opsId: string;

  const http_ = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const post = (cid: string, who: Actor, text: string) =>
    http_()
      .post(`/channels/${cid}/messages`)
      .set(auth(who))
      .send({ clientMsgId: randomUUID(), contentJson: doc(text), contentText: text })
      .expect(201);
  const createWf = (body: object, who: Actor = alice) =>
    http_().post(`/workspaces/${workspaceId}/workflows`).set(auth(who)).send(body);
  const opsPosts = (contains: string) =>
    prisma.message.count({
      where: { channelId: opsId, kind: 'INTEGRATION', contentText: { contains } },
    });
  const lastRun = (workflowId: string) =>
    prisma.workflowRun.findFirst({ where: { workflowId }, orderBy: { startedAt: 'desc' } });
  const waitForStatus = (workflowId: string, status: string) =>
    waitFor(async () => {
      const r = await lastRun(workflowId);
      return r?.status === status ? r : null;
    });
  const requestsFor = async (who: Actor) =>
    (await http_().get(`/workspaces/${workspaceId}/workflow-requests`).set(auth(who)).expect(200))
      .body.data as Array<{ runId: string; kind: string; prompt: string; fields: unknown[] }>;
  const respond = (who: Actor, runId: string, body: object) =>
    http_().post(`/workflow-runs/${runId}/respond`).set(auth(who)).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string, displayName: string): Promise<Actor> => {
      const res = await http_()
        .post('/auth/signup')
        .send({ email: `wfr-${name}-${run}@test.local`, password: 'password123!', displayName })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice', `Alice ${run}`);
    bob = await mk('bob', `Bob ${run}`);
    mallory = await mk('mallory', `Mallory ${run}`);

    const ws = await http_()
      .post('/workspaces')
      .set(auth(alice))
      .send({ name: `Workflow runs ${run}` })
      .expect(201);
    workspaceId = ws.body.data.id;
    const invite = await http_()
      .post(`/workspaces/${workspaceId}/invites`)
      .set(auth(alice))
      .send({})
      .expect(201);
    await http_()
      .post('/invites/accept')
      .set(auth(bob))
      .send({ token: invite.body.data.token })
      .expect(200);

    for (const [name, set] of [
      ['wfr-watch', (id: string) => (watchId = id)],
      ['wfr-ops', (id: string) => (opsId = id)],
    ] as const) {
      const c = await http_()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: `${name}-${run}` })
        .expect(201);
      set(c.body.data.id);
      await http_().post(`/channels/${c.body.data.id}/join`).set(auth(bob)).expect(200);
    }
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  it('records each run with per-step outcomes; history is admin-only', async () => {
    const created = await createWf({
      name: 'Two steps',
      trigger: 'message_posted',
      config: {
        channelId: watchId,
        keyword: 'twostep',
        actions: [
          { type: 'post_message', channelId: opsId, text: 'twostep: {{user}}' },
          { type: 'create_task', title: 'Follow up {{message}}', assignee: 'trigger_user' },
        ],
      },
    }).expect(201);
    const wfId = created.body.data.id;

    await post(watchId, bob, 'twostep now');
    await waitForStatus(wfId, 'SUCCEEDED');

    const runs = await http_().get(`/workflows/${wfId}/runs`).set(auth(alice)).expect(200);
    expect(runs.body.data).toHaveLength(1);
    const r = runs.body.data[0];
    expect(r.status).toBe('SUCCEEDED');
    expect(r.triggerUser.id).toBe(bob.id);
    expect(r.finishedAt).toBeTruthy();
    expect(
      r.steps.map((s: { type: string; ok: boolean; detail: string }) => [s.type, s.ok, s.detail]),
    ).toEqual([
      ['post_message', true, `Posted to #wfr-ops-${run}`],
      ['create_task', true, `Created a task for Bob ${run}`],
    ]);

    await http_().get(`/workflows/${wfId}/runs`).set(auth(bob)).expect(403);
    await http_().get(`/workflows/${wfId}/runs`).set(auth(mallory)).expect(404);
  });

  it('approval: pauses, notifies the approver, resumes on approve with {{decision}}', async () => {
    const created = await createWf({
      name: 'Expense approval',
      trigger: 'message_posted',
      config: {
        channelId: watchId,
        keyword: 'expense',
        actions: [
          {
            type: 'request_approval',
            approver: alice.id,
            prompt: 'Approve {{user}}: {{message}}?',
          },
          { type: 'post_message', channelId: opsId, text: 'Expense {{decision}} by {{approver}}' },
        ],
      },
    }).expect(201);
    const wfId = created.body.data.id;

    await post(watchId, bob, 'expense: 40 USD taxi');
    const waiting = await waitForStatus(wfId, 'WAITING');
    expect(waiting.pendingUserId).toBe(alice.id);
    expect(
      await prisma.notification.count({
        where: { userId: alice.id, payload: { path: ['runId'], equals: waiting.id } },
      }),
    ).toBe(1);

    const req = (await requestsFor(alice)).find((x) => x.runId === waiting.id)!;
    expect(req.kind).toBe('request_approval');
    expect(req.prompt).toBe(`Approve Bob ${run}: expense: 40 USD taxi?`);
    expect((await requestsFor(bob)).some((x) => x.runId === waiting.id)).toBe(false);

    // Only the approver may answer, and only with a decision.
    await respond(bob, waiting.id, { decision: 'approve' }).expect(404);
    await respond(alice, waiting.id, { answers: { x: 'y' } }).expect(400);

    const done = await respond(alice, waiting.id, { decision: 'approve' }).expect(200);
    expect(done.body.data.status).toBe('SUCCEEDED');
    expect(await opsPosts(`Expense approved by Alice ${run}`)).toBe(1);

    // Answering twice is refused, and it's gone from the list.
    await respond(alice, waiting.id, { decision: 'reject' }).expect(404);
    expect((await requestsFor(alice)).some((x) => x.runId === waiting.id)).toBe(false);
  });

  it('approval: rejecting stops the run before later steps', async () => {
    const wf = await prisma.workflow.findFirstOrThrow({
      where: { workspaceId, name: 'Expense approval' },
    });
    await post(watchId, bob, 'expense: 900 USD dinner');
    const waiting = await waitForStatus(wf.id, 'WAITING');
    const res = await respond(alice, waiting.id, { decision: 'reject' }).expect(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect(res.body.data.steps.at(-1).detail).toBe(`Rejected by Alice ${run}`);
    expect(await opsPosts('Expense rejected')).toBe(0);
  });

  it('form: answers are validated and become variables', async () => {
    await createWf({
      name: 'Onboarding form',
      trigger: 'message_posted',
      config: {
        channelId: watchId,
        keyword: 'onboard me',
        actions: [
          {
            type: 'ask_form',
            assignee: 'trigger_user',
            prompt: 'Welcome {{user}}! Tell us a bit about you.',
            fields: [
              { key: 'team', label: 'Team', kind: 'select', options: ['eng', 'design'] },
              { key: 'goal', label: 'First goal', kind: 'text', required: false },
            ],
          },
          {
            type: 'post_message',
            channelId: opsId,
            text: '{{respondent}} joined {{team}} — goal: {{goal}}',
          },
        ],
      },
    }).expect(201);

    await post(watchId, bob, 'please onboard me');
    const req = await waitFor(async () =>
      (await requestsFor(bob)).find((x) => x.kind === 'ask_form'),
    );
    expect(req.prompt).toBe(`Welcome Bob ${run}! Tell us a bit about you.`);
    expect(req.fields).toHaveLength(2);

    await respond(bob, req.runId, { answers: { goal: 'ship' } }).expect(400); // team is required
    await respond(bob, req.runId, { answers: { team: 'marketing' } }).expect(400); // not an option
    await respond(bob, req.runId, { decision: 'approve' }).expect(400); // wrong kind of answer
    const ok = await respond(bob, req.runId, {
      answers: { team: 'eng', goal: '  ship the beta  ' },
    }).expect(200);
    expect(ok.body.data.status).toBe('SUCCEEDED');
    expect(await opsPosts(`Bob ${run} joined eng — goal: ship the beta`)).toBe(1);
  });

  it('rejects malformed form definitions', async () => {
    const form = (fields: unknown[]) =>
      createWf({
        name: 'bad form',
        trigger: 'message_posted',
        config: {
          channelId: watchId,
          actions: [{ type: 'ask_form', assignee: alice.id, prompt: 'p', fields }],
        },
      });
    await form([{ key: 'User', label: 'x', kind: 'text' }]).expect(400); // bad key
    await form([{ key: 'user', label: 'x', kind: 'text' }]).expect(400); // reserved
    await form([{ key: 'a', label: 'x', kind: 'select', options: ['only'] }]).expect(400);
    await form([
      { key: 'a', label: 'x', kind: 'text' },
      { key: 'a', label: 'y', kind: 'text' },
    ]).expect(400);
    // A schedule has nobody to ask "the person who triggered it".
    await createWf({
      name: 'bad schedule approval',
      trigger: 'schedule',
      config: {
        days: [1],
        time: '09:00',
        timeZone: 'UTC',
        actions: [{ type: 'request_approval', approver: 'trigger_user', prompt: 'ok?' }],
      },
    }).expect(400);
  });

  it('pending requests expire and can no longer be answered', async () => {
    const wf = await prisma.workflow.findFirstOrThrow({
      where: { workspaceId, name: 'Expense approval' },
    });
    await post(watchId, bob, 'expense: forgotten');
    const waiting = await waitForStatus(wf.id, 'WAITING');
    await app.get(WorkflowRunsService).expireRequests(new Date(Date.now() + 8 * 24 * 3600_000));
    const after = await prisma.workflowRun.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(after.status).toBe('EXPIRED');
    expect(after.pendingUserId).toBeNull();
    await respond(alice, waiting.id, { decision: 'approve' }).expect(404);
  });

  describe('outgoing webhooks', () => {
    let server: http.Server;
    let port = 0;
    const hits: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    let reply = 200;
    const prevFlag = process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          hits.push({ headers: req.headers, body });
          res.writeHead(reply);
          res.end();
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
      if (prevFlag === undefined) delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
      else process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE = prevFlag;
      await new Promise((r) => server.close(r));
    });

    it('refuses insecure or private targets in normal mode', async () => {
      delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
      const hook = (url: string) =>
        createWf({
          name: 'hook',
          trigger: 'message_posted',
          config: { channelId: watchId, actions: [{ type: 'call_webhook', url }] },
        });
      await hook(`http://127.0.0.1:${port}/x`).expect(400);
      await hook('https://127.0.0.1/x').expect(400);
      await hook('https://169.254.169.254/latest/meta-data').expect(400);
      await hook('https://localhost/x').expect(400);
      expect(hits).toHaveLength(0);
    });

    it('posts signed JSON; the secret is admin-only; failures are recorded', async () => {
      process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE = '1'; // dev mode: allow the local test server
      const created = await createWf({
        name: 'Hook flow',
        trigger: 'message_posted',
        config: {
          channelId: watchId,
          keyword: 'hookme',
          actions: [
            { type: 'call_webhook', url: `http://127.0.0.1:${port}/in` },
            { type: 'post_message', channelId: opsId, text: 'hook flow ran' },
          ],
        },
      }).expect(201);
      const wfId = created.body.data.id as string;
      const secret = created.body.data.signingSecret as string;
      expect(secret).toMatch(/^[0-9a-f]{64}$/);

      const memberView = await http_()
        .get(`/workspaces/${workspaceId}/workflows`)
        .set(auth(bob))
        .expect(200);
      const seen = memberView.body.data.find((w: { id: string }) => w.id === wfId);
      expect(seen).toBeTruthy();
      expect('signingSecret' in seen).toBe(false);

      await post(watchId, bob, 'hookme please');
      await waitForStatus(wfId, 'SUCCEEDED');
      const hit = hits.at(-1)!;
      const payload = JSON.parse(hit.body);
      expect(payload.workflow.name).toBe('Hook flow');
      expect(payload.variables.message).toBe('hookme please');
      const ts = String(hit.headers['x-backstages-timestamp']);
      expect(hit.headers['x-backstages-signature']).toBe(signBody(secret, ts, hit.body));

      reply = 500;
      await post(watchId, bob, 'hookme again');
      const partial = await waitForStatus(wfId, 'PARTIAL');
      expect((partial.steps as Array<{ ok: boolean }>).map((s) => s.ok)).toEqual([false, true]);
      reply = 200;
    });
  });
});
