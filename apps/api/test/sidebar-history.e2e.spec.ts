import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('edit history, sidebar sections, bookmarks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
  }
  let alice: Actor; // owner (workspace admin)
  let bob: Actor; // member
  let carol: Actor; // member, not in the channel
  let mallory: Actor; // outsider
  let workspaceId: string;
  let channelId: string;
  let dmId: string;

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const res = await http()
        .post('/auth/signup')
        .send({ email: `sb-${name}-${run}@test.local`, password: 'password123!', displayName: `${name} sb` })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice');
    bob = await mk('bob');
    carol = await mk('carol');
    mallory = await mk('mallory');

    workspaceId = (
      await http().post('/workspaces').set(auth(alice)).send({ name: `Sidebar ${run}` }).expect(201)
    ).body.data.id;
    for (const who of [bob, carol]) {
      const invite = await http().post(`/workspaces/${workspaceId}/invites`).set(auth(alice)).send({}).expect(201);
      await http().post('/invites/accept').set(auth(who)).send({ token: invite.body.data.token }).expect(200);
    }
    channelId = (
      await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: `sb-${run}` })
        .expect(201)
    ).body.data.id;
    await http().post(`/channels/${channelId}/join`).set(auth(bob)).expect(200);
    dmId = (
      await http()
        .post(`/workspaces/${workspaceId}/conversations`)
        .set(auth(alice))
        .send({ memberIds: [bob.id] })
        .expect(200)
    ).body.data.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  describe('message edit history', () => {
    let messageId: string;

    it('keeps each earlier version, newest first, for readers of the message', async () => {
      messageId = (
        await http()
          .post(`/channels/${channelId}/messages`)
          .set(auth(alice))
          .send({ clientMsgId: randomUUID(), contentJson: doc('v1 text'), contentText: 'v1 text' })
          .expect(201)
      ).body.data.id;
      const edit = (text: string) =>
        http()
          .patch(`/messages/${messageId}`)
          .set(auth(alice))
          .send({ contentJson: doc(text), contentText: text })
          .expect(200);
      await edit('v2 text');
      await edit('v2 text'); // no change → no new version
      await edit('v3 text');

      const res = await http().get(`/messages/${messageId}/edits`).set(auth(bob)).expect(200);
      expect(res.body.data.map((v: { contentText: string }) => v.contentText)).toEqual(['v2 text', 'v1 text']);
      expect(new Date(res.body.data[1].versionAt) <= new Date(res.body.data[1].replacedAt)).toBe(true);

      // Not readable by someone outside the channel.
      await http().get(`/messages/${messageId}/edits`).set(auth(carol)).expect(404);
      await http().get(`/messages/${messageId}/edits`).set(auth(mallory)).expect(404);
    });

    it('is wiped when the message is deleted', async () => {
      await http().delete(`/messages/${messageId}`).set(auth(alice)).expect(200);
      expect(await prisma.messageEdit.count({ where: { messageId } })).toBe(0);
      await http().get(`/messages/${messageId}/edits`).set(auth(bob)).expect(404);
    });
  });

  describe('sidebar sections', () => {
    let sectionId: string;

    it('creates, lists, renames and reorders the caller’s own sections', async () => {
      sectionId = (
        await http()
          .post(`/workspaces/${workspaceId}/sidebar-sections`)
          .set(auth(alice))
          .send({ name: ' Projects ' })
          .expect(201)
      ).body.data.id;
      await http()
        .post(`/workspaces/${workspaceId}/sidebar-sections`)
        .set(auth(alice))
        .send({ name: 'Friends' })
        .expect(201);
      await http().patch(`/sidebar-sections/${sectionId}`).set(auth(alice)).send({ name: 'Active projects', position: 5 }).expect(200);

      const mine = await http().get(`/workspaces/${workspaceId}/sidebar-sections`).set(auth(alice)).expect(200);
      expect(mine.body.data.map((s: { name: string }) => s.name)).toEqual(['Friends', 'Active projects']);
      const bobs = await http().get(`/workspaces/${workspaceId}/sidebar-sections`).set(auth(bob)).expect(200);
      expect(bobs.body.data).toEqual([]);

      await http().patch(`/sidebar-sections/${sectionId}`).set(auth(bob)).send({ name: 'x' }).expect(404);
      await http().post(`/workspaces/${workspaceId}/sidebar-sections`).set(auth(alice)).send({ name: '' }).expect(400);
    });

    it('files a channel and a DM into a section for the caller only', async () => {
      await http().put(`/channels/${channelId}/section`).set(auth(alice)).send({ sectionId }).expect(200);
      await http().put(`/conversations/${dmId}/section`).set(auth(alice)).send({ sectionId }).expect(200);

      const aliceChannels = await http().get(`/workspaces/${workspaceId}/channels`).set(auth(alice)).expect(200);
      expect(aliceChannels.body.data.find((c: { id: string }) => c.id === channelId).sectionId).toBe(sectionId);
      const bobChannels = await http().get(`/workspaces/${workspaceId}/channels`).set(auth(bob)).expect(200);
      expect(bobChannels.body.data.find((c: { id: string }) => c.id === channelId).sectionId).toBeNull();
      const aliceDms = await http().get(`/workspaces/${workspaceId}/conversations`).set(auth(alice)).expect(200);
      expect(aliceDms.body.data.find((c: { id: string }) => c.id === dmId).sectionId).toBe(sectionId);

      // Someone else's section can't be used, and non-members can't file the channel.
      await http().put(`/channels/${channelId}/section`).set(auth(bob)).send({ sectionId }).expect(404);
      await http().put(`/channels/${channelId}/section`).set(auth(carol)).send({ sectionId: null }).expect(404);
    });

    it('deleting a section returns its channels/DMs to the default lists', async () => {
      await http().delete(`/sidebar-sections/${sectionId}`).set(auth(alice)).expect(200);
      const channels = await http().get(`/workspaces/${workspaceId}/channels`).set(auth(alice)).expect(200);
      expect(channels.body.data.find((c: { id: string }) => c.id === channelId).sectionId).toBeNull();
      const dms = await http().get(`/workspaces/${workspaceId}/conversations`).set(auth(alice)).expect(200);
      expect(dms.body.data.find((c: { id: string }) => c.id === dmId).sectionId).toBeNull();
    });
  });

  describe('channel bookmarks', () => {
    it('members add http(s) links; others can’t see or add; dangerous schemes refused', async () => {
      const added = await http()
        .post(`/channels/${channelId}/bookmarks`)
        .set(auth(bob))
        .send({ title: 'Runbook', url: 'https://wiki.example.com/runbook' })
        .expect(201);
      expect(added.body.data).toMatchObject({ title: 'Runbook', createdBy: { id: bob.id } });

      for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.example.com', 'not a url']) {
        await http().post(`/channels/${channelId}/bookmarks`).set(auth(bob)).send({ title: 'x', url }).expect(400);
      }
      await http()
        .post(`/channels/${channelId}/bookmarks`)
        .set(auth(carol))
        .send({ title: 'x', url: 'https://x.example.com' })
        .expect(404);

      const list = await http().get(`/channels/${channelId}/bookmarks`).set(auth(alice)).expect(200);
      expect(list.body.data.map((b: { title: string }) => b.title)).toEqual(['Runbook']);
      await http().get(`/channels/${channelId}/bookmarks`).set(auth(carol)).expect(404);
    });

    it('creators and channel admins can remove; other members cannot', async () => {
      const mine = (
        await http()
          .post(`/channels/${channelId}/bookmarks`)
          .set(auth(alice))
          .send({ title: 'Dashboard', url: 'https://grafana.example.com' })
          .expect(201)
      ).body.data.id;
      await http().delete(`/bookmarks/${mine}`).set(auth(bob)).expect(403); // bob isn't an admin
      const bobs = (await http().get(`/channels/${channelId}/bookmarks`).set(auth(bob)).expect(200)).body.data.find(
        (b: { title: string }) => b.title === 'Runbook',
      ).id;
      await http().delete(`/bookmarks/${bobs}`).set(auth(alice)).expect(200); // admin removes bob's
      await http().delete(`/bookmarks/${mine}`).set(auth(alice)).expect(200); // creator removes own
      const left = await http().get(`/channels/${channelId}/bookmarks`).set(auth(alice)).expect(200);
      expect(left.body.data).toEqual([]);
    });
  });
});
