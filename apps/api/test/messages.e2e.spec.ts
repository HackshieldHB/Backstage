import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('messages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
  }
  let alice: Actor; // owner
  let bob: Actor; // member
  let mallory: Actor; // outsider with her own workspace
  let workspaceId: string;
  let channelId: string;
  let dmId: string;

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const sendBody = (text: string, extra: Record<string, unknown> = {}) => ({
    clientMsgId: randomUUID(),
    contentJson: doc(text),
    contentText: text,
    ...extra,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const res = await http()
        .post('/auth/signup')
        .send({
          email: `msg-${name}-${run}@test.local`,
          password: 'password123!',
          displayName: `${name} msg`,
        })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice');
    bob = await mk('bob');
    mallory = await mk('mallory');

    const ws = await http()
      .post('/workspaces')
      .set(auth(alice))
      .send({ name: `Messages ${run}` })
      .expect(201);
    workspaceId = ws.body.data.id;

    const invite = await http()
      .post(`/workspaces/${workspaceId}/invites`)
      .set(auth(alice))
      .send({})
      .expect(201);
    await http().post('/invites/accept').set(auth(bob)).send({ token: invite.body.data.token }).expect(200);

    const channel = await http()
      .post(`/workspaces/${workspaceId}/channels`)
      .set(auth(alice))
      .send({ name: 'messages-test' })
      .expect(201);
    channelId = channel.body.data.id;
    await http().post(`/channels/${channelId}/join`).set(auth(bob)).expect(200);

    const dm = await http()
      .post(`/workspaces/${workspaceId}/conversations`)
      .set(auth(alice))
      .send({ memberIds: [bob.id] })
      .expect(200);
    dmId = dm.body.data.id;

    // Mallory owns an unrelated workspace (proves cross-tenant admin power is void).
    await http().post('/workspaces').set(auth(mallory)).send({ name: `Mallory ${run}` }).expect(201);
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  describe('authorization on message read/write', () => {
    it('a non-member can neither read nor post to a channel by id', async () => {
      await http().get(`/channels/${channelId}/messages`).set(auth(mallory)).expect(404);
      await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(mallory))
        .send(sendBody('sneaky'))
        .expect(404);
    });

    it('a non-participant can neither read nor post to a DM by id', async () => {
      await http().get(`/conversations/${dmId}/messages`).set(auth(mallory)).expect(404);
      await http()
        .post(`/conversations/${dmId}/messages`)
        .set(auth(mallory))
        .send(sendBody('sneaky dm'))
        .expect(404);
    });

    it('unauthenticated requests are rejected outright', async () => {
      await http().get(`/channels/${channelId}/messages`).expect(401);
      await http().post(`/channels/${channelId}/messages`).send(sendBody('anon')).expect(401);
    });
  });

  describe('send pipeline', () => {
    it('persists and returns the full MessageDto', async () => {
      const res = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(sendBody('first message'))
        .expect(201);
      const m = res.body.data;
      expect(m.contentText).toBe('first message');
      expect(m.user.id).toBe(alice.id);
      expect(m.channelId).toBe(channelId);
      expect(m.reactions).toEqual([]);
      expect(m.replyCount).toBe(0);
    });

    it('is idempotent on clientMsgId: a retry returns the same message, no duplicate row', async () => {
      const body = sendBody('exactly once');
      const first = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(body)
        .expect(201);
      const retry = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(body)
        .expect(201);
      expect(retry.body.data.id).toBe(first.body.data.id);

      const count = await prisma.message.count({
        where: { clientMsgId: body.clientMsgId, userId: alice.id },
      });
      expect(count).toBe(1);
    });

    it('rejects empty messages and oversized clientMsgId misuse', async () => {
      await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send({ clientMsgId: randomUUID(), contentJson: doc(''), contentText: '   ' })
        .expect(400);
      await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send({ clientMsgId: 'not-a-uuid', contentJson: doc('x'), contentText: 'x' })
        .expect(400);
    });

    it('rejects posting to an archived channel', async () => {
      const c = await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: 'archived-target' })
        .expect(201);
      await http().post(`/channels/${c.body.data.id}/archive`).set(auth(alice)).expect(200);
      await http()
        .post(`/channels/${c.body.data.id}/messages`)
        .set(auth(alice))
        .send(sendBody('too late'))
        .expect(403);
    });
  });

  describe('threads', () => {
    let parentId: string;

    it('replies attach to a parent and are hidden from the main list by default', async () => {
      const parent = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(sendBody('thread parent'))
        .expect(201);
      parentId = parent.body.data.id;

      await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(bob))
        .send(sendBody('hidden reply', { parentId }))
        .expect(201);
      await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(bob))
        .send(sendBody('visible reply', { parentId, alsoSendToChannel: true }))
        .expect(201);

      const list = await http().get(`/channels/${channelId}/messages`).set(auth(alice)).expect(200);
      const texts = list.body.data.messages.map((m: { contentText: string }) => m.contentText);
      expect(texts).not.toContain('hidden reply');
      expect(texts).toContain('visible reply'); // alsoSendToChannel

      const thread = await http().get(`/messages/${parentId}/thread`).set(auth(alice)).expect(200);
      expect(thread.body.data.replies).toHaveLength(2);
      expect(thread.body.data.parent.replyCount).toBe(2);
    });

    it('rejects replying to a reply (single-level threads)', async () => {
      const thread = await http().get(`/messages/${parentId}/thread`).set(auth(alice)).expect(200);
      const replyId = thread.body.data.replies[0].id;
      await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(sendBody('nested', { parentId: replyId }))
        .expect(400);
    });

    it('rejects a parent from a different container', async () => {
      await http()
        .post(`/conversations/${dmId}/messages`)
        .set(auth(alice))
        .send(sendBody('cross-container reply', { parentId }))
        .expect(400);
    });
  });

  describe('edit and delete', () => {
    it('only the author can edit; edits set the flag', async () => {
      const msg = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(sendBody('to be edited'))
        .expect(201);
      await http()
        .patch(`/messages/${msg.body.data.id}`)
        .set(auth(bob))
        .send({ contentJson: doc('hijack'), contentText: 'hijack' })
        .expect(403);
      const edited = await http()
        .patch(`/messages/${msg.body.data.id}`)
        .set(auth(alice))
        .send({ contentJson: doc('edited now'), contentText: 'edited now' })
        .expect(200);
      expect(edited.body.data.isEdited).toBe(true);
      expect(edited.body.data.editedAt).toBeTruthy();
    });

    it('deleting produces a tombstone: row stays, content is gone from the API', async () => {
      const msg = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(sendBody('doomed message'))
        .expect(201);
      await http().delete(`/messages/${msg.body.data.id}`).set(auth(alice)).expect(200);

      const list = await http().get(`/channels/${channelId}/messages`).set(auth(bob)).expect(200);
      const tombstone = list.body.data.messages.find(
        (m: { id: string }) => m.id === msg.body.data.id,
      );
      expect(tombstone).toBeDefined();
      expect(tombstone.isDeleted).toBe(true);
      expect(tombstone.contentText).toBe('');
      expect(tombstone.contentJson).toBeNull();

      // Editing or reacting to a deleted message is impossible.
      await http()
        .patch(`/messages/${msg.body.data.id}`)
        .set(auth(alice))
        .send({ contentJson: doc('resurrect'), contentText: 'resurrect' })
        .expect(404);
      await http()
        .post(`/messages/${msg.body.data.id}/reactions`)
        .set(auth(bob))
        .send({ emoji: 'ghost' })
        .expect(404);
    });

    it('a random member cannot delete someone else’s message', async () => {
      const msg = await http()
        .post(`/channels/${channelId}/messages`)
        .set(auth(alice))
        .send(sendBody('protected'))
        .expect(201);
      await http().delete(`/messages/${msg.body.data.id}`).set(auth(bob)).expect(403);
    });
  });

  describe('cursor pagination', () => {
    let pagedChannelId: string;

    it('pages backwards 50 at a time with a stable cursor', async () => {
      const c = await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: 'paged' })
        .expect(201);
      pagedChannelId = c.body.data.id;

      for (let i = 1; i <= 60; i++) {
        await http()
          .post(`/channels/${pagedChannelId}/messages`)
          .set(auth(alice))
          .send(sendBody(`msg ${i}`))
          .expect(201);
      }

      const page1 = await http()
        .get(`/channels/${pagedChannelId}/messages`)
        .set(auth(alice))
        .expect(200);
      expect(page1.body.data.messages).toHaveLength(50);
      expect(page1.body.data.nextCursor).toBeTruthy();
      // Ascending within the page; newest page first.
      expect(page1.body.data.messages[49].contentText).toBe('msg 60');
      expect(page1.body.data.messages[0].contentText).toBe('msg 11');

      const page2 = await http()
        .get(`/channels/${pagedChannelId}/messages?cursor=${page1.body.data.nextCursor}`)
        .set(auth(alice))
        .expect(200);
      expect(page2.body.data.messages).toHaveLength(10);
      expect(page2.body.data.messages[0].contentText).toBe('msg 1');
      expect(page2.body.data.messages[9].contentText).toBe('msg 10');
    });
  });

  describe('unread wiring', () => {
    it('unread counts flow: new message -> 1, mark read -> 0, own messages never count', async () => {
      const c = await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: 'unread-test' })
        .expect(201);
      const cid = c.body.data.id;
      await http().post(`/channels/${cid}/join`).set(auth(bob)).expect(200);

      const sent = await http()
        .post(`/channels/${cid}/messages`)
        .set(auth(alice))
        .send(sendBody('unread me'))
        .expect(201);

      const bobUnreads = await http().get(`/workspaces/${workspaceId}/unreads`).set(auth(bob)).expect(200);
      const bobEntry = bobUnreads.body.data.find((u: { channelId: string }) => u.channelId === cid);
      expect(bobEntry.unread).toBe(1);

      // The author's own lastRead was advanced on send.
      const aliceUnreads = await http()
        .get(`/workspaces/${workspaceId}/unreads`)
        .set(auth(alice))
        .expect(200);
      const aliceEntry = aliceUnreads.body.data.find((u: { channelId: string }) => u.channelId === cid);
      expect(aliceEntry.unread).toBe(0);

      await http().post(`/channels/${cid}/read`).set(auth(bob)).send({ messageId: sent.body.data.id }).expect(200);
      const after = await http().get(`/workspaces/${workspaceId}/unreads`).set(auth(bob)).expect(200);
      expect(after.body.data.find((u: { channelId: string }) => u.channelId === cid).unread).toBe(0);
    });

    it('mentions increment the mention counter for the mentioned member', async () => {
      const c = await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: 'mention-count' })
        .expect(201);
      const cid = c.body.data.id;
      await http().post(`/channels/${cid}/join`).set(auth(bob)).expect(200);

      await http()
        .post(`/channels/${cid}/messages`)
        .set(auth(alice))
        .send({
          clientMsgId: randomUUID(),
          contentJson: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'mention', attrs: { id: bob.id, label: 'bob' } }],
              },
            ],
          },
          contentText: '@bob look at this',
        })
        .expect(201);

      const unreads = await http().get(`/workspaces/${workspaceId}/unreads`).set(auth(bob)).expect(200);
      const entry = unreads.body.data.find((u: { channelId: string }) => u.channelId === cid);
      expect(entry.unread).toBe(1);
      expect(entry.mentions).toBe(1);

      const mentionRows = await prisma.mention.count({
        where: { userId: bob.id, message: { channelId: cid } },
      });
      const notificationRows = await prisma.notification.count({
        where: { userId: bob.id, channelId: cid, type: 'MENTION' },
      });
      expect(mentionRows).toBe(1);
      expect(notificationRows).toBe(1);
    });
  });
});
