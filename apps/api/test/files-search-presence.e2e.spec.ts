import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { Prisma } from '@prisma/client';
import { MAX_UPLOAD_BYTES, SOCKET_EVENTS } from '@backstages/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// 1x1 red pixel PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('files, search, presence, activity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
  }
  let alice: Actor;
  let bob: Actor;
  let workspaceId: string;
  let publicChannelId: string;
  let secretChannelId: string; // alice-only private channel

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const send = (channelId: string, actor: Actor, text: string, extra: Record<string, unknown> = {}) =>
    http()
      .post(`/channels/${channelId}/messages`)
      .set(auth(actor))
      .send({ clientMsgId: randomUUID(), contentJson: doc(text), contentText: text, ...extra });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const res = await http()
        .post('/auth/signup')
        .send({
          email: `fsp-${name}-${run}@test.local`,
          password: 'password123!',
          displayName: `${name} fsp`,
        })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice');
    bob = await mk('bob');

    const ws = await http()
      .post('/workspaces')
      .set(auth(alice))
      .send({ name: `FSP ${run}` })
      .expect(201);
    workspaceId = ws.body.data.id;
    const invite = await http()
      .post(`/workspaces/${workspaceId}/invites`)
      .set(auth(alice))
      .send({})
      .expect(201);
    await http().post('/invites/accept').set(auth(bob)).send({ token: invite.body.data.token }).expect(200);

    const pub = await http()
      .post(`/workspaces/${workspaceId}/channels`)
      .set(auth(alice))
      .send({ name: 'fsp-public' })
      .expect(201);
    publicChannelId = pub.body.data.id;
    await http().post(`/channels/${publicChannelId}/join`).set(auth(bob)).expect(200);

    const secret = await http()
      .post(`/workspaces/${workspaceId}/channels`)
      .set(auth(alice))
      .send({ name: 'fsp-secret', isPrivate: true })
      .expect(201);
    secretChannelId = secret.body.data.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  describe('files', () => {
    let attachmentId: string;
    let signedUrl: string;

    it('uploads an image, extracting dimensions', async () => {
      const res = await http()
        .post(`/workspaces/${workspaceId}/attachments`)
        .set(auth(alice))
        .attach('file', PNG, { filename: 'pixel.png', contentType: 'image/png' })
        .expect(201);
      expect(res.body.data.width).toBe(1);
      expect(res.body.data.height).toBe(1);
      expect(res.body.data.mimeType).toBe('image/png');
      attachmentId = res.body.data.id;
      signedUrl = res.body.data.url;
    });

    it('enforces the 25MB limit server-side', async () => {
      const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 1);
      await http()
        .post(`/workspaces/${workspaceId}/attachments`)
        .set(auth(alice))
        .attach('file', tooBig, { filename: 'huge.bin', contentType: 'application/octet-stream' })
        .expect(413);
    });

    it('a pending (unattached) upload is only downloadable by its uploader via bearer', async () => {
      const ok = await http()
        .get(`/attachments/${attachmentId}`)
        .set(auth(alice))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.compare(ok.body as Buffer, PNG)).toBe(0);

      await http().get(`/attachments/${attachmentId}`).set(auth(bob)).expect(404);
    });

    it('the signed URL downloads without any auth header (for <img> tags)', async () => {
      const res = await http().get(signedUrl).expect(200);
      expect(res.headers['content-type']).toContain('image/png');
    });

    it('a tampered signature is rejected', async () => {
      const [path, query] = signedUrl.split('?');
      const tampered = query.replace(/sig=[^&]+/, 'sig=deadbeef');
      await http().get(`${path}?${tampered}`).expect(401);
    });

    it('attachments on private-channel messages are hidden from non-members', async () => {
      const up = await http()
        .post(`/workspaces/${workspaceId}/attachments`)
        .set(auth(alice))
        .attach('file', PNG, { filename: 'secret.png', contentType: 'image/png' })
        .expect(201);
      await send(secretChannelId, alice, 'the secret blueprint', {
        attachmentIds: [up.body.data.id],
      }).expect(201);

      await http().get(`/attachments/${up.body.data.id}`).set(auth(bob)).expect(404);
      await http().get(`/attachments/${up.body.data.id}`).set(auth(alice)).expect(200);
    });

    it('attachments ride along on the message DTO', async () => {
      const up = await http()
        .post(`/workspaces/${workspaceId}/attachments`)
        .set(auth(alice))
        .attach('file', PNG, { filename: 'shared.png', contentType: 'image/png' })
        .expect(201);
      const msg = await send(publicChannelId, alice, 'here is a file', {
        attachmentIds: [up.body.data.id],
      }).expect(201);
      expect(msg.body.data.attachments).toHaveLength(1);
      expect(msg.body.data.attachments[0].filename).toBe('shared.png');
      expect(msg.body.data.attachments[0].url).toContain('sig=');
    });

    it('cannot attach someone else’s pending upload', async () => {
      const up = await http()
        .post(`/workspaces/${workspaceId}/attachments`)
        .set(auth(alice))
        .attach('file', PNG, { filename: 'mine.png', contentType: 'image/png' })
        .expect(201);
      await send(publicChannelId, bob, 'stealing your upload', {
        attachmentIds: [up.body.data.id],
      }).expect(400);
    });
  });

  describe('search', () => {
    beforeAll(async () => {
      await send(publicChannelId, alice, `the migratory zeppelin-${run} returns in spring`).expect(201);
      await send(publicChannelId, bob, `zeppelin-${run} maintenance docs at https://example.com/z`).expect(201);
      await send(secretChannelId, alice, `classified zeppelin-${run} coordinates inside`).expect(201);
    });

    it('finds messages via FTS and scopes them to accessible containers', async () => {
      const aliceRes = await http()
        .get(`/workspaces/${workspaceId}/search?q=zeppelin-${run}`)
        .set(auth(alice))
        .expect(200);
      // Alice sees all three (public x2 + her private one).
      expect(aliceRes.body.data.messages).toHaveLength(3);

      const bobRes = await http()
        .get(`/workspaces/${workspaceId}/search?q=zeppelin-${run}`)
        .set(auth(bob))
        .expect(200);
      const bobTexts = bobRes.body.data.messages.map((m: { contentText: string }) => m.contentText);
      expect(bobRes.body.data.messages).toHaveLength(2);
      expect(bobTexts.join(' ')).not.toContain('classified');
    });

    it('applies from: and in: modifiers', async () => {
      const fromRes = await http()
        .get(
          `/workspaces/${workspaceId}/search?q=${encodeURIComponent(`zeppelin-${run} from:alice`)}`,
        )
        .set(auth(bob))
        .expect(200);
      expect(fromRes.body.data.messages).toHaveLength(1);
      expect(fromRes.body.data.messages[0].contentText).toContain('migratory');

      const inRes = await http()
        .get(
          `/workspaces/${workspaceId}/search?q=${encodeURIComponent(`zeppelin-${run} in:fsp-public`)}`,
        )
        .set(auth(bob))
        .expect(200);
      expect(inRes.body.data.messages).toHaveLength(2);

      // in: an inaccessible private channel yields nothing rather than leaking.
      const sneaky = await http()
        .get(
          `/workspaces/${workspaceId}/search?q=${encodeURIComponent(`zeppelin-${run} in:fsp-secret`)}`,
        )
        .set(auth(bob))
        .expect(200);
      expect(sneaky.body.data.messages).toHaveLength(0);
    });

    it('applies has:link and has:file', async () => {
      const linkRes = await http()
        .get(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(`zeppelin-${run} has:link`)}`)
        .set(auth(bob))
        .expect(200);
      expect(linkRes.body.data.messages).toHaveLength(1);
      expect(linkRes.body.data.messages[0].contentText).toContain('https://');

      const fileRes = await http()
        .get(`/workspaces/${workspaceId}/search?q=${encodeURIComponent('file has:file')}`)
        .set(auth(bob))
        .expect(200);
      for (const m of fileRes.body.data.messages) {
        expect(m.attachments.length).toBeGreaterThan(0);
      }
    });

    it('applies before:/after: date modifiers', async () => {
      const future = await http()
        .get(
          `/workspaces/${workspaceId}/search?q=${encodeURIComponent(`zeppelin-${run} after:2030-01-01`)}`,
        )
        .set(auth(bob))
        .expect(200);
      expect(future.body.data.messages).toHaveLength(0);

      const past = await http()
        .get(
          `/workspaces/${workspaceId}/search?q=${encodeURIComponent(
            `zeppelin-${run} after:2020-01-01 before:2030-01-01`,
          )}`,
        )
        .set(auth(bob))
        .expect(200);
      expect(past.body.data.messages).toHaveLength(2);
    });

    it('files/channels/people tabs are scoped too', async () => {
      const res = await http()
        .get(`/workspaces/${workspaceId}/search?q=fsp`)
        .set(auth(bob))
        .expect(200);
      const channelNames = res.body.data.channels.map((c: { name: string }) => c.name);
      expect(channelNames).toContain('fsp-public');
      expect(channelNames).not.toContain('fsp-secret'); // private, bob is not a member
      expect(res.body.data.people.length).toBeGreaterThanOrEqual(2);

      const fileRes = await http()
        .get(`/workspaces/${workspaceId}/search?q=secret&type=files`)
        .set(auth(bob))
        .expect(200);
      const names = fileRes.body.data.files.map((f: { filename: string }) => f.filename);
      expect(names).not.toContain('secret.png'); // lives in the private channel
    });

    it('the FTS query uses the GIN index (EXPLAIN)', async () => {
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
        return tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
          Prisma.sql`EXPLAIN SELECT id FROM "Message" WHERE "searchVector" @@ plainto_tsquery('english', ${'zeppelin'})`,
        );
      });
      const planText = plan.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toContain('Message_searchVector_idx');
    });
  });

  describe('presence', () => {
    it('manual DND/AWAY override and ACTIVE clears it', async () => {
      await http().patch('/me/presence').set(auth(alice)).send({ state: 'DND' }).expect(200);
      let map = await http().get(`/workspaces/${workspaceId}/presence`).set(auth(bob)).expect(200);
      expect(map.body.data[alice.id]).toBe('DND');

      await http().patch('/me/presence').set(auth(alice)).send({ state: 'ACTIVE' }).expect(200);
      map = await http().get(`/workspaces/${workspaceId}/presence`).set(auth(bob)).expect(200);
      // No socket connected → back to OFFLINE once the override is gone.
      expect(map.body.data[alice.id]).toBe('OFFLINE');
    });

    it('socket connect flips presence to ACTIVE and broadcasts; disconnect flips back', async () => {
      // Bob listens for alice's presence changes.
      const bobSocket: Socket = io(baseUrl, { auth: { token: bob.token }, transports: ['websocket'] });
      await new Promise<void>((resolve, reject) => {
        bobSocket.once(SOCKET_EVENTS.READY, () => resolve());
        bobSocket.once('connect_error', reject);
      });

      const activePromise = new Promise<{ userId: string; state: string }>((resolve) => {
        const handler = (p: { userId: string; state: string }) => {
          if (p.userId === alice.id && p.state === 'ACTIVE') {
            bobSocket.off(SOCKET_EVENTS.PRESENCE_CHANGED, handler);
            resolve(p);
          }
        };
        bobSocket.on(SOCKET_EVENTS.PRESENCE_CHANGED, handler);
      });

      const aliceSocket: Socket = io(baseUrl, { auth: { token: alice.token }, transports: ['websocket'] });
      await new Promise<void>((resolve, reject) => {
        aliceSocket.once(SOCKET_EVENTS.READY, () => resolve());
        aliceSocket.once('connect_error', reject);
      });
      await activePromise;

      const map = await http().get(`/workspaces/${workspaceId}/presence`).set(auth(bob)).expect(200);
      expect(map.body.data[alice.id]).toBe('ACTIVE');

      const offlinePromise = new Promise<void>((resolve) => {
        const handler = (p: { userId: string; state: string }) => {
          if (p.userId === alice.id && p.state === 'OFFLINE') {
            bobSocket.off(SOCKET_EVENTS.PRESENCE_CHANGED, handler);
            resolve();
          }
        };
        bobSocket.on(SOCKET_EVENTS.PRESENCE_CHANGED, handler);
      });
      aliceSocket.disconnect();
      await offlinePromise;

      bobSocket.disconnect();
    });

    it('custom status with emoji is stored and broadcast', async () => {
      const res = await http()
        .patch('/me/status')
        .set(auth(alice))
        .send({ statusEmoji: 'palm_tree', statusText: 'On vacation' })
        .expect(200);
      expect(res.body.data.statusEmoji).toBe('palm_tree');
      expect(res.body.data.statusText).toBe('On vacation');

      const me = await http().get('/auth/me').set(auth(alice)).expect(200);
      expect(me.body.data.statusEmoji).toBe('palm_tree');
    });
  });

  describe('notification prefs & activity', () => {
    it('per-channel notification pref round-trips', async () => {
      await http()
        .patch(`/channels/${publicChannelId}/notifications`)
        .set(auth(bob))
        .send({ pref: 'MUTED' })
        .expect(200);
      const channel = await http().get(`/channels/${publicChannelId}`).set(auth(bob)).expect(200);
      expect(channel.body.data.notificationPref).toBe('MUTED');
    });

    it('activity feed lists mention notifications with actor and preview; mark-read clears', async () => {
      await send(publicChannelId, alice, `@bob activity check`, {
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'mention', attrs: { id: bob.id, label: 'bob' } },
                { type: 'text', text: ' activity check' },
              ],
            },
          ],
        },
      }).expect(201);

      const feed = await http().get('/me/notifications').set(auth(bob)).expect(200);
      expect(feed.body.data.unreadCount).toBeGreaterThanOrEqual(1);
      const mention = feed.body.data.notifications.find((n: { type: string }) => n.type === 'MENTION');
      expect(mention).toBeDefined();
      expect(mention.actor.id).toBe(alice.id);
      expect(mention.preview).toContain('activity check');
      expect(mention.channelName).toBe('fsp-public');

      await http().post('/me/notifications/read').set(auth(bob)).send({}).expect(200);
      const after = await http().get('/me/notifications').set(auth(bob)).expect(200);
      expect(after.body.data.unreadCount).toBe(0);
    });
  });

  describe('pins & saved items', () => {
    let messageId: string;

    beforeAll(async () => {
      const msg = await send(publicChannelId, alice, 'pin and save me').expect(201);
      messageId = msg.body.data.id;
    });

    it('pins are per-channel and member-visible', async () => {
      await http().post(`/messages/${messageId}/pin`).set(auth(alice)).expect(200);
      const pins = await http().get(`/channels/${publicChannelId}/pins`).set(auth(bob)).expect(200);
      expect(pins.body.data.map((p: { message: { id: string } }) => p.message.id)).toContain(messageId);
      expect(pins.body.data[0].pinnedBy.id).toBe(alice.id);
    });

    it('non-members cannot pin or list pins', async () => {
      const secretMsg = await send(secretChannelId, alice, 'secret pinnable').expect(201);
      await http().post(`/messages/${secretMsg.body.data.id}/pin`).set(auth(bob)).expect(404);
      await http().get(`/channels/${secretChannelId}/pins`).set(auth(bob)).expect(404);
    });

    it('saved items are private to the saver', async () => {
      await http().post(`/messages/${messageId}/save`).set(auth(bob)).expect(200);
      const bobSaved = await http().get(`/workspaces/${workspaceId}/saved`).set(auth(bob)).expect(200);
      expect(bobSaved.body.data.map((s: { message: { id: string } }) => s.message.id)).toContain(messageId);

      const aliceSaved = await http().get(`/workspaces/${workspaceId}/saved`).set(auth(alice)).expect(200);
      expect(aliceSaved.body.data.map((s: { message: { id: string } }) => s.message.id)).not.toContain(
        messageId,
      );

      await http().delete(`/messages/${messageId}/save`).set(auth(bob)).expect(200);
      const after = await http().get(`/workspaces/${workspaceId}/saved`).set(auth(bob)).expect(200);
      expect(after.body.data).toHaveLength(0);
    });
  });

  describe('profile (name + avatar)', () => {
    it('updates the display name', async () => {
      const res = await http()
        .patch('/me/profile')
        .set(auth(bob))
        .send({ displayName: 'Bob Renamed' })
        .expect(200);
      expect(res.body.data.displayName).toBe('Bob Renamed');
      const me = await http().get('/auth/me').set(auth(bob)).expect(200);
      expect(me.body.data.displayName).toBe('Bob Renamed');
    });

    it('rejects an empty display name', async () => {
      await http().patch('/me/profile').set(auth(bob)).send({ displayName: '' }).expect(400);
    });

    it('uploads an avatar and sets a durable url', async () => {
      const res = await http()
        .post('/me/avatar')
        .set(auth(alice))
        .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' })
        .expect(201);
      expect(res.body.data.avatarUrl).toContain('/attachments/');
      expect(res.body.data.avatarUrl).toContain('sig=');
      // The signed avatar url is publicly fetchable (used by plain <img> tags).
      const path = res.body.data.avatarUrl as string;
      await http().get(path).expect(200);
    });

    it('rejects a non-image avatar', async () => {
      await http()
        .post('/me/avatar')
        .set(auth(alice))
        .attach('file', Buffer.from('not an image'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        })
        .expect(400);
    });
  });

  describe('channel groups', () => {
    it('creates a channel under an integration group and returns groupKey in the list', async () => {
      const created = await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: `grp-${run}`, groupKey: 'jira' })
        .expect(201);
      expect(created.body.data.groupKey).toBe('jira');

      const list = await http()
        .get(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .expect(200);
      const ch = list.body.data.find((c: { id: string }) => c.id === created.body.data.id);
      expect(ch.groupKey).toBe('jira');
    });

    it('rejects an unknown group key', async () => {
      await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: `grp2-${run}`, groupKey: 'bogus' })
        .expect(400);
    });

    it('a normal channel has a null group', async () => {
      const created = await http()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: `plain-${run}` })
        .expect(201);
      expect(created.body.data.groupKey).toBeNull();
    });
  });
});
