import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  AtlassianApiService,
  type AtlassianProfile,
  type JiraIssueSummary,
} from '../src/atlassian/atlassian-api.service';
import { pickTransition } from '../src/atlassian/task-jira.service';

const SITE = { id: 'cloud-taskjira', url: 'https://taskjira.atlassian.net', name: 'Task Jira' };
const STATUS: Record<string, { name: string; category: string }> = {
  '11': { name: 'To Do', category: 'new' },
  '21': { name: 'In Progress', category: 'indeterminate' },
  '31': { name: 'Done', category: 'done' },
};

/** Just enough of the Atlassian API for connect + task linking + transitions. */
class FakeJira {
  issues = new Map<string, JiraIssueSummary>();
  created: Array<{ projectKey: string; summary: string; description: string }> = [];
  transitioned: Array<{ issueKey: string; transitionId: string; token: string }> = [];
  profile: AtlassianProfile | null = null;
  private next = 1;

  authorizeUrl(state: string) {
    return `https://auth.atlassian.test/authorize?state=${encodeURIComponent(state)}`;
  }
  async exchangeCode() {
    return {
      accessToken: `at-${randomUUID()}`,
      refreshToken: `rt-${randomUUID()}`,
      expiresInSeconds: 3600,
      scopes: 'read:jira-user read:jira-work write:jira-work offline_access',
    };
  }
  async refreshTokens() {
    return this.exchangeCode();
  }
  async accessibleResources() {
    return [SITE];
  }
  async me() {
    if (!this.profile) throw new Error('no profile');
    return this.profile;
  }
  async listUsers() {
    return [];
  }
  async getIssue(_t: string, _c: string, key: string) {
    const i = this.issues.get(key);
    return i ? { ...i } : null;
  }
  async createIssue(
    _t: string,
    _c: string,
    input: { projectKey: string; summary: string; description: string },
  ) {
    this.created.push(input);
    const key = `${input.projectKey}-${this.next++}`;
    this.issues.set(key, {
      key,
      summary: input.summary,
      status: 'To Do',
      statusCategory: 'new',
      issueType: 'Task',
      priority: null,
      assigneeAccountId: null,
    });
    return { key };
  }
  countFails = false;
  async listProjects() {
    return [
      { id: '1', key: 'PROJ', name: 'Project' },
      { id: '2', key: 'OPS', name: 'Operations' },
    ];
  }
  async countJql() {
    if (this.countFails) throw new Error('Jira down');
    return 42;
  }
  async searchJql() {
    return [
      { key: 'PROJ-9', summary: 'Ship it', status: 'In Progress', priority: null, dueDate: null, updated: '2026-10-08T01:00:00Z' },
    ];
  }
  async getTransitions() {
    return Object.entries(STATUS).map(([id, s]) => ({ id, name: s.name, toCategory: s.category }));
  }
  async transitionIssue(token: string, _c: string, issueKey: string, transitionId: string) {
    this.transitioned.push({ issueKey, transitionId, token });
    const issue = this.issues.get(issueKey);
    if (issue) {
      issue.status = STATUS[transitionId].name;
      issue.statusCategory = STATUS[transitionId].category;
    }
  }
}

describe('pickTransition', () => {
  const ts = [
    { id: '11', name: 'To Do', toCategory: 'new' },
    { id: '21', name: 'In Progress', toCategory: 'indeterminate' },
    { id: '31', name: 'Done', toCategory: 'done' },
  ];
  it('picks done for completion and prefers in-progress for reopening', () => {
    expect(pickTransition(ts, 'done')?.id).toBe('31');
    expect(pickTransition(ts, 'open')?.id).toBe('21');
    expect(pickTransition([ts[0], ts[2]], 'open')?.id).toBe('11');
    expect(pickTransition([ts[0]], 'done')).toBeNull();
    expect(pickTransition([{ id: '1', name: 'x' }], 'open')).toBeNull();
  });
});

describe('task ↔ Jira sync (e2e, fake Jira)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const jira = new FakeJira();
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
    email: string;
  }
  let alice: Actor; // owner, connects the workspace
  let bob: Actor; // member, not party to alice's tasks
  let mallory: Actor; // another workspace, never connected
  let workspaceId: string;
  let otherWorkspaceId: string;
  let connectionId: string;
  let webhookSecret: string;

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const newTask = async (who: Actor, ws: string, title: string) =>
    (await http().post(`/workspaces/${ws}/tasks`).set(auth(who)).send({ title }).expect(201)).body
      .data as { id: string };
  const setStatus = (who: Actor, id: string, status: 'OPEN' | 'DONE') =>
    http().patch(`/tasks/${id}`).set(auth(who)).send({ status }).expect(200);
  const hook = (key: string, name: string, category: string, secret = webhookSecret) =>
    http()
      .post(`/webhooks/jira/${connectionId}?secret=${secret}`)
      .send({
        webhookEvent: 'jira:issue_updated',
        issue: {
          key,
          fields: { summary: 's', status: { name, statusCategory: { key: category } } },
        },
        changelog: { items: [{ field: 'status', fromString: 'x', toString: name }] },
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AtlassianApiService)
      .useValue(jira)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const email = `tj-${name}-${run}@test.local`;
      const res = await http()
        .post('/auth/signup')
        .send({ email, password: 'password123!', displayName: `${name} tj` })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken, email };
    };
    alice = await mk('alice');
    bob = await mk('bob');
    mallory = await mk('mallory');

    workspaceId = (
      await http()
        .post('/workspaces')
        .set(auth(alice))
        .send({ name: `TaskJira ${run}` })
        .expect(201)
    ).body.data.id;
    otherWorkspaceId = (
      await http()
        .post('/workspaces')
        .set(auth(mallory))
        .send({ name: `TJ other ${run}` })
        .expect(201)
    ).body.data.id;
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

    // Connect the workspace to the fake Jira (workspace-level OAuth).
    const urlRes = await http()
      .get(`/workspaces/${workspaceId}/atlassian/connect-url`)
      .set(auth(alice))
      .expect(200);
    const state = new URL(urlRes.body.data.url).searchParams.get('state')!;
    await http()
      .get(`/atlassian/callback?code=c&state=${encodeURIComponent(state)}`)
      .expect(302);
    const connection = await prisma.atlassianConnection.findUniqueOrThrow({
      where: { workspaceId },
    });
    connectionId = connection.id;
    webhookSecret = connection.webhookSecret;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  let taskId: string;

  it('creates a Jira issue from a task and links it', async () => {
    taskId = (await newTask(alice, workspaceId, 'Write the migration guide')).id;
    const res = await http()
      .post(`/tasks/${taskId}/jira`)
      .set(auth(alice))
      .send({ projectKey: 'proj' })
      .expect(201);
    const key = res.body.data.jira.key as string;
    expect(key).toMatch(/^PROJ-\d+$/);
    expect(res.body.data.jira).toEqual({ key, url: `${SITE.url}/browse/${key}`, status: 'To Do' });
    expect(jira.created.at(-1)).toMatchObject({
      projectKey: 'PROJ',
      summary: 'Write the migration guide',
    });

    // Linking twice, or by someone who can't see the task, is refused.
    await http()
      .post(`/tasks/${taskId}/jira`)
      .set(auth(alice))
      .send({ projectKey: 'PROJ' })
      .expect(409);
    await http()
      .post(`/tasks/${taskId}/jira`)
      .set(auth(bob))
      .send({ projectKey: 'PROJ' })
      .expect(404);
  });

  it('links an existing issue, validating the key and that it exists', async () => {
    jira.issues.set('OPS-7', {
      key: 'OPS-7',
      summary: 'Rotate keys',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      issueType: 'Task',
      priority: null,
      assigneeAccountId: null,
    });
    const t = await newTask(alice, workspaceId, 'Rotate the API keys');
    await http()
      .post(`/tasks/${t.id}/jira/link`)
      .set(auth(alice))
      .send({ issueKey: 'not a key' })
      .expect(400);
    await http()
      .post(`/tasks/${t.id}/jira/link`)
      .set(auth(alice))
      .send({ issueKey: 'OPS-404' })
      .expect(404);
    const res = await http()
      .post(`/tasks/${t.id}/jira/link`)
      .set(auth(alice))
      .send({ issueKey: 'ops-7' })
      .expect(201);
    expect(res.body.data.jira).toEqual({
      key: 'OPS-7',
      url: `${SITE.url}/browse/OPS-7`,
      status: 'In Progress',
    });

    const un = await http().delete(`/tasks/${t.id}/jira`).set(auth(alice)).expect(200);
    expect(un.body.data.jira).toBeNull();
  });

  it('refuses when the workspace is not connected to Jira', async () => {
    const t = await newTask(mallory, otherWorkspaceId, 'Nope');
    await http()
      .post(`/tasks/${t.id}/jira`)
      .set(auth(mallory))
      .send({ projectKey: 'PROJ' })
      .expect(404);
  });

  it('without a personal Atlassian link, completing records why Jira was not updated', async () => {
    const res = await setStatus(alice, taskId, 'DONE');
    expect(res.body.data.status).toBe('DONE');
    expect(res.body.data.jiraSyncError).toMatch(/Connect your Atlassian account/);
    expect(jira.transitioned).toHaveLength(0);
  });

  it('with a personal link, completing/reopening transitions the issue as that person', async () => {
    // Personal "connect my account" flow → Alice's own token.
    const urlRes = await http()
      .get(`/workspaces/${workspaceId}/atlassian/user-connect-url`)
      .set(auth(alice))
      .expect(200);
    const state = new URL(urlRes.body.data.url).searchParams.get('state')!;
    jira.profile = {
      accountId: `acc-alice-${run}`,
      email: alice.email,
      emailVerified: true,
      displayName: 'Alice',
      avatarUrl: null,
    };
    await http()
      .get(`/atlassian/callback?code=u&state=${encodeURIComponent(state)}`)
      .expect(302);

    const key = (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).jiraIssueKey!;
    // The earlier completion never reached Jira, so the issue is still open:
    // reopening needs no transition, but clears the stale error.
    const synced = await setStatus(alice, taskId, 'OPEN');
    expect(synced.body.data.jiraSyncError).toBeNull();
    expect(synced.body.data.jira.status).toBe('To Do');
    expect(jira.transitioned).toHaveLength(0);

    const done = await setStatus(alice, taskId, 'DONE');
    expect(done.body.data.jira.status).toBe('Done');
    expect(jira.transitioned.at(-1)).toMatchObject({ issueKey: key, transitionId: '31' });

    const reopened = await setStatus(alice, taskId, 'OPEN');
    expect(reopened.body.data.jira.status).toBe('In Progress');
    expect(jira.transitioned.at(-1)).toMatchObject({ issueKey: key, transitionId: '21' });

    const doneAgain = await setStatus(alice, taskId, 'DONE');
    expect(doneAgain.body.data.jira.status).toBe('Done');
    expect(doneAgain.body.data.jiraSyncError).toBeNull();

    // The workspace connection token is never used for these writes.
    const conn = await prisma.atlassianConnection.findUniqueOrThrow({ where: { workspaceId } });
    expect(jira.transitioned.every((t) => t.token !== conn.accessTokenEnc)).toBe(true);
  });

  it('Jira status webhooks reopen and complete the linked task (and never push back)', async () => {
    const key = (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).jiraIssueKey!;
    const pushedBefore = jira.transitioned.length;

    await hook(key, 'To Do', 'new').expect(200);
    let t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(t.status).toBe('OPEN');
    expect(t.completedAt).toBeNull();
    expect(t.jiraStatus).toBe('To Do');

    await hook(key, 'Done', 'done').expect(200);
    t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(t.status).toBe('DONE');
    expect(t.completedAt).toBeTruthy();
    expect(jira.transitioned.length).toBe(pushedBefore); // no echo back to Jira

    // A forged webhook changes nothing.
    await hook(key, 'To Do', 'new', 'wrong-secret').expect(401);
    t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(t.status).toBe('DONE');
  });

  it('Applications Hub overview: live Atlassian figures, partial failures, scoping', async () => {
    const res = await http()
      .get(`/workspaces/${workspaceId}/applications/atlassian`)
      .set(auth(bob))
      .expect(200);
    const o = res.body.data;
    expect(o).toMatchObject({
      connected: true,
      siteUrl: SITE.url,
      projects: 2,
      openIssues: 42,
      confluenceSpaces: null, // Confluence not granted on this connection
      linkedMembers: 1, // Alice linked her own account earlier
      problems: [],
    });
    expect(o.recent[0]).toMatchObject({ key: 'PROJ-9', url: `${SITE.url}/browse/PROJ-9` });

    jira.countFails = true;
    const partial = (
      await http().get(`/workspaces/${workspaceId}/applications/atlassian`).set(auth(alice)).expect(200)
    ).body.data;
    expect(partial.openIssues).toBeNull();
    expect(partial.problems).toEqual(['open issue count']);
    expect(partial.projects).toBe(2);
    jira.countFails = false;

    const other = await http()
      .get(`/workspaces/${otherWorkspaceId}/applications/atlassian`)
      .set(auth(mallory))
      .expect(200);
    expect(other.body.data).toEqual({ connected: false });
    await http().get(`/workspaces/${workspaceId}/applications/atlassian`).set(auth(mallory)).expect(404);
  });
});
