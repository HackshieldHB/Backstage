import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('shared channels across workspaces (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
  }
  let hostOwner: Actor; // owner of the host workspace
  let hostMember: Actor;
  let guestAdmin: Actor; // owner of the partner workspace
  let guestMember: Actor;
  let guestGuest: Actor; // GUEST role in the partner workspace
  let dual: Actor; // member of both workspaces
  let hostWs: string;
  let guestWs: string;
  let channelId: string;
  let privateChannelId: string;
  let shareId: string;
  let inviteToken: string;

  const api = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const post = (who: Actor, text: string, extra: Record<string, unknown> = {}) =>
    api()
      .post(`/channels/${channelId}/messages`)
      .set(auth(who))
      .send({ clientMsgId: randomUUID(), contentJson: doc(text), contentText: text, ...extra });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const res = await api()
        .post('/auth/signup')
        .send({ email: `sh-${name}-${run}@test.local`, password: 'password123!', displayName: `${name} sh` })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    hostOwner = await mk('hostowner');
    hostMember = await mk('hostmember');
    guestAdmin = await mk('guestadmin');
    guestMember = await mk('guestmember');
    guestGuest = await mk('guestguest');
    dual = await mk('dual');

    const invite = async (ws: string, owner: Actor, who: Actor) => {
      const inv = await api().post(`/workspaces/${ws}/invites`).set(auth(owner)).send({}).expect(201);
      await api().post('/invites/accept').set(auth(who)).send({ token: inv.body.data.token }).expect(200);
    };
    hostWs = (await api().post('/workspaces').set(auth(hostOwner)).send({ name: `Host ${run}` }).expect(201)).body.data.id;
    guestWs = (await api().post('/workspaces').set(auth(guestAdmin)).send({ name: `Partner ${run}` }).expect(201)).body
      .data.id;
    await invite(hostWs, hostOwner, hostMember);
    await invite(hostWs, hostOwner, dual);
    await invite(guestWs, guestAdmin, guestMember);
    await invite(guestWs, guestAdmin, guestGuest);
    await invite(guestWs, guestAdmin, dual);
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: guestWs, userId: guestGuest.id } },
      data: { role: 'GUEST' },
    });

    channelId = (
      await api().post(`/workspaces/${hostWs}/channels`).set(auth(hostOwner)).send({ name: `shared-${run}` }).expect(201)
    ).body.data.id;
    privateChannelId = (
      await api()
        .post(`/workspaces/${hostWs}/channels`)
        .set(auth(hostOwner))
        .send({ name: `secret-${run}`, isPrivate: true })
        .expect(201)
    ).body.data.id;
    await api().post(`/channels/${channelId}/join`).set(auth(hostMember)).expect(200);
    await api().post(`/channels/${channelId}/join`).set(auth(dual)).expect(200);
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  it('only channel admins invite, and only for public, non-default channels', async () => {
    await api().post(`/channels/${channelId}/shares`).set(auth(hostMember)).expect(403);
    await api().post(`/channels/${channelId}/shares`).set(auth(guestAdmin)).expect(404);
    await api().post(`/channels/${privateChannelId}/shares`).set(auth(hostOwner)).expect(400);
    const general = await prisma.channel.findFirstOrThrow({ where: { workspaceId: hostWs, isDefault: true } });
    await api().post(`/channels/${general.id}/shares`).set(auth(hostOwner)).expect(400);

    const res = await api().post(`/channels/${channelId}/shares`).set(auth(hostOwner)).expect(201);
    expect(res.body.data.token).toMatch(/^bs_share_/);
    expect(res.body.data.status).toBe('pending');
    shareId = res.body.data.id;
    inviteToken = res.body.data.token;
  });

  it('only a partner-workspace admin accepts, exactly once', async () => {
    await api()
      .post(`/workspaces/${guestWs}/shared-channels/accept`)
      .set(auth(guestMember))
      .send({ token: inviteToken })
      .expect(403);
    await api()
      .post(`/workspaces/${guestWs}/shared-channels/accept`)
      .set(auth(guestAdmin))
      .send({ token: 'bs_share_not-a-real-token' })
      .expect(404);
    await api()
      .post(`/workspaces/${hostWs}/shared-channels/accept`)
      .set(auth(hostOwner))
      .send({ token: inviteToken })
      .expect(400);

    const res = await api()
      .post(`/workspaces/${guestWs}/shared-channels/accept`)
      .set(auth(guestAdmin))
      .send({ token: inviteToken })
      .expect(200);
    expect(res.body.data).toMatchObject({ channelId, host: { workspaceId: hostWs }, isMember: false });
    await api()
      .post(`/workspaces/${guestWs}/shared-channels/accept`)
      .set(auth(guestAdmin))
      .send({ token: inviteToken })
      .expect(404);

    const list = await api().get(`/channels/${channelId}/shares`).set(auth(hostOwner)).expect(200);
    expect(list.body.data[0]).toMatchObject({ status: 'active', partner: { workspaceId: guestWs } });
  });

  it('partner members must join first; partner guests cannot join', async () => {
    await api().get(`/channels/${channelId}/messages`).set(auth(guestMember)).expect(404);
    await post(guestMember, 'too early').expect(404);

    const incoming = await api().get(`/workspaces/${guestWs}/shared-channels`).set(auth(guestMember)).expect(200);
    expect(incoming.body.data).toEqual([
      expect.objectContaining({ shareId, channelId, isMember: false, host: { workspaceId: hostWs, name: `Host ${run}` } }),
    ]);
    const forGuest = await api().get(`/workspaces/${guestWs}/shared-channels`).set(auth(guestGuest)).expect(200);
    expect(forGuest.body.data).toEqual([]);
    await api().post(`/shared-channels/${shareId}/join`).set(auth(guestGuest)).expect(404);
    await api().post(`/shared-channels/${shareId}/join`).set(auth(hostMember)).expect(404); // not in the partner workspace

    await api().post(`/shared-channels/${shareId}/join`).set(auth(guestMember)).expect(200);
  });

  it('shows up in both sidebars, labelled', async () => {
    const guestSide = await api().get(`/workspaces/${guestWs}/channels`).set(auth(guestMember)).expect(200);
    const c = guestSide.body.data.find((x: { id: string }) => x.id === channelId);
    expect(c.sharedFrom).toEqual({ workspaceId: hostWs, name: `Host ${run}` });
    const hostSide = await api().get(`/workspaces/${hostWs}/channels`).set(auth(hostMember)).expect(200);
    const h = hostSide.body.data.find((x: { id: string }) => x.id === channelId);
    expect(h).toMatchObject({ isShared: true, sharedFrom: null });

    const unreads = await api().get(`/workspaces/${guestWs}/unreads`).set(auth(guestMember)).expect(200);
    expect(unreads.body.data.map((u: { channelId?: string }) => u.channelId)).toContain(channelId);
  });

  it('both sides read, post, react and share files', async () => {
    await post(hostMember, `hello partners ${run}`).expect(201);
    const fromGuest = await post(guestMember, `hello hosts ${run}`).expect(201);

    const hostView = await api().get(`/channels/${channelId}/messages`).set(auth(hostMember)).expect(200);
    expect(hostView.body.data.messages.map((m: { contentText: string }) => m.contentText)).toContain(`hello hosts ${run}`);
    const guestView = await api().get(`/channels/${channelId}/messages`).set(auth(guestMember)).expect(200);
    expect(guestView.body.data.messages.map((m: { contentText: string }) => m.contentText)).toContain(
      `hello partners ${run}`,
    );

    await api()
      .post(`/messages/${fromGuest.body.data.id}/reactions`)
      .set(auth(hostMember))
      .send({ emoji: 'thumbsup' })
      .expect(200);
    const members = await api().get(`/channels/${channelId}/members`).set(auth(guestMember)).expect(200);
    expect(members.body.data.map((m: { id: string }) => m.id)).toEqual(
      expect.arrayContaining([hostMember.id, guestMember.id]),
    );

    // A partner uploads into their own workspace and attaches the file here.
    const up = await api()
      .post(`/workspaces/${guestWs}/attachments`)
      .set(auth(guestMember))
      .attach('file', PNG, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(201);
    await post(guestMember, 'a file', { attachmentIds: [up.body.data.id] }).expect(201);
    await api().get(`/attachments/${up.body.data.id}`).set(auth(hostMember)).expect(200);
  });

  it('is searchable from both workspaces, and only by people in it', async () => {
    await post(hostMember, `quokka-${run} from the host`).expect(201);
    const fromGuest = await api()
      .get(`/workspaces/${guestWs}/search?q=quokka-${run}`)
      .set(auth(guestMember))
      .expect(200);
    expect(fromGuest.body.data.messages.map((m: { contentText: string }) => m.contentText)).toEqual([
      `quokka-${run} from the host`,
    ]);
    const byChannel = await api()
      .get(`/workspaces/${guestWs}/search?q=${encodeURIComponent(`quokka-${run} in:shared-${run}`)}`)
      .set(auth(guestMember))
      .expect(200);
    expect(byChannel.body.data.messages).toHaveLength(1);
    const channels = await api().get(`/workspaces/${guestWs}/search?q=shared-${run}&type=channels`).set(auth(guestMember)).expect(200);
    expect(channels.body.data.channels.map((c: { id: string }) => c.id)).toEqual([channelId]);

    // Host members find the partner's messages, including by author.
    const fromHost = await api()
      .get(`/workspaces/${hostWs}/search?q=${encodeURIComponent('hosts from:guestmember')}`)
      .set(auth(hostMember))
      .expect(200);
    expect(fromHost.body.data.messages.map((m: { contentText: string }) => m.contentText)).toContain(`hello hosts ${run}`);

    // Partner admins who never joined, and partner guests, find nothing.
    for (const who of [guestAdmin, guestGuest]) {
      const res = await api().get(`/workspaces/${guestWs}/search?q=quokka-${run}`).set(auth(who)).expect(200);
      expect(res.body.data.messages).toEqual([]);
    }
  });

  it("partners never reach the host's admin, integration or membership tools", async () => {
    await api().patch(`/channels/${channelId}`).set(auth(guestMember)).send({ topic: 'hijacked' }).expect(404);
    await api().post(`/channels/${channelId}/members`).set(auth(guestMember)).send({ userId: guestAdmin.id }).expect(404);
    await api().post(`/channels/${channelId}/shares`).set(auth(guestAdmin)).expect(404);
    await api().get(`/channels/${channelId}/bookmarks`).set(auth(guestMember)).expect(404);
    await api().get(`/channels/${privateChannelId}/messages`).set(auth(guestMember)).expect(404);
    // Partner workspace admins can't moderate host messages either.
    const hostMsg = await post(hostMember, 'host only').expect(201);
    await api().delete(`/messages/${hostMsg.body.data.id}`).set(auth(guestAdmin)).expect(404);
    // Host workspace data stays private.
    await api().get(`/workspaces/${hostWs}/members`).set(auth(guestMember)).expect(404);
  });

  it('ending the share removes partner members (but not people who are also host members)', async () => {
    await api().post(`/shared-channels/${shareId}/join`).set(auth(dual)).expect(200); // already a member via host
    await api().delete(`/channel-shares/${shareId}`).set(auth(guestMember)).expect(404);
    await api().delete(`/channel-shares/${shareId}`).set(auth(hostOwner)).expect(200);

    await api().get(`/channels/${channelId}/messages`).set(auth(guestMember)).expect(404);
    expect(
      await prisma.channelMember.count({ where: { channelId, userId: guestMember.id } }),
    ).toBe(0);
    await api().get(`/channels/${channelId}/messages`).set(auth(dual)).expect(200);
    await api().get(`/channels/${channelId}/messages`).set(auth(hostMember)).expect(200);

    const incoming = await api().get(`/workspaces/${guestWs}/shared-channels`).set(auth(guestMember)).expect(200);
    expect(incoming.body.data).toEqual([]);
    await api().post(`/shared-channels/${shareId}/join`).set(auth(guestMember)).expect(404);
    await api().delete(`/channel-shares/${shareId}`).set(auth(hostOwner)).expect(404);

    const audit = await prisma.auditLog.findMany({ where: { workspaceId: guestWs, action: { startsWith: 'channel.share' } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['channel.share.accept', 'channel.share.revoke']);
  });

  it('the partner admin can also end a share', async () => {
    const inv = await api().post(`/channels/${channelId}/shares`).set(auth(hostOwner)).expect(201);
    await api()
      .post(`/workspaces/${guestWs}/shared-channels/accept`)
      .set(auth(guestAdmin))
      .send({ token: inv.body.data.token })
      .expect(200);
    await api().post(`/shared-channels/${inv.body.data.id}/join`).set(auth(guestMember)).expect(200);
    await api().delete(`/channel-shares/${inv.body.data.id}`).set(auth(guestAdmin)).expect(200);
    await api().get(`/channels/${channelId}/messages`).set(auth(guestMember)).expect(404);
  });
});
