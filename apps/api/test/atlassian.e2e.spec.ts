import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  AtlassianApiService,
  type AtlassianDirectoryUser,
  type AtlassianProfile,
  type JiraIssueSummary,
} from '../src/atlassian/atlassian-api.service';
import { ConfluenceApiService } from '../src/atlassian/confluence-api.service';

class MockConfluenceApi {
  spaces = [{ key: 'DEV', name: 'Development', id: '100' }];
  pages = new Map<
    string,
    { id: string; title: string; version: number; body: string; webui: string | null }
  >();
  private seq = 1;
  async listSpaces() {
    return this.spaces;
  }
  async listPages() {
    return [...this.pages.values()];
  }
  async getPage(_t: string, _c: string, pageId: string) {
    return this.pages.get(pageId) ?? null;
  }
  async getPageSummary(_t: string, _c: string, pageId: string) {
    return this.pages.get(pageId) ?? null;
  }
  async createPage(_t: string, _c: string, input: { spaceKey: string; title: string; body: string }) {
    const id = `pg-${this.seq++}`;
    const page = {
      id,
      title: input.title,
      version: 1,
      body: input.body,
      webui: `/spaces/${input.spaceKey}/pages/${id}`,
    };
    this.pages.set(id, page);
    return page;
  }
  async updatePage(
    _t: string,
    _c: string,
    pageId: string,
    input: { title: string; body: string; version: number },
  ) {
    const prev = this.pages.get(pageId);
    const page = {
      id: pageId,
      title: input.title,
      version: input.version + 1,
      body: input.body,
      webui: prev?.webui ?? null,
    };
    this.pages.set(pageId, page);
    return page;
  }
  async deletePage(_t: string, _c: string, pageId: string) {
    this.pages.delete(pageId);
  }
}

const SITE = { id: 'cloud-test-1', url: 'https://testsite.atlassian.net', name: 'Test Site' };

interface MockJiraRow {
  key: string;
  summary: string;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  updated: string | null;
}

class MockAtlassianApi {
  directory: AtlassianDirectoryUser[] = [];
  issues = new Map<string, JiraIssueSummary>();
  profile: AtlassianProfile | null = null;
  createdIssues: Array<{ projectKey: string; summary: string }> = [];
  assigned: Array<{ issueKey: string; accountId: string }> = [];
  transitioned: Array<{ issueKey: string; transitionId: string }> = [];
  comments: Array<{ issueKey: string; text: string }> = [];
  private readonly transitionNames: Record<string, string> = {
    '11': 'To Do',
    '21': 'In Progress',
    '31': 'Done',
  };

  authorizeUrl(state: string, scopes: string[]): string {
    return `https://auth.atlassian.test/authorize?state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scopes.join(' '))}`;
  }
  async exchangeCode() {
    return {
      accessToken: `at-${randomUUID()}`,
      refreshToken: `rt-${randomUUID()}`,
      expiresInSeconds: 3600,
      scopes:
        'read:jira-user read:jira-work write:jira-work ' +
        'read:space:confluence read:page:confluence write:page:confluence delete:page:confluence offline_access',
    };
  }
  async refreshTokens() {
    return this.exchangeCode();
  }
  async accessibleResources() {
    return [SITE];
  }
  async me(): Promise<AtlassianProfile> {
    if (!this.profile) throw new Error('no profile configured');
    return this.profile;
  }
  async listUsers() {
    return this.directory;
  }
  async getIssue(_t: string, _c: string, key: string) {
    return this.issues.get(key) ?? null;
  }
  async createIssue(_t: string, _c: string, input: { projectKey: string; summary: string }) {
    this.createdIssues.push(input);
    return { key: `${input.projectKey}-999` };
  }
  /** Rows returned by searchJql, plus a log of (jql, token) for assertions. */
  searchRows: MockJiraRow[] = [];
  searches: Array<{ jql: string; token: string }> = [];
  /** Lets a test vary rows by query (e.g. "moved" vs "overdue" digest slices). */
  jqlHandler: ((jql: string) => MockJiraRow[]) | null = null;
  async searchJql(token: string, _c: string, jql: string) {
    this.searches.push({ jql, token });
    return this.jqlHandler ? this.jqlHandler(jql) : this.searchRows;
  }
  async searchIssues(token: string, cloudId: string, projectKey: string) {
    return this.searchJql(token, cloudId, `project="${projectKey}" ORDER BY updated DESC`);
  }
  async listProjects() {
    return [{ id: '1', key: 'PROJ', name: 'Project One' }];
  }
  async getTransitions() {
    return Object.entries(this.transitionNames).map(([id, name]) => ({ id, name }));
  }
  async transitionIssue(_t: string, _c: string, issueKey: string, transitionId: string) {
    this.transitioned.push({ issueKey, transitionId });
    const issue = this.issues.get(issueKey);
    if (issue) issue.status = this.transitionNames[transitionId] ?? issue.status;
  }
  async assignIssue(_t: string, _c: string, issueKey: string, accountId: string) {
    this.assigned.push({ issueKey, accountId });
    const issue = this.issues.get(issueKey);
    if (issue) issue.assigneeAccountId = accountId;
  }
  async addComment(_t: string, _c: string, issueKey: string, text: string) {
    this.comments.push({ issueKey, text });
  }
}

describe('atlassian integration (e2e, mocked Atlassian API)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const mock = new MockAtlassianApi();
  const confMock = new MockConfluenceApi();
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
    email: string;
  }
  let owner: Actor;
  let linkedUser: Actor; // pre-existing Backstages account matched by email
  let plainMember: Actor;
  let workspaceId: string;
  let channelId: string;
  let connectionId: string;
  let webhookSecret: string;

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });

  const ACC = {
    linked: `acc-linked-${run}`,
    newbie: `acc-newbie-${run}`,
    inactive: `acc-inactive-${run}`,
    bot: `acc-bot-${run}`,
  };

  /**
   * Runs the personal "Connect my Atlassian account" OAuth flow for an actor so
   * their writes are attributed to them. Idempotent (the link is upserted).
   * Requires the workspace to already be connected.
   */
  const connectPersonally = async (actor: Actor, accountId: string) => {
    const urlRes = await http()
      .get(`/workspaces/${workspaceId}/atlassian/user-connect-url`)
      .set(auth(actor))
      .expect(200);
    const state = new URL(urlRes.body.data.url).searchParams.get('state')!;
    mock.profile = { accountId, email: actor.email, emailVerified: true, displayName: accountId, avatarUrl: null };
    await http()
      .get(`/atlassian/callback?code=user-code&state=${encodeURIComponent(state)}`)
      .expect(302);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AtlassianApiService)
      .useValue(mock)
      .overrideProvider(ConfluenceApiService)
      .useValue(confMock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const email = `atl-${name}-${run}@test.local`;
      const res = await http()
        .post('/auth/signup')
        .send({ email, password: 'password123!', displayName: `${name} atl` })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken, email };
    };
    owner = await mk('owner');
    linkedUser = await mk('linked');
    plainMember = await mk('member');

    const ws = await http()
      .post('/workspaces')
      .set(auth(owner))
      .send({ name: `Atlassian ${run}` })
      .expect(201);
    workspaceId = ws.body.data.id;

    const invite = await http()
      .post(`/workspaces/${workspaceId}/invites`)
      .set(auth(owner))
      .send({})
      .expect(201);
    await http().post('/invites/accept').set(auth(plainMember)).send({ token: invite.body.data.token }).expect(200);

    const ch = await http()
      .post(`/workspaces/${workspaceId}/channels`)
      .set(auth(owner))
      .send({ name: 'jira-feed' })
      .expect(201);
    channelId = ch.body.data.id;
    await http().post(`/channels/${channelId}/join`).set(auth(plainMember)).expect(200);

    // Directory: one matching existing user, one unknown human, one inactive, one bot.
    mock.directory = [
      {
        accountId: ACC.linked,
        accountType: 'atlassian',
        active: true,
        displayName: 'Linked Person',
        email: linkedUser.email,
        avatarUrl: null,
      },
      {
        accountId: ACC.newbie,
        accountType: 'atlassian',
        active: true,
        displayName: 'Newbie FromJira',
        email: `atl-newbie-${run}@test.local`,
        avatarUrl: 'https://avatar.test/newbie.png',
      },
      {
        accountId: ACC.inactive,
        accountType: 'atlassian',
        active: false,
        displayName: 'Gone Person',
        email: `atl-gone-${run}@test.local`,
        avatarUrl: null,
      },
      {
        accountId: ACC.bot,
        accountType: 'app',
        active: true,
        displayName: 'Automation Bot',
        email: null,
        avatarUrl: null,
      },
    ];
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  describe('connect flow (OAuth 3LO)', () => {
    it('only OWNER/ADMIN can start the connect flow', async () => {
      await http().get(`/workspaces/${workspaceId}/atlassian/connect-url`).set(auth(plainMember)).expect(403);
    });

    it('connect-url -> callback creates the connection and runs the initial sync', async () => {
      const urlRes = await http()
        .get(`/workspaces/${workspaceId}/atlassian/connect-url`)
        .set(auth(owner))
        .expect(200);
      const state = new URL(urlRes.body.data.url).searchParams.get('state')!;
      expect(state).toBeTruthy();

      const cb = await http().get(`/atlassian/callback?code=fake-code&state=${encodeURIComponent(state)}`);
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toContain('atlassian=connected');

      const connection = await prisma.atlassianConnection.findUnique({ where: { workspaceId } });
      expect(connection).toBeTruthy();
      expect(connection!.siteId).toBe(SITE.id);
      // Tokens are encrypted at rest, never plaintext.
      expect(connection!.accessTokenEnc).not.toContain('at-');
      expect(connection!.accessTokenEnc.split('.')).toHaveLength(3);
      connectionId = connection!.id;
      webhookSecret = connection!.webhookSecret;

      const status = await http()
        .get(`/workspaces/${workspaceId}/atlassian/status`)
        .set(auth(owner))
        .expect(200);
      expect(status.body.data.connected).toBe(true);
      expect(status.body.data.connection.lastSyncAt).toBeTruthy();
    });

    it('a forged state is rejected', async () => {
      await http().get('/atlassian/callback?code=x&state=forged').expect(401);
    });
  });

  describe('directory sync', () => {
    it('linked the existing account, created a provisional member, flagged the inactive one, skipped the bot', async () => {
      const members = await http()
        .get(`/workspaces/${workspaceId}/members`)
        .set(auth(owner))
        .expect(200);
      const byName = (n: string) =>
        members.body.data.find((m: { user: { displayName: string } }) => m.user.displayName === n);

      // Existing account linked by email — same user id, now a member.
      const linked = members.body.data.find(
        (m: { user: { id: string } }) => m.user.id === linkedUser.id,
      );
      expect(linked).toBeTruthy();
      const link = await prisma.atlassianAccountLink.findUnique({
        where: { atlassianAccountId: ACC.linked },
      });
      expect(link!.userId).toBe(linkedUser.id);

      // Unknown human became a provisional member visible in the member list.
      const provisional = byName('Newbie FromJira');
      expect(provisional).toBeTruthy();
      expect(provisional.user.isProvisional).toBe(true);
      expect(provisional.deactivatedAt).toBeNull();

      // Inactive directory user is flagged.
      const gone = byName('Gone Person');
      expect(gone).toBeTruthy();
      expect(gone.deactivatedAt).not.toBeNull();

      // Bot/app accounts are filtered out entirely.
      expect(byName('Automation Bot')).toBeUndefined();
    });

    it('resync deactivates members who left the directory and reactivates returners', async () => {
      // Newbie disappears from the directory; Gone Person comes back active.
      mock.directory = mock.directory
        .filter((u) => u.accountId !== ACC.newbie)
        .map((u) => (u.accountId === ACC.inactive ? { ...u, active: true } : u));

      const stats = await http()
        .post(`/workspaces/${workspaceId}/atlassian/sync`)
        .set(auth(owner))
        .expect(200);
      expect(stats.body.data.deactivated).toBeGreaterThanOrEqual(1);
      expect(stats.body.data.reactivated).toBeGreaterThanOrEqual(1);

      const members = await http().get(`/workspaces/${workspaceId}/members`).set(auth(owner)).expect(200);
      const newbie = members.body.data.find(
        (m: { user: { displayName: string } }) => m.user.displayName === 'Newbie FromJira',
      );
      expect(newbie.deactivatedAt).not.toBeNull();
      const gone = members.body.data.find(
        (m: { user: { displayName: string } }) => m.user.displayName === 'Gone Person',
      );
      expect(gone.deactivatedAt).toBeNull();

      // Restore the directory for later tests.
      mock.directory.push({
        accountId: ACC.newbie,
        accountType: 'atlassian',
        active: true,
        displayName: 'Newbie FromJira',
        email: `atl-newbie-${run}@test.local`,
        avatarUrl: null,
      });
      await http().post(`/workspaces/${workspaceId}/atlassian/sync`).set(auth(owner)).expect(200);
    });

    it('manual sync requires ADMIN', async () => {
      await http().post(`/workspaces/${workspaceId}/atlassian/sync`).set(auth(plainMember)).expect(403);
    });
  });

  describe('provisional member DM flow', () => {
    it('messages sent to a provisional member are delivered when they activate', async () => {
      const provisionalUser = await prisma.user.findFirstOrThrow({
        where: { displayName: 'Newbie FromJira' },
      });

      // Owner DMs the provisional member right away.
      const dm = await http()
        .post(`/workspaces/${workspaceId}/conversations`)
        .set(auth(owner))
        .send({ memberIds: [provisionalUser.id] })
        .expect(200);
      await http()
        .post(`/conversations/${dm.body.data.id}/messages`)
        .set(auth(owner))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: 'welcome aboard, read this when you join!',
        })
        .expect(201);

      // The provisional member activates by signing up with the same email.
      const claim = await http()
        .post('/auth/signup')
        .send({
          email: `atl-newbie-${run}@test.local`,
          password: 'password123!',
          displayName: 'Newbie Activated',
        })
        .expect(201);
      expect(claim.body.data.user.id).toBe(provisionalUser.id);
      expect(claim.body.data.user.isProvisional).toBe(false);
      const newbieToken = claim.body.data.accessToken;

      // They see the conversation, the message, and an unread badge.
      const convos = await http()
        .get(`/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${newbieToken}`)
        .expect(200);
      expect(convos.body.data.some((c: { id: string }) => c.id === dm.body.data.id)).toBe(true);

      const messages = await http()
        .get(`/conversations/${dm.body.data.id}/messages`)
        .set('Authorization', `Bearer ${newbieToken}`)
        .expect(200);
      expect(messages.body.data.messages[0].contentText).toContain('welcome aboard');

      const unreads = await http()
        .get(`/workspaces/${workspaceId}/unreads`)
        .set('Authorization', `Bearer ${newbieToken}`)
        .expect(200);
      const entry = unreads.body.data.find(
        (u: { conversationId: string | null }) => u.conversationId === dm.body.data.id,
      );
      expect(entry.unread).toBe(1);
    });
  });

  describe('SSO ("Log in with Atlassian")', () => {
    it('activates a provisional member and issues Backstages tokens', async () => {
      // Recreate a provisional user via sync for the SSO path.
      const accId = `acc-sso-${run}`;
      mock.directory.push({
        accountId: accId,
        accountType: 'atlassian',
        active: true,
        displayName: 'Sso Person',
        email: `atl-sso-${run}@test.local`,
        avatarUrl: null,
      });
      await http().post(`/workspaces/${workspaceId}/atlassian/sync`).set(auth(owner)).expect(200);

      mock.profile = {
        accountId: accId,
        email: `atl-sso-${run}@test.local`,
        emailVerified: true,
        displayName: 'Sso Person',
        avatarUrl: null,
      };

      const start = await http().get('/auth/atlassian');
      expect(start.status).toBe(302);
      const state = new URL(start.headers.location).searchParams.get('state')!;

      const cb = await http().get(`/atlassian/callback?code=sso-code&state=${encodeURIComponent(state)}`);
      expect(cb.status).toBe(302);
      const fragment = new URLSearchParams(cb.headers.location.split('#')[1]);
      const access = fragment.get('access')!;
      expect(access).toBeTruthy();

      const me = await http().get('/auth/me').set('Authorization', `Bearer ${access}`).expect(200);
      expect(me.body.data.email).toBe(`atl-sso-${run}@test.local`);
      expect(me.body.data.isProvisional).toBe(false);
    });

    it('rejects SSO for unverified emails with no existing link', async () => {
      mock.profile = {
        accountId: `acc-unverified-${run}`,
        email: `atl-unverified-${run}@test.local`,
        emailVerified: false,
        displayName: 'Shady Person',
        avatarUrl: null,
      };
      const start = await http().get('/auth/atlassian');
      const state = new URL(start.headers.location).searchParams.get('state')!;
      const cb = await http().get(`/atlassian/callback?code=x&state=${encodeURIComponent(state)}`);
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toContain('error=atlassian-email-unverified');
    });
  });

  describe('jira webhooks -> chat', () => {
    const issueBody = (over: Record<string, unknown> = {}) => ({
      webhookEvent: 'jira:issue_updated',
      issue: {
        key: `PROJ-1`,
        fields: {
          summary: 'Fix the flux capacitor',
          status: { name: 'In Progress' },
          project: { key: 'PROJ' },
          assignee: { accountId: ACC.linked, displayName: 'Linked Person' },
        },
      },
      changelog: { items: [{ field: 'assignee', to: ACC.linked, toString: 'Linked Person' }] },
      ...over,
    });

    it('rejects an invalid webhook secret', async () => {
      await http().post(`/webhooks/jira/${connectionId}?secret=wrong`).send(issueBody()).expect(401);
      await http().post(`/webhooks/jira/${connectionId}`).send(issueBody()).expect(401);
    });

    it('subscribes a channel to a project with event filters', async () => {
      await http()
        .post(`/channels/${channelId}/jira/subscriptions`)
        .set(auth(owner))
        .send({ projectKey: 'PROJ', events: ['issue_assigned', 'status_changed'] })
        .expect(201);
      const subs = await http().get(`/channels/${channelId}/jira/subscriptions`).set(auth(owner)).expect(200);
      expect(subs.body.data).toHaveLength(1);
    });

    it('issue assigned -> DMs the linked assignee AND posts a channel card; dedup: no badge for the DM recipient', async () => {
      const res = await http()
        .post(`/webhooks/jira/${connectionId}`)
        .set('x-backstages-secret', webhookSecret)
        .send(issueBody())
        .expect(200);
      expect(res.body.data.handled[0]).toEqual({ event: 'issue_assigned', dm: true, cards: 1 });

      // Personal "Jira" conversation for the assignee.
      const convos = await http()
        .get(`/workspaces/${workspaceId}/conversations`)
        .set(auth(linkedUser))
        .expect(200);
      const jiraDm = convos.body.data.find((c: { title: string | null }) => c.title === 'Jira');
      expect(jiraDm).toBeTruthy();
      const dmMessages = await http()
        .get(`/conversations/${jiraDm.id}/messages`)
        .set(auth(linkedUser))
        .expect(200);
      expect(dmMessages.body.data.messages[0].contentText).toContain('PROJ-1 assigned to Linked Person');
      expect(dmMessages.body.data.messages[0].kind).toBe('INTEGRATION');

      // Channel card exists.
      const channelMessages = await http()
        .get(`/channels/${channelId}/messages`)
        .set(auth(owner))
        .expect(200);
      const card = channelMessages.body.data.messages.find((m: { contentText: string }) =>
        m.contentText.includes('PROJ-1 assigned'),
      );
      expect(card).toBeTruthy();
      expect(card.kind).toBe('INTEGRATION');
      // Webhook feed cards carry an actionable Jira unfurl (drives the buttons).
      expect(card.unfurls[0].key).toBe('PROJ-1');

      // Dedup: the DM'd assignee gets no channel badge from the card...
      const linkedUnreads = await http()
        .get(`/workspaces/${workspaceId}/unreads`)
        .set(auth(linkedUser))
        .expect(200);
      const linkedEntry = linkedUnreads.body.data.find(
        (u: { channelId: string | null }) => u.channelId === channelId,
      );
      // linkedUser is not a channel member — verify their DM badge instead and
      // that plainMember (a channel member, not DM'd) DOES get the badge.
      expect(linkedEntry).toBeUndefined();
      const jiraDmUnread = linkedUnreads.body.data.find(
        (u: { conversationId: string | null }) => u.conversationId === jiraDm.id,
      );
      expect(jiraDmUnread.unread).toBe(1);

      const memberUnreads = await http()
        .get(`/workspaces/${workspaceId}/unreads`)
        .set(auth(plainMember))
        .expect(200);
      const memberEntry = memberUnreads.body.data.find(
        (u: { channelId: string | null }) => u.channelId === channelId,
      );
      expect(memberEntry.unread).toBe(1);
    });

    it('dedup rule holds when the DM recipient is ALSO a channel member', async () => {
      // linkedUser joins the feed channel and catches up.
      await http().post(`/channels/${channelId}/join`).set(auth(linkedUser)).expect(200);
      const msgs = await http().get(`/channels/${channelId}/messages`).set(auth(linkedUser)).expect(200);
      const newest = msgs.body.data.messages.at(-1);
      await http()
        .post(`/channels/${channelId}/read`)
        .set(auth(linkedUser))
        .send({ messageId: newest.id })
        .expect(200);

      // New issue assigned to them again -> DM + card in the channel they're in.
      await http()
        .post(`/webhooks/jira/${connectionId}`)
        .set('x-backstages-secret', webhookSecret)
        .send(
          issueBody({
            issue: {
              key: 'PROJ-2',
              fields: {
                summary: 'Second task',
                status: { name: 'To Do' },
                project: { key: 'PROJ' },
                assignee: { accountId: ACC.linked, displayName: 'Linked Person' },
              },
            },
          }),
        )
        .expect(200);

      const unreads = await http()
        .get(`/workspaces/${workspaceId}/unreads`)
        .set(auth(linkedUser))
        .expect(200);
      const channelEntry = unreads.body.data.find(
        (u: { channelId: string | null }) => u.channelId === channelId,
      );
      // No badge from the card for the DM'd assignee...
      expect(channelEntry.unread).toBe(0);
      // ...while the non-DM'd member sees the new card as unread.
      const memberUnreads = await http()
        .get(`/workspaces/${workspaceId}/unreads`)
        .set(auth(plainMember))
        .expect(200);
      expect(
        memberUnreads.body.data.find((u: { channelId: string | null }) => u.channelId === channelId)
          .unread,
      ).toBe(2);
    });

    it('follow-up events for the same issue thread under the first card', async () => {
      const before = await http().get(`/channels/${channelId}/messages`).set(auth(owner)).expect(200);
      const card = before.body.data.messages.find((m: { contentText: string }) =>
        m.contentText.includes('PROJ-1 assigned'),
      );

      await http()
        .post(`/webhooks/jira/${connectionId}`)
        .set('x-backstages-secret', webhookSecret)
        .send({
          webhookEvent: 'jira:issue_updated',
          issue: {
            key: 'PROJ-1',
            fields: { summary: 'Fix the flux capacitor', status: { name: 'Done' }, project: { key: 'PROJ' } },
          },
          changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
        })
        .expect(200);

      const thread = await http().get(`/messages/${card.id}/thread`).set(auth(owner)).expect(200);
      expect(thread.body.data.replies).toHaveLength(1);
      expect(thread.body.data.replies[0].contentText).toContain('moved In Progress → Done');

      // No second top-level card for PROJ-1.
      const after = await http().get(`/channels/${channelId}/messages`).set(auth(owner)).expect(200);
      const cards = after.body.data.messages.filter((m: { contentText: string }) =>
        m.contentText.includes('PROJ-1'),
      );
      expect(cards).toHaveLength(1);
    });

    it('events not matching the channel filter produce nothing', async () => {
      const before = await http().get(`/channels/${channelId}/messages`).set(auth(owner)).expect(200);
      await http()
        .post(`/webhooks/jira/${connectionId}`)
        .set('x-backstages-secret', webhookSecret)
        .send({
          webhookEvent: 'comment_created',
          issue: { key: 'PROJ-1', fields: { summary: 'x', project: { key: 'PROJ' } } },
          comment: { body: 'a comment', author: { accountId: ACC.linked, displayName: 'Linked' } },
        })
        .expect(200);
      const after = await http().get(`/channels/${channelId}/messages`).set(auth(owner)).expect(200);
      expect(after.body.data.messages.length).toBe(before.body.data.messages.length);
    });

    it('reassigning an issue notifies the previous assignee (task out)', async () => {
      await http()
        .post(`/webhooks/jira/${connectionId}`)
        .set('x-backstages-secret', webhookSecret)
        .send({
          webhookEvent: 'jira:issue_updated',
          issue: {
            key: 'PROJ-1',
            fields: {
              summary: 'Fix the flux capacitor',
              status: { name: 'In Progress' },
              project: { key: 'PROJ' },
              assignee: { accountId: ACC.newbie, displayName: 'Newbie FromJira' },
            },
          },
          changelog: {
            items: [{ field: 'assignee', from: ACC.linked, to: ACC.newbie, toString: 'Newbie FromJira' }],
          },
        })
        .expect(200);

      const convos = await http()
        .get(`/workspaces/${workspaceId}/conversations`)
        .set(auth(linkedUser))
        .expect(200);
      const jiraDm = convos.body.data.find((c: { title: string | null }) => c.title === 'Jira');
      const dmMessages = await http()
        .get(`/conversations/${jiraDm.id}/messages`)
        .set(auth(linkedUser))
        .expect(200);
      expect(
        dmMessages.body.data.messages.some((m: { contentText: string }) =>
          m.contentText.includes('reassigned away from you'),
        ),
      ).toBe(true);
    });
  });

  describe('jira actions', () => {
    it('/jira PROJ-123 posts a status card', async () => {
      mock.issues.set('PROJ-123', {
        key: 'PROJ-123',
        summary: 'Investigate warp drive',
        status: 'In Review',
        issueType: 'Task',
        priority: 'High',
        assigneeAccountId: null,
      });
      const res = await http()
        .post(`/channels/${channelId}/jira/command`)
        .set(auth(owner))
        .send({ issueKey: 'proj-123' })
        .expect(200);
      expect(res.body.data.contentText).toContain('PROJ-123 · Investigate warp drive — In Review');
      expect(res.body.data.kind).toBe('INTEGRATION');
      const unfurls = res.body.data.unfurls as Array<{ key: string; status: string }>;
      expect(unfurls[0].key).toBe('PROJ-123');
      expect(unfurls[0].status).toBe('In Review');
    });

    it('creates a Jira issue from a message and confirms in a thread', async () => {
      const msg = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(plainMember))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: 'The login page is broken on Safari',
        })
        .expect(201);

      const res = await http()
        .post(`/messages/${msg.body.data.id}/create-jira-issue`)
        .set(auth(plainMember))
        .send({ projectKey: 'PROJ' })
        .expect(200);
      expect(res.body.data.key).toBe('PROJ-999');
      expect(mock.createdIssues.at(-1)!.summary).toContain('login page is broken');

      const thread = await http().get(`/messages/${msg.body.data.id}/thread`).set(auth(owner)).expect(200);
      expect(thread.body.data.replies[0].contentText).toContain('Created PROJ-999');
    });

    it('pasted Jira issue URLs get unfurled into status cards', async () => {
      mock.issues.set('PROJ-77', {
        key: 'PROJ-77',
        summary: 'Unfurl me please',
        status: 'To Do',
        issueType: 'Bug',
        priority: null,
        assigneeAccountId: null,
      });
      const msg = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(owner))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: `check this out ${SITE.url}/browse/PROJ-77 before standup`,
        })
        .expect(201);

      // Unfurling is async fire-and-forget; poll briefly.
      let unfurls: unknown = null;
      for (let i = 0; i < 20 && !unfurls; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const row = await prisma.message.findUnique({ where: { id: msg.body.data.id } });
        unfurls = row?.unfurls ?? null;
      }
      expect(unfurls).toBeTruthy();
      const list = unfurls as Array<{ key: string; title: string; status: string }>;
      expect(list[0].key).toBe('PROJ-77');
      expect(list[0].title).toBe('Unfurl me please');
      expect(list[0].status).toBe('To Do');
    });

    it('pasted Confluence page URLs unfurl with the real page title', async () => {
      confMock.pages.set('998877', {
        id: '998877',
        title: 'Release Runbook',
        version: 3,
        body: '<p>steps</p>',
        webui: '/spaces/DEV/pages/998877',
      });
      const msg = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(owner))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: `runbook: ${SITE.url}/wiki/spaces/DEV/pages/998877/Stale+Slug+Title`,
        })
        .expect(201);

      let unfurls: unknown = null;
      for (let i = 0; i < 20 && !unfurls; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const row = await prisma.message.findUnique({ where: { id: msg.body.data.id } });
        unfurls = row?.unfurls ?? null;
      }
      expect(unfurls).toBeTruthy();
      const list = unfurls as Array<{ type: string; title: string; url: string }>;
      expect(list).toHaveLength(1);
      expect(list[0].type).toBe('confluence');
      // Fetched title wins over the (possibly stale) slug in the URL.
      expect(list[0].title).toBe('Release Runbook');
    });

    it('falls back to the URL slug when the page cannot be fetched', async () => {
      const msg = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(owner))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: `see ${SITE.url}/wiki/spaces/DEV/pages/424242/Deploy+Checklist`,
        })
        .expect(201);

      let unfurls: unknown = null;
      for (let i = 0; i < 20 && !unfurls; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const row = await prisma.message.findUnique({ where: { id: msg.body.data.id } });
        unfurls = row?.unfurls ?? null;
      }
      expect(unfurls).toBeTruthy();
      const list = unfurls as Array<{ type: string; title: string }>;
      expect(list[0].type).toBe('confluence');
      expect(list[0].title).toBe('Deploy Checklist');
    });
  });

  describe('jira interactive actions', () => {
    let cardId: string;

    beforeAll(async () => {
      mock.issues.set('PROJ-500', {
        key: 'PROJ-500',
        summary: 'Actionable issue',
        status: 'To Do',
        issueType: 'Task',
        priority: 'Medium',
        assigneeAccountId: null,
      });
      // Owner posts a Jira card that others can act on.
      const res = await http()
        .post(`/channels/${channelId}/jira/command`)
        .set(auth(owner))
        .send({ issueKey: 'PROJ-500' })
        .expect(200);
      cardId = res.body.data.id;
      // Owner personally connects so their actions are attributed to them and
      // not to the shared workspace connection.
      await connectPersonally(owner, `acc-owner-${run}`);
    });

    it('transition moves the issue, updates the card in place, and threads a reply', async () => {
      const res = await http()
        .post(`/messages/${cardId}/jira/action`)
        .set(auth(owner))
        .send({ issueKey: 'PROJ-500', action: 'transition', transitionId: '31' })
        .expect(200);
      expect(res.body.data.status).toBe('Done');
      expect(mock.transitioned.at(-1)).toEqual({ issueKey: 'PROJ-500', transitionId: '31' });

      // Card unfurl reflects the new status.
      const msgs = await http().get(`/channels/${channelId}/messages`).set(auth(owner)).expect(200);
      const card = msgs.body.data.messages.find((m: { id: string }) => m.id === cardId);
      expect(card.unfurls[0].status).toBe('Done');

      // Confirmation lands as a thread reply under the card.
      const thread = await http().get(`/messages/${cardId}/thread`).set(auth(owner)).expect(200);
      expect(thread.body.data.replies.at(-1).contentText).toContain('moved PROJ-500');
      expect(thread.body.data.replies.at(-1).contentText).toContain('Done');
    });

    it('lists transitions for the move picker', async () => {
      const res = await http()
        .get(`/messages/${cardId}/jira/transitions?issueKey=PROJ-500`)
        .set(auth(owner))
        .expect(200);
      expect(res.body.data.map((t: { name: string }) => t.name)).toContain('In Progress');
    });

    it('assign-to-me assigns the caller\'s own Atlassian account', async () => {
      await http()
        .post(`/messages/${cardId}/jira/action`)
        .set(auth(owner))
        .send({ issueKey: 'PROJ-500', action: 'assign_me' })
        .expect(200);
      expect(mock.assigned.at(-1)).toEqual({ issueKey: 'PROJ-500', accountId: `acc-owner-${run}` });
    });

    it('rejects any action from a member who has not personally connected Atlassian', async () => {
      // linkedUser is mapped to a Jira account by directory sync but never did
      // the personal OAuth connect, so has no token of their own. Without this
      // guard the action would post as the workspace connection owner — the bug.
      const res = await http()
        .post(`/messages/${cardId}/jira/action`)
        .set(auth(linkedUser))
        .send({ issueKey: 'PROJ-500', action: 'comment', text: 'should not post' })
        .expect(400);
      expect(res.body.error.message).toMatch(/connect your atlassian account/i);
      // Nothing was sent to Jira on their behalf.
      expect(mock.comments.some((c) => c.text.includes('should not post'))).toBe(false);
    });

    it('rejects an action for an issue not attached to the message', async () => {
      await http()
        .post(`/messages/${cardId}/jira/action`)
        .set(auth(linkedUser))
        .send({ issueKey: 'PROJ-999', action: 'assign_me' })
        .expect(400);
    });

    it('comment posts to Jira as the caller, without a faked name prefix', async () => {
      await http()
        .post(`/messages/${cardId}/jira/action`)
        .set(auth(owner))
        .send({ issueKey: 'PROJ-500', action: 'comment', text: 'looking into this' })
        .expect(200);
      const last = mock.comments.at(-1)!;
      expect(last.issueKey).toBe('PROJ-500');
      expect(last.text).toContain('looking into this');
      expect(last.text).toContain('via Backstages');
      // Authored by the caller's own token now, so it must NOT fake a
      // "<name> (via Backstages):" prefix the way the buggy version did.
      expect(last.text).not.toMatch(/\(via Backstages\):/);
    });

    it('a member can connect their own Jira account for correct attribution', async () => {
      const plainAcc = `acc-plain-${run}`;

      // Before connecting, the member has no personal write grant.
      const before = await http()
        .get(`/workspaces/${workspaceId}/atlassian/status`)
        .set(auth(plainMember))
        .expect(200);
      expect(before.body.data.me.canAct).toBe(false);

      // Start the personal connect — scopes must include write access.
      const urlRes = await http()
        .get(`/workspaces/${workspaceId}/atlassian/user-connect-url`)
        .set(auth(plainMember))
        .expect(200);
      const url = new URL(urlRes.body.data.url);
      expect(url.searchParams.get('scope')).toContain('write:jira-work');
      const state = url.searchParams.get('state')!;

      // Complete the OAuth callback as this member.
      mock.profile = {
        accountId: plainAcc,
        email: plainMember.email,
        emailVerified: true,
        displayName: 'member atl',
        avatarUrl: null,
      };
      const cb = await http().get(`/atlassian/callback?code=user-code&state=${encodeURIComponent(state)}`);
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toContain('atlassian=account-connected');

      // canAct now true.
      const after = await http()
        .get(`/workspaces/${workspaceId}/atlassian/status`)
        .set(auth(plainMember))
        .expect(200);
      expect(after.body.data.me.canAct).toBe(true);

      // Their assign now uses THEIR account id (attribution proof).
      await http()
        .post(`/messages/${cardId}/jira/action`)
        .set(auth(plainMember))
        .send({ issueKey: 'PROJ-500', action: 'assign_me' })
        .expect(200);
      expect(mock.assigned.at(-1)).toEqual({ issueKey: 'PROJ-500', accountId: plainAcc });
    });

    it('lists assignable members and assigns the issue to another member', async () => {
      const list = await http()
        .get(`/messages/${cardId}/jira/assignable?issueKey=PROJ-500`)
        .set(auth(owner))
        .expect(200);
      const accountIds = list.body.data.map((u: { accountId: string }) => u.accountId);
      // linkedUser was linked by the directory sync -> assignable.
      expect(accountIds).toContain(ACC.linked);

      await http()
        .post(`/messages/${cardId}/jira/action`)
        .set(auth(owner))
        .send({ issueKey: 'PROJ-500', action: 'assign', assigneeAccountId: ACC.linked })
        .expect(200);
      expect(mock.assigned.at(-1)).toEqual({ issueKey: 'PROJ-500', accountId: ACC.linked });
    });
  });

  describe('my jira work queue', () => {
    // plainMember personally connected in the previous describe.
    beforeEach(() => {
      mock.searches = [];
      const today = new Date();
      const past = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10);
      const future = new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10);
      mock.searchRows = [
        { key: 'PROJ-11', summary: 'Late thing', status: 'In Progress', priority: 'High', dueDate: past, updated: null },
        { key: 'PROJ-12', summary: 'Future thing', status: 'To Do', priority: null, dueDate: future, updated: null },
        { key: 'PROJ-13', summary: 'No due date', status: 'To Do', priority: null, dueDate: null, updated: null },
      ];
    });

    it('returns the caller-scoped open issues and flags overdue ones', async () => {
      const res = await http()
        .get(`/workspaces/${workspaceId}/jira/my-issues`)
        .set(auth(plainMember))
        .expect(200);

      const rows = res.body.data as Array<{ key: string; overdue: boolean; url: string }>;
      expect(rows.map((r) => r.key)).toEqual(['PROJ-11', 'PROJ-12', 'PROJ-13']);
      // Overdue is computed on the server so client/server agree on "today".
      expect(rows.find((r) => r.key === 'PROJ-11')!.overdue).toBe(true);
      expect(rows.find((r) => r.key === 'PROJ-12')!.overdue).toBe(false);
      expect(rows.find((r) => r.key === 'PROJ-13')!.overdue).toBe(false);
      expect(rows[0].url).toBe(`${SITE.url}/browse/PROJ-11`);

      // Scoped to the caller and to open work only.
      const jql = mock.searches.at(-1)!.jql;
      expect(jql).toContain('assignee = currentUser()');
      expect(jql).toContain('statusCategory != Done');
    });

    it('refuses to fall back to the workspace token for an unlinked caller', async () => {
      // currentUser() resolves to the token owner, so a fallback would hand back
      // the connecting admin's issues. It must fail loudly instead.
      const res = await http()
        .get(`/workspaces/${workspaceId}/jira/my-issues`)
        .set(auth(linkedUser))
        .expect(400);
      expect(res.body.error.message).toMatch(/connect your atlassian account/i);
      expect(mock.searches).toHaveLength(0);
    });
  });

  describe('standup digest', () => {
    const row = (key: string, summary: string, status: string): MockJiraRow => ({
      key,
      summary,
      status,
      priority: null,
      dueDate: null,
      updated: null,
    });

    afterEach(() => {
      mock.jqlHandler = null;
    });

    const latestMessage = async () =>
      prisma.message.findFirst({ where: { channelId }, orderBy: { createdAt: 'desc' } });

    it('posts what moved and what is overdue for the subscribed project', async () => {
      mock.searches = [];
      mock.jqlHandler = (jql) =>
        jql.includes('duedate <')
          ? [row('PROJ-70', 'Overdue thing', 'In Progress')]
          : [row('PROJ-71', 'Moved thing', 'Done')];

      const res = await http()
        .post(`/channels/${channelId}/jira/digest`)
        .set(auth(owner))
        .expect(200);
      expect(res.body.data.posted).toBe(true);

      const msg = await latestMessage();
      expect(msg!.contentText).toContain('Standup digest');
      expect(msg!.contentText).toContain('PROJ — 1 updated since yesterday, 1 overdue');
      expect(msg!.contentText).toContain('Moved: PROJ-71');
      expect(msg!.contentText).toContain('Overdue: PROJ-70');
      expect(msg!.kind).toBe('INTEGRATION');

      // Both slices avoid workflow-specific status names.
      const jqls = mock.searches.map((s) => s.jql).join(' | ');
      expect(jqls).toContain('updated >= -1d');
      expect(jqls).toContain('statusCategory != Done');
      expect(jqls).not.toMatch(/status\s*=\s*"?Blocked/i);
    });

    it('says nothing when there is nothing to report', async () => {
      mock.jqlHandler = () => [];
      const before = await latestMessage();

      const res = await http()
        .post(`/channels/${channelId}/jira/digest`)
        .set(auth(owner))
        .expect(200);
      expect(res.body.data.posted).toBe(false);

      const after = await latestMessage();
      expect(after!.id).toBe(before!.id);
    });

    it('is refused for a non-member of the channel', async () => {
      mock.jqlHandler = () => [];
      const outsider = await http()
        .post('/auth/signup')
        .send({
          email: `digest-out-${run}@test.local`,
          password: 'password123!',
          displayName: 'Digest Outsider',
        })
        .expect(201);
      const res = await http()
        .post(`/channels/${channelId}/jira/digest`)
        .set({ Authorization: `Bearer ${outsider.body.data.accessToken}` });
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('slash commands', () => {
    it('lists the commands the registered apps contribute', async () => {
      const res = await http()
        .get(`/workspaces/${workspaceId}/commands`)
        .set(auth(owner))
        .expect(200);
      const usages = res.body.data.map((c: { usage: string }) => c.usage);
      expect(usages).toEqual(
        expect.arrayContaining(['/jira KEY-123', '/jira create <summary>', '/incident <title>']),
      );
    });

    it('runs /jira KEY-123 server-side and posts the card', async () => {
      mock.issues.set('PROJ-321', {
        key: 'PROJ-321',
        summary: 'Via the command framework',
        status: 'To Do',
        issueType: 'Task',
        priority: null,
        assigneeAccountId: null,
      });
      const res = await http()
        .post(`/channels/${channelId}/commands`)
        .set(auth(owner))
        .send({ text: '/jira PROJ-321' })
        .expect(200);
      expect(res.body.data).toMatchObject({ handled: true, message: 'Posted PROJ-321' });

      const msg = await prisma.message.findFirst({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
      });
      expect(msg!.contentText).toContain('PROJ-321');
    });

    it('resolves the subcommand ahead of the bare command', async () => {
      // The dangerous case: "/jira create ..." must not be read as an issue key.
      const res = await http()
        .post(`/channels/${channelId}/commands`)
        .set(auth(owner))
        .send({ text: '/jira create fix the flaky test' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        handled: true,
        dialog: 'jira-create',
        args: 'fix the flaky test',
      });
    });

    it('hands /incident to the client dialog with the title', async () => {
      const res = await http()
        .post(`/channels/${channelId}/commands`)
        .set(auth(owner))
        .send({ text: '/incident checkout is down' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        handled: true,
        dialog: 'incident',
        args: 'checkout is down',
      });
    });

    it('rejects an unknown command instead of posting it as a message', async () => {
      const before = await prisma.message.count({ where: { channelId } });
      const res = await http()
        .post(`/channels/${channelId}/commands`)
        .set(auth(owner))
        .send({ text: '/nope do something' })
        .expect(400);
      expect(res.body.error.message).toMatch(/unknown command \/nope/i);
      expect(await prisma.message.count({ where: { channelId } })).toBe(before);
    });

    it('explains a malformed issue key rather than failing opaquely', async () => {
      const res = await http()
        .post(`/channels/${channelId}/commands`)
        .set(auth(owner))
        .send({ text: '/jira not-a-key' })
        .expect(400);
      expect(res.body.error.message).toMatch(/is not an issue key/i);
    });
  });

  describe('bitbucket pull requests', () => {
    let bbChannelId: string;
    let subId: string;
    let webhookUrl: string;
    const secretOf = (url: string) => new URL(url, 'http://x').searchParams.get('secret')!;

    const prBody = (id: number, extra: Record<string, unknown> = {}) => ({
      repository: { full_name: 'acme/api' },
      actor: { display_name: 'Dev Person' },
      pullrequest: {
        id,
        title: 'Add retry to the payments client',
        state: 'OPEN',
        links: { html: { href: `https://bitbucket.org/acme/api/pull-requests/${id}` } },
        author: { display_name: 'Dev Person' },
        source: { branch: { name: 'feat/retry' } },
        destination: { branch: { name: 'main' } },
        ...extra,
      },
    });

    const post = (id: string, secret: string, eventKey: string, body: object) =>
      http()
        .post(`/webhooks/bitbucket/${id}?secret=${secret}`)
        .set('x-event-key', eventKey)
        .send(body);

    beforeAll(async () => {
      const ch = await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(owner))
        .send({ name: `bitbucket-feed-${run}` })
        .expect(201);
      bbChannelId = ch.body.data.id;

      const sub = await http()
        .post(`/channels/${bbChannelId}/bitbucket/subscriptions`)
        .set(auth(owner))
        .send({
          repoFullName: 'acme/api',
          events: ['pr_created', 'pr_approved', 'pr_merged'],
        })
        .expect(201);
      subId = sub.body.data.id;
      webhookUrl = sub.body.data.webhookUrl;
      expect(webhookUrl).toContain(`/webhooks/bitbucket/${subId}`);
    });

    it('rejects a webhook with the wrong secret', async () => {
      await post(subId, 'not-the-secret', 'pullrequest:created', prBody(1)).expect(401);
    });

    it('posts a card for a new PR and threads later events under it', async () => {
      const secret = secretOf(webhookUrl);

      await post(subId, secret, 'pullrequest:created', prBody(42)).expect(200);
      const card = await prisma.message.findFirst({
        where: { channelId: bbChannelId, parentId: null, kind: 'INTEGRATION' },
        orderBy: { createdAt: 'desc' },
      });
      expect(card!.contentText).toContain('PR #42 opened by Dev Person (feat/retry → main)');
      const unfurls = card!.unfurls as Array<{ type: string; url: string; status?: string }>;
      expect(unfurls[0].type).toBe('bitbucket');
      expect(unfurls[0].url).toContain('/pull-requests/42');

      // Approval and merge thread under the original card, not as new cards.
      await post(subId, secret, 'pullrequest:approved', {
        ...prBody(42),
        approval: { user: { display_name: 'Reviewer Person' } },
      }).expect(200);
      await post(subId, secret, 'pullrequest:fulfilled', prBody(42, { state: 'MERGED' })).expect(200);

      const replies = await prisma.message.findMany({
        where: { parentId: card!.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(replies.map((r) => r.contentText)).toEqual([
        expect.stringContaining('PR #42 approved by Reviewer Person'),
        expect.stringContaining('PR #42 merged'),
      ]);

      // The top card's badge follows the PR state.
      const refreshed = await prisma.message.findUnique({ where: { id: card!.id } });
      const after = refreshed!.unfurls as Array<{ status?: string }>;
      expect(after[0].status).toBe('MERGED');

      const roots = await prisma.message.count({
        where: { channelId: bbChannelId, parentId: null, kind: 'INTEGRATION' },
      });
      expect(roots).toBe(1);
    });

    it('ignores events the channel did not subscribe to', async () => {
      const secret = secretOf(webhookUrl);
      const before = await prisma.message.count({ where: { channelId: bbChannelId } });
      const res = await post(subId, secret, 'pullrequest:updated', prBody(43)).expect(200);
      expect(res.body.data.posted).toBe(false);
      expect(await prisma.message.count({ where: { channelId: bbChannelId } })).toBe(before);
    });

    it('ignores a payload for a different repository', async () => {
      const secret = secretOf(webhookUrl);
      const before = await prisma.message.count({ where: { channelId: bbChannelId } });
      const res = await post(subId, secret, 'pullrequest:created', {
        ...prBody(44),
        repository: { full_name: 'someone-else/evil' },
      }).expect(200);
      expect(res.body.data.posted).toBe(false);
      expect(await prisma.message.count({ where: { channelId: bbChannelId } })).toBe(before);
    });

    it('re-subscribing rotates the secret so the old one stops working', async () => {
      const oldSecret = secretOf(webhookUrl);
      const again = await http()
        .post(`/channels/${bbChannelId}/bitbucket/subscriptions`)
        .set(auth(owner))
        .send({ repoFullName: 'acme/api', events: ['pr_created'] })
        .expect(201);
      const newSecret = secretOf(again.body.data.webhookUrl);
      expect(newSecret).not.toBe(oldSecret);

      await post(subId, oldSecret, 'pullrequest:created', prBody(45)).expect(401);
      await post(subId, newSecret, 'pullrequest:created', prBody(45)).expect(200);
      webhookUrl = again.body.data.webhookUrl;
    });

    it('lists and deletes subscriptions', async () => {
      const list = await http()
        .get(`/channels/${bbChannelId}/bitbucket/subscriptions`)
        .set(auth(owner))
        .expect(200);
      expect(list.body.data.map((s: { repoFullName: string }) => s.repoFullName)).toEqual(['acme/api']);

      await http()
        .delete(`/channels/${bbChannelId}/bitbucket/subscriptions/${subId}`)
        .set(auth(owner))
        .expect(200);
      const after = await http()
        .get(`/channels/${bbChannelId}/bitbucket/subscriptions`)
        .set(auth(owner))
        .expect(200);
      expect(after.body.data).toEqual([]);
    });
  });

  describe('incident flow', () => {
    it('creates the channel, the tracking issue and the postmortem page, cross-linked', async () => {
      const res = await http()
        .post(`/workspaces/${workspaceId}/incident`)
        .set(auth(owner))
        .send({ title: 'Checkout 500s', projectKey: 'PROJ', spaceKey: 'DEV', severity: 'sev1' })
        .expect(200);

      const inc = res.body.data;
      expect(inc.channelName).toBe('inc-checkout-500s');
      expect(inc.issueKey).toBe('PROJ-999');
      expect(inc.issueUrl).toBe(`${SITE.url}/browse/PROJ-999`);
      expect(inc.warnings).toEqual([]);

      // The Jira summary carries the severity.
      expect(mock.createdIssues.at(-1)!.summary).toBe('[SEV1] Checkout 500s');

      // Postmortem page exists and links back to the issue and channel.
      const page = confMock.pages.get(inc.pageId)!;
      expect(page.title).toBe('Postmortem: Checkout 500s');
      expect(page.body).toContain('PROJ-999');
      expect(page.body).toContain('inc-checkout-500s');
      expect(page.body).toContain('Root cause');

      // Kickoff message in the new channel links both.
      const msg = await prisma.message.findFirst({
        where: { channelId: inc.channelId },
        orderBy: { createdAt: 'desc' },
      });
      expect(msg!.contentText).toContain('SEV1 incident: Checkout 500s');
      const unfurls = msg!.unfurls as Array<{ type: string; url: string }>;
      expect(unfurls.map((u) => u.type).sort()).toEqual(['confluence', 'jira']);

      // The declaring user is a member of the incident channel.
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: inc.channelId, userId: owner.id } },
      });
      expect(membership).toBeTruthy();
    });

    it('suffixes the channel name when an incident repeats', async () => {
      const res = await http()
        .post(`/workspaces/${workspaceId}/incident`)
        .set(auth(owner))
        .send({ title: 'Checkout 500s', projectKey: 'PROJ' })
        .expect(200);
      expect(res.body.data.channelName).toBe('inc-checkout-500s-2');
      // No spaceKey given -> no page, and that is not a warning.
      expect(res.body.data.pageId).toBeNull();
      expect(res.body.data.warnings).toEqual([]);
    });

    it('keeps the channel and issue when the postmortem page fails', async () => {
      const boom = jest
        .spyOn(confMock, 'createPage')
        .mockRejectedValueOnce(new Error('confluence down'));

      const res = await http()
        .post(`/workspaces/${workspaceId}/incident`)
        .set(auth(owner))
        .send({ title: 'Payments degraded', projectKey: 'PROJ', spaceKey: 'DEV' })
        .expect(200);

      expect(res.body.data.channelName).toBe('inc-payments-degraded');
      expect(res.body.data.issueKey).toBe('PROJ-999');
      expect(res.body.data.pageId).toBeNull();
      expect(res.body.data.warnings).toContain('Postmortem page could not be created.');
      boom.mockRestore();
    });

    it('falls back to a usable name for a title with no usable characters', async () => {
      const res = await http()
        .post(`/workspaces/${workspaceId}/incident`)
        .set(auth(owner))
        .send({ title: '!!! ???', projectKey: 'PROJ' })
        .expect(200);
      expect(res.body.data.channelName).toBe('inc-incident');
    });
  });

  describe('confluence pages', () => {
    beforeAll(async () => {
      // Page writes are attributed to the token owner, so the acting user must
      // have personally connected. Idempotent if an earlier describe did it.
      await connectPersonally(owner, `acc-owner-${run}`);
    });

    it('lists spaces from the connected site', async () => {
      const res = await http()
        .get(`/workspaces/${workspaceId}/confluence/spaces`)
        .set(auth(owner))
        .expect(200);
      expect(res.body.data.map((s: { key: string }) => s.key)).toContain('DEV');
    });

    it('refuses to create a page for a member who has not connected Atlassian', async () => {
      // linkedUser is a workspace member (directory sync) but never personally
      // connected — the page would otherwise be authored by the shared
      // workspace connection ("Kevin Julian"), not them.
      const res = await http()
        .post(`/workspaces/${workspaceId}/confluence/pages`)
        .set(auth(linkedUser))
        .send({ spaceKey: 'DEV', title: 'Should be blocked', body: 'nope' })
        .expect(403);
      expect(res.body.error.message).toMatch(/connect your own atlassian account/i);
    });

    it('captures a whole thread as a page and links it back into the thread', async () => {
      const root = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(owner))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: 'Should we ship the migration on Friday?',
        })
        .expect(201);
      const rootId = root.body.data.id;

      await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(plainMember))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: 'No — rollback window is too tight. Monday.',
          parentId: rootId,
        })
        .expect(201);

      // Called from the REPLY, not the root: the whole thread is still captured.
      const replies = await http().get(`/messages/${rootId}/thread`).set(auth(owner)).expect(200);
      const replyId = replies.body.data.replies[0].id;

      const res = await http()
        .post(`/messages/${replyId}/confluence-page`)
        .set(auth(owner))
        .send({ spaceKey: 'DEV' })
        .expect(200);

      // Title defaults to the thread opener, not the message that was clicked.
      expect(res.body.data.title).toBe('Should we ship the migration on Friday?');

      const page = confMock.pages.get(res.body.data.id)!;
      expect(page.body).toContain('Should we ship the migration on Friday?');
      expect(page.body).toContain('rollback window is too tight');
      expect(page.body).toContain('Participants:');
      // Provenance link back to the source thread.
      expect(page.body).toContain(`thread=${rootId}`);

      // The confirmation lands as a reply in the same thread.
      const after = await http().get(`/messages/${rootId}/thread`).set(auth(owner)).expect(200);
      const confirmation = after.body.data.replies.find((r: { contentText: string }) =>
        r.contentText.startsWith('Saved this thread to Confluence'),
      );
      expect(confirmation).toBeTruthy();
      expect(confirmation.unfurls[0].type).toBe('confluence');
    });

    it('escapes user text so a thread cannot inject storage-format markup', async () => {
      const root = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(owner))
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: '<script>alert(1)</script> & <h1>not a heading</h1>',
        })
        .expect(201);

      const res = await http()
        .post(`/messages/${root.body.data.id}/confluence-page`)
        .set(auth(owner))
        .send({ spaceKey: 'DEV', title: 'Escaping check' })
        .expect(200);

      const page = confMock.pages.get(res.body.data.id)!;
      expect(page.body).not.toContain('<script>');
      expect(page.body).toContain('&lt;script&gt;');
      expect(page.body).toContain('&amp;');
    });

    it('creates, lists, updates, and deletes a page in a space', async () => {
      const created = await http()
        .post(`/workspaces/${workspaceId}/confluence/pages`)
        .set(auth(owner))
        .send({ spaceKey: 'DEV', title: 'Runbook', body: 'first line\n\nsecond para' })
        .expect(201);
      expect(created.body.data.title).toBe('Runbook');
      expect(created.body.data.version).toBe(1);
      expect(created.body.data.url).toContain('/wiki/spaces/DEV');
      const pageId = created.body.data.id;

      const list = await http()
        .get(`/workspaces/${workspaceId}/confluence/spaces/DEV/pages`)
        .set(auth(owner))
        .expect(200);
      expect(list.body.data.some((p: { id: string }) => p.id === pageId)).toBe(true);

      // Reading the page back returns body as plain text (storage round-trip).
      const fetched = await http()
        .get(`/workspaces/${workspaceId}/confluence/pages/${pageId}`)
        .set(auth(owner))
        .expect(200);
      expect(fetched.body.data.body).toContain('first line');
      expect(fetched.body.data.body).toContain('second para');

      const updated = await http()
        .patch(`/workspaces/${workspaceId}/confluence/pages/${pageId}`)
        .set(auth(owner))
        .send({ title: 'Runbook v2', body: 'updated', version: 1 })
        .expect(200);
      expect(updated.body.data.title).toBe('Runbook v2');
      expect(updated.body.data.version).toBe(2);

      await http()
        .delete(`/workspaces/${workspaceId}/confluence/pages/${pageId}`)
        .set(auth(owner))
        .expect(200);
      const after = await http()
        .get(`/workspaces/${workspaceId}/confluence/spaces/DEV/pages`)
        .set(auth(owner))
        .expect(200);
      expect(after.body.data.some((p: { id: string }) => p.id === pageId)).toBe(false);
    });

    it('requires workspace membership', async () => {
      const res = await http()
        .post('/auth/signup')
        .send({
          email: `conf-out-${run}@test.local`,
          password: 'password123!',
          displayName: 'Conf Outsider',
        })
        .expect(201);
      await http()
        .get(`/workspaces/${workspaceId}/confluence/spaces`)
        .set({ Authorization: `Bearer ${res.body.data.accessToken}` })
        .expect(404);
    });
  });
});
