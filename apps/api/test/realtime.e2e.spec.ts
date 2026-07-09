import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import { SOCKET_EVENTS, UnreadUpdatedPayload } from '@backstages/shared';
import { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Waits for a single occurrence of an event, with a helpful timeout. */
function once<T>(socket: Socket, event: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for '${event}'`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Collects events of a type for assertions that need "the Nth event". */
function collect<T>(socket: Socket, event: string): T[] {
  const events: T[] = [];
  socket.on(event, (payload: T) => events.push(payload));
  return events;
}

describe('realtime (two-socket e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
    socket?: Socket;
  }
  let alice: Actor;
  let bob: Actor;
  let workspaceId: string;
  let channelId: string;

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const res = await http()
        .post('/auth/signup')
        .send({
          email: `rt-${name}-${run}@test.local`,
          password: 'password123!',
          displayName: `${name} rt`,
        })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice');
    bob = await mk('bob');

    const ws = await http()
      .post('/workspaces')
      .set(auth(alice))
      .send({ name: `Realtime ${run}` })
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
      .send({ name: 'realtime-test' })
      .expect(201);
    channelId = channel.body.data.id;
    await http().post(`/channels/${channelId}/join`).set(auth(bob)).expect(200);
  });

  afterAll(async () => {
    alice?.socket?.disconnect();
    bob?.socket?.disconnect();
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  it('rejects a socket with an invalid token', async () => {
    const bad = io(baseUrl, { auth: { token: 'garbage' }, transports: ['websocket'] });
    const err = await new Promise<Error>((resolve) => bad.once('connect_error', resolve));
    expect(err.message).toMatch(/invalid|expired/i);
    bad.disconnect();
  });

  it('rejects a socket with no token', async () => {
    const bad = io(baseUrl, { transports: ['websocket'] });
    const err = await new Promise<Error>((resolve) => bad.once('connect_error', resolve));
    expect(err.message).toMatch(/missing/i);
    bad.disconnect();
  });

  it('accepts valid tokens and connects both clients', async () => {
    const connectSocket = (a: Actor) =>
      new Promise<Socket>((resolve, reject) => {
        const s = io(baseUrl, { auth: { token: a.token }, transports: ['websocket'] });
        s.once('connect', () => resolve(s));
        s.once('connect_error', reject);
      });
    alice.socket = await connectSocket(alice);
    bob.socket = await connectSocket(bob);
    expect(alice.socket.connected).toBe(true);
    expect(bob.socket.connected).toBe(true);
  });

  let messageId: string;

  it('A sends via REST → B receives message:new and unread:updated (unread=1)', async () => {
    const messagePromise = once<{ message: { id: string; contentText: string } }>(
      bob.socket!,
      SOCKET_EVENTS.MESSAGE_NEW,
    );
    const unreadPromise = once<UnreadUpdatedPayload>(bob.socket!, SOCKET_EVENTS.UNREAD_UPDATED);

    const res = await http()
      .post(`/channels/${channelId}/messages`)
      .set(auth(alice))
      .send({
        clientMsgId: randomUUID(),
        contentJson: { type: 'doc', content: [] },
        contentText: 'hello bob, realtime works',
      })
      .expect(201);
    messageId = res.body.data.id;

    const received = await messagePromise;
    expect(received.message.id).toBe(messageId);
    expect(received.message.contentText).toBe('hello bob, realtime works');

    const unread = await unreadPromise;
    expect(unread.channelId).toBe(channelId);
    expect(unread.unread).toBe(1);
  });

  it('B marks read via REST → unread returns to 0 and is pushed', async () => {
    const unreadPromise = once<UnreadUpdatedPayload>(bob.socket!, SOCKET_EVENTS.UNREAD_UPDATED);
    const res = await http()
      .post(`/channels/${channelId}/read`)
      .set(auth(bob))
      .send({ messageId })
      .expect(200);
    expect(res.body.data.unread).toBe(0);

    const pushed = await unreadPromise;
    expect(pushed.channelId).toBe(channelId);
    expect(pushed.unread).toBe(0);
  });

  it('reactions broadcast in realtime', async () => {
    const reactionPromise = once<{ emoji: string; reactions: Array<{ emoji: string; count: number }> }>(
      alice.socket!,
      SOCKET_EVENTS.REACTION_ADDED,
    );
    await http()
      .post(`/messages/${messageId}/reactions`)
      .set(auth(bob))
      .send({ emoji: 'rocket' })
      .expect(200);
    const reaction = await reactionPromise;
    expect(reaction.emoji).toBe('rocket');
    expect(reaction.reactions[0].count).toBe(1);

    const removedPromise = once(alice.socket!, SOCKET_EVENTS.REACTION_REMOVED);
    await http()
      .post(`/messages/${messageId}/reactions`)
      .set(auth(bob))
      .send({ emoji: 'rocket' })
      .expect(200);
    await removedPromise;
  });

  it('thread replies emit thread:reply with the running count', async () => {
    const threadPromise = once<{ parentId: string; replyCount: number }>(
      bob.socket!,
      SOCKET_EVENTS.THREAD_REPLY,
    );
    await http()
      .post(`/channels/${channelId}/messages`)
      .set(auth(alice))
      .send({
        clientMsgId: randomUUID(),
        contentJson: { type: 'doc', content: [] },
        contentText: 'threading it',
        parentId: messageId,
      })
      .expect(201);
    const thread = await threadPromise;
    expect(thread.parentId).toBe(messageId);
    expect(thread.replyCount).toBe(1);
  });

  it('mentions produce notification:new for the mentioned user', async () => {
    const notificationPromise = once<{ type: string; messageId: string }>(
      bob.socket!,
      SOCKET_EVENTS.NOTIFICATION_NEW,
    );
    await http()
      .post(`/channels/${channelId}/messages`)
      .set(auth(alice))
      .send({
        clientMsgId: randomUUID(),
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'mention', attrs: { id: bob.id, label: 'bob' } },
                { type: 'text', text: ' ping' },
              ],
            },
          ],
        },
        contentText: '@bob ping',
      })
      .expect(201);
    const notification = await notificationPromise;
    expect(notification.type).toBe('MENTION');
  });

  it('edits broadcast message:updated', async () => {
    const updatePromise = once<{ message: { id: string; isEdited: boolean; contentText: string } }>(
      bob.socket!,
      SOCKET_EVENTS.MESSAGE_UPDATED,
    );
    await http()
      .patch(`/messages/${messageId}`)
      .set(auth(alice))
      .send({ contentJson: { type: 'doc', content: [] }, contentText: 'hello bob (edited)' })
      .expect(200);
    const updated = await updatePromise;
    expect(updated.message.isEdited).toBe(true);
    expect(updated.message.contentText).toBe('hello bob (edited)');
  });

  it('deletes broadcast message:deleted', async () => {
    const deletePromise = once<{ id: string }>(bob.socket!, SOCKET_EVENTS.MESSAGE_DELETED);
    await http().delete(`/messages/${messageId}`).set(auth(alice)).expect(200);
    const deleted = await deletePromise;
    expect(deleted.id).toBe(messageId);
  });

  it('typing indicators reach the other member only', async () => {
    const typingPromise = once<{ user: { id: string } }>(bob.socket!, SOCKET_EVENTS.TYPING_START);
    const aliceTyping = collect(alice.socket!, SOCKET_EVENTS.TYPING_START);
    alice.socket!.emit('typing:start', { channelId });
    const typing = await typingPromise;
    expect(typing.user.id).toBe(alice.id);
    // Sender must not receive their own typing echo.
    expect(aliceTyping).toHaveLength(0);
  });
});
