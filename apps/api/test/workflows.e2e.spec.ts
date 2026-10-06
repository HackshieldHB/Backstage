import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkflowsService } from '../src/workflows/workflows.service';

/** Poll until `fn` returns a truthy value (workflow actions run fire-and-forget). */
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

describe('workflows (e2e)', () => {
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
  let generalId: string;
  let watchId: string; // watched channel
  let opsId: string; // action target
  let welcomeId: string;

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const post = (cid: string, who: Actor, text: string) =>
    http()
      .post(`/channels/${cid}/messages`)
      .set(auth(who))
      .send({ clientMsgId: randomUUID(), contentJson: doc(text), contentText: text })
      .expect(201);
  const mkChannel = async (name: string) => {
    const r = await http()
      .post(`/workspaces/${workspaceId}/channels`)
      .set(auth(alice))
      .send({ name: `${name}-${run}` })
      .expect(201);
    return r.body.data.id as string;
  };
  const createWf = (body: object, who: Actor = alice) =>
    http().post(`/workspaces/${workspaceId}/workflows`).set(auth(who)).send(body);
  const integrationPosts = (channelId: string, contains: string) =>
    prisma.message.count({ where: { channelId, kind: 'INTEGRATION', contentText: { contains } } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string, displayName: string): Promise<Actor> => {
      const res = await http()
        .post('/auth/signup')
        .send({ email: `wf-${name}-${run}@test.local`, password: 'password123!', displayName })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice', `Alice ${run}`);
    bob = await mk('bob', `Bob ${run}`);
    mallory = await mk('mallory', `Mallory ${run}`);

    const ws = await http()
      .post('/workspaces')
      .set(auth(alice))
      .send({ name: `Workflows ${run}` })
      .expect(201);
    workspaceId = ws.body.data.id;
    const general = await prisma.channel.findFirstOrThrow({
      where: { workspaceId, isDefault: true },
    });
    generalId = general.id;

    watchId = await mkChannel('wf-watch');
    opsId = await mkChannel('wf-ops');
    welcomeId = await mkChannel('wf-welcome');
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  it('member_joined on #general fires when someone accepts an invite', async () => {
    await createWf({
      name: 'Welcome to general',
      trigger: 'member_joined',
      config: {
        channelId: generalId,
        actions: [{ type: 'post_message', channelId: generalId, text: 'Welcome {{user}}! 👋' }],
      },
    }).expect(201);

    const invite = await http()
      .post(`/workspaces/${workspaceId}/invites`)
      .set(auth(alice))
      .send({})
      .expect(201);
    await http()
      .post('/invites/accept')
      .set(auth(bob))
      .send({ token: invite.body.data.token })
      .expect(200);
    await waitFor(() => integrationPosts(generalId, `Welcome Bob ${run}! 👋`));
  });

  it('only admins manage workflows, and bodies are validated', async () => {
    const valid = {
      name: 'x',
      trigger: 'member_joined',
      config: {
        channelId: welcomeId,
        actions: [{ type: 'post_message', channelId: welcomeId, text: 'hi' }],
      },
    };
    await createWf(valid, bob).expect(403);
    await createWf(valid, mallory).expect(404);
    await createWf({ ...valid, trigger: 'nope' }).expect(400);
    await createWf({ ...valid, config: { channelId: welcomeId, actions: [] } }).expect(400);

    // Scheduled workflows can't target "the person who triggered it".
    await createWf({
      name: 'bad schedule',
      trigger: 'schedule',
      config: {
        days: [1],
        time: '09:00',
        timeZone: 'UTC',
        actions: [{ type: 'send_dm', to: 'trigger_user', text: 'x' }],
      },
    }).expect(400);

    // Recipients must be workspace members.
    await createWf({
      ...valid,
      config: {
        channelId: welcomeId,
        actions: [{ type: 'create_task', title: 't', assignee: mallory.id }],
      },
    }).expect(400);
  });

  it('accepts the legacy single-action shape and returns it normalized', async () => {
    const res = await createWf({
      name: 'Legacy',
      trigger: 'message_posted',
      config: {
        channelId: watchId,
        keyword: 'legacyping',
        actionChannelId: opsId,
        actionText: 'legacy fired',
      },
    }).expect(201);
    expect(res.body.data.config.actions).toEqual([
      { type: 'post_message', channelId: opsId, text: 'legacy fired' },
    ]);

    await post(watchId, alice, 'please legacyping now');
    await waitFor(() => integrationPosts(opsId, 'legacy fired'));
  });

  it('message_posted runs post/DM/task actions in order with variables', async () => {
    await http().post(`/channels/${watchId}/join`).set(auth(bob)).expect(200);
    const created = await createWf({
      name: 'Deploy flow',
      trigger: 'message_posted',
      config: {
        channelId: watchId,
        keyword: 'DEPLOY',
        actions: [
          {
            type: 'post_message',
            channelId: opsId,
            text: '{{user}} said in #{{channel}}: {{message}}',
          },
          { type: 'send_dm', to: 'trigger_user', text: 'Thanks {{user}}, logged.' },
          {
            type: 'create_task',
            title: 'Verify deploy ({{date}})',
            assignee: 'trigger_user',
            dueInDays: 1,
          },
        ],
      },
    }).expect(201);
    const wfId = created.body.data.id;

    await post(watchId, bob, 'deploy v2 is out');
    await waitFor(() =>
      integrationPosts(opsId, `Bob ${run} said in #wf-watch-${run}: deploy v2 is out`),
    );
    // Posts are attributed to the workflow, not to Jira.
    const posted = await prisma.message.findFirstOrThrow({
      where: { channelId: opsId, contentText: { contains: 'deploy v2 is out' }, kind: 'INTEGRATION' },
    });
    expect(posted.appName).toBe('Deploy flow');
    const listed = await http().get(`/channels/${opsId}/messages`).set(auth(alice)).expect(200);
    expect(
      listed.body.data.messages.find((m: { id: string }) => m.id === posted.id).appName,
    ).toBe('Deploy flow');

    const dm = await waitFor(() =>
      prisma.message.findFirst({
        where: {
          kind: 'INTEGRATION',
          contentText: `Thanks Bob ${run}, logged.`,
          conversation: { workspaceId },
        },
        include: { conversation: { include: { members: true } } },
      }),
    );
    expect(dm.conversation!.members.map((m) => m.userId).sort()).toEqual([alice.id, bob.id].sort());

    const task = await waitFor(() =>
      prisma.task.findFirst({
        where: { workspaceId, assigneeId: bob.id, title: { startsWith: 'Verify deploy (' } },
      }),
    );
    expect(task.createdById).toBe(alice.id);
    expect(task.dueAt).toBeTruthy();

    const wf = await waitFor(async () => {
      const w = await prisma.workflow.findUniqueOrThrow({ where: { id: wfId } });
      return w.runCount === 1 ? w : null;
    });
    expect(wf.lastRunAt).toBeTruthy();

    // A non-matching message doesn't fire; disabling stops it.
    await post(watchId, bob, 'just chatting');
    await http().patch(`/workflows/${wfId}`).set(auth(alice)).send({ enabled: false }).expect(200);
    await post(watchId, bob, 'deploy again');
    await new Promise((r) => setTimeout(r, 300));
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: wfId } })).runCount).toBe(1);
  });

  it('reaction_added turns a 🎫 into a task linked to the message', async () => {
    await createWf({
      name: 'Ticket',
      trigger: 'reaction_added',
      config: {
        channelId: watchId,
        emoji: 'ticket',
        actions: [
          { type: 'create_task', title: 'Follow up: {{message}}', assignee: 'trigger_user' },
        ],
      },
    }).expect(201);

    const msg = await post(watchId, alice, 'printer on 3rd floor is jammed');
    await http()
      .post(`/messages/${msg.body.data.id}/reactions`)
      .set(auth(bob))
      .send({ emoji: 'eyes' })
      .expect(200);
    await http()
      .post(`/messages/${msg.body.data.id}/reactions`)
      .set(auth(bob))
      .send({ emoji: 'ticket' })
      .expect(200);

    const task = await waitFor(() =>
      prisma.task.findFirst({ where: { workspaceId, messageId: msg.body.data.id } }),
    );
    expect(task.assigneeId).toBe(bob.id);
    expect(task.title).toBe('Follow up: printer on 3rd floor is jammed');
    expect(await prisma.task.count({ where: { workspaceId, messageId: msg.body.data.id } })).toBe(
      1,
    );
  });

  it('member_joined fires on channel join', async () => {
    await createWf({
      name: 'Welcome',
      trigger: 'member_joined',
      config: {
        channelId: welcomeId,
        actions: [{ type: 'post_message', channelId: welcomeId, text: 'Say hi to {{user}}' }],
      },
    }).expect(201);
    await http().post(`/channels/${welcomeId}/join`).set(auth(bob)).expect(200);
    await waitFor(() => integrationPosts(welcomeId, `Say hi to Bob ${run}`));
  });

  it('incident_declared respects the minimum severity', async () => {
    await createWf({
      name: 'Page ops',
      trigger: 'incident_declared',
      config: {
        minSeverity: 'SEV2',
        actions: [
          { type: 'post_message', channelId: opsId, text: '🚨 {{severity}}: {{incident}}' },
        ],
      },
    }).expect(201);

    await http()
      .post(`/workspaces/${workspaceId}/incidents`)
      .set(auth(bob))
      .send({ title: `minor-${run}`, severity: 'SEV3' })
      .expect(201);
    await http()
      .post(`/workspaces/${workspaceId}/incidents`)
      .set(auth(bob))
      .send({ title: `major-${run}`, severity: 'SEV1' })
      .expect(201);
    await waitFor(() => integrationPosts(opsId, `🚨 SEV1: major-${run}`));
    expect(await integrationPosts(opsId, `minor-${run}`)).toBe(0);
  });

  it('schedule fires once per slot, in its time zone', async () => {
    const svc = app.get(WorkflowsService);
    // Pick the slot two minutes from now (UTC) on today's weekday.
    const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 2 * 60_000);
    const hhmm = `${String(slot.getUTCHours()).padStart(2, '0')}:${String(slot.getUTCMinutes()).padStart(2, '0')}`;
    const res = await createWf({
      name: 'Standup nudge',
      trigger: 'schedule',
      config: {
        days: [slot.getUTCDay()],
        time: hhmm,
        timeZone: 'UTC',
        actions: [{ type: 'post_message', channelId: opsId, text: `Standup time ${run} {{date}}` }],
      },
    }).expect(201);

    // Assert on this workflow's own output — other schedules in the DB may also run.
    await svc.runDueSchedules(new Date(slot.getTime() - 30_000)); // not yet
    expect(await integrationPosts(opsId, `Standup time ${run}`)).toBe(0);
    await svc.runDueSchedules(new Date(slot.getTime() + 5_000));
    expect(await integrationPosts(opsId, `Standup time ${run}`)).toBe(1);
    await svc.runDueSchedules(new Date(slot.getTime() + 20_000)); // same slot, already handled
    expect(await integrationPosts(opsId, `Standup time ${run}`)).toBe(1);
    const wf = await prisma.workflow.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(wf.runCount).toBe(1);
  });

  it('lists workflows with run stats for members', async () => {
    const list = await http()
      .get(`/workspaces/${workspaceId}/workflows`)
      .set(auth(bob))
      .expect(200);
    const deploy = list.body.data.find((w: { name: string }) => w.name === 'Deploy flow');
    expect(deploy.runCount).toBe(1);
    expect(deploy.enabled).toBe(false);
    await http().get(`/workspaces/${workspaceId}/workflows`).set(auth(mallory)).expect(404);
  });
});
