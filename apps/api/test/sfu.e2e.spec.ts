import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HuddleService } from '../src/realtime/huddle.service';
import { HuddleMediaHooks } from '../src/realtime/huddle-media-hooks';
import { configureBodyParsers } from '../src/common/body-parsers';

/**
 * Large-meeting huddles through LiveKit: tokens only for admitted members, one
 * LiveKit room per breakout, server-side enforcement, and server recording via
 * Egress — all against a fake LiveKit server API (no media server in CI).
 */
describe('SFU huddles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let huddle: HuddleService;
  let hooks: HuddleMediaHooks;
  const run = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const KEY = 'devkey';
  const SECRET = 'e2e-livekit-secret-that-is-long-enough';
  const LK = 'http://livekit.test';

  let owner: { id: string; token: string };
  let member: { id: string; token: string };
  let outsider: { id: string; token: string };
  let workspaceId: string;
  let channelId: string;
  let hkey: string;

  // ---- fake LiveKit server API ----
  const realFetch = global.fetch;
  const calls: { method: string; body: Record<string, unknown>; grant: Record<string, unknown> }[] = [];
  /** room → identities connected */
  const rooms = new Map<string, Set<string>>();
  let egressFails = false;
  let egressSeq = 0;
  const saved: Record<string, string | undefined> = {};
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  const connect = (room: string, identity: string) => {
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room)!.add(identity);
  };
  const callsOf = (method: string) => calls.filter((c) => c.method === method);

  async function until(cond: () => boolean | Promise<boolean>, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out waiting for condition');
  }

  /** A webhook signed the way LiveKit signs them. */
  const webhook = (event: Record<string, unknown>, secret = SECRET) => {
    const raw = JSON.stringify(event);
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      iss: KEY,
      nbf: now,
      exp: now + 300,
      sha256: createHash('sha256').update(raw).digest('base64'),
    })}`;
    const jwt = `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
    return api().post('/webhooks/livekit').set('Content-Type', 'application/webhook+json').set('Authorization', jwt).send(raw);
  };

  const signup = async (name: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ email: `sfu-${name}-${run}@test.local`, password: 'password123!', displayName: `${name} sfu` })
      .expect(201);
    return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
  };
  const tokenFor = (t: string) => api().post('/huddles/sfu/token').set(auth(t)).send({ channelId });

  beforeAll(async () => {
    for (const k of ['LIVEKIT_URL', 'LIVEKIT_API_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_EGRESS', 'STORAGE_DRIVER']) {
      saved[k] = process.env[k];
    }
    Object.assign(process.env, {
      LIVEKIT_URL: 'ws://livekit.test',
      LIVEKIT_API_URL: LK,
      LIVEKIT_API_KEY: KEY,
      LIVEKIT_API_SECRET: SECRET,
      LIVEKIT_EGRESS: '1',
      STORAGE_DRIVER: 'disk',
    });
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.startsWith(`${LK}/twirp/`)) return realFetch(input as string, init);
      const method = url.split('/').pop()!;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const bearer = String((init?.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', '');
      calls.push({ method, body, grant: decode(bearer).video });
      if (method === 'ListParticipants') {
        const set = rooms.get(String(body.room));
        if (!set) return json({ code: 'not_found', msg: 'room not found' }, 404);
        return json({ participants: [...set].map((identity) => ({ identity })) });
      }
      if (method === 'RemoveParticipant') {
        const set = rooms.get(String(body.room));
        if (!set?.delete(String(body.identity))) return json({ code: 'not_found', msg: 'participant not found' }, 404);
        return json({});
      }
      if (method === 'StartRoomCompositeEgress') {
        if (egressFails) return json({ code: 'unavailable', msg: 'no egress workers' }, 503);
        return json({ egressId: `EG_${run}_${++egressSeq}`, status: 'EGRESS_STARTING' });
      }
      if (method === 'StopEgress') return json({ status: 'EGRESS_ENDING' });
      return json({ msg: 'unexpected' }, 500);
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureBodyParsers(app as NestExpressApplication);
    await app.init();
    prisma = app.get(PrismaService);
    huddle = app.get(HuddleService);
    hooks = app.get(HuddleMediaHooks);

    owner = await signup('owner');
    member = await signup('member');
    outsider = await signup('outsider');
    workspaceId = (await api().post('/workspaces').set(auth(owner.token)).send({ name: `SFU ${run}` }).expect(201)).body.data.id;
    channelId = (await api().post(`/workspaces/${workspaceId}/channels`).set(auth(owner.token)).send({ name: `sfu-${run}` }).expect(201))
      .body.data.id;
    await prisma.workspaceMember.create({ data: { workspaceId, userId: member.id } });
    await prisma.channelMember.create({ data: { channelId, userId: member.id } });
    hkey = `channel:${channelId}`;
  });

  afterAll(async () => {
    await prisma.huddleRecording.deleteMany({ where: { huddleKey: hkey } });
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
    jest.restoreAllMocks();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('reports the SFU and server recording as available', async () => {
    const res = await api().get('/huddles/sfu/status').set(auth(owner.token)).expect(200);
    expect(res.body.data).toEqual({ enabled: true, recording: true });
  });

  it('only gives tokens to members who are admitted to the huddle', async () => {
    await tokenFor(outsider.token).expect(404);
    await api().post('/huddles/sfu/token').set(auth(owner.token)).send({}).expect(400);
    await tokenFor(owner.token).expect(403); // a channel member, but not in the huddle
    // Waiting in the waiting room is not being in the huddle either.
    huddle.join(hkey, owner.id, 's-owner');
    huddle.addWaiting(hkey, member.id, 's-member');
    await tokenFor(member.token).expect(403);
    huddle.removeWaiting(hkey, member.id);

    const res = await tokenFor(owner.token).expect(201);
    expect(res.body.data).toMatchObject({ url: 'ws://livekit.test', room: hkey });
    const claims = decode(res.body.data.token);
    expect(claims).toMatchObject({ iss: KEY, name: 'owner sfu', video: { room: hkey, roomJoin: true, canPublish: true, canSubscribe: true } });
    expect(claims.sub).toMatch(new RegExp(`^${owner.id}~[A-Za-z0-9_-]+$`));
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
    // Each connection gets its own identity (tabs don't kick each other).
    const again = decode((await tokenFor(owner.token).expect(201)).body.data.token);
    expect(again.sub).not.toBe(claims.sub);
  });

  it('puts breakout rooms in their own LiveKit rooms and kicks stale connections on moves', async () => {
    huddle.join(hkey, member.id, 's-member');
    connect(hkey, `${owner.id}~o1`);
    connect(hkey, `${member.id}~m1`);
    huddle.openBreakouts(hkey, [{ id: 'b1', name: 'Room 1' }], { [member.id]: 'b1' });
    const res = await tokenFor(member.token).expect(201);
    expect(res.body.data.room).toBe(`${hkey}~br~b1`);
    expect(decode(res.body.data.token).video.room).toBe(`${hkey}~br~b1`);

    calls.length = 0;
    hooks.breakoutsChanged(hkey);
    await until(() => !rooms.get(hkey)!.has(`${member.id}~m1`));
    expect(rooms.get(hkey)!.has(`${owner.id}~o1`)).toBe(true); // still where they belong
    expect(callsOf('RemoveParticipant')).toEqual([
      expect.objectContaining({ body: { room: hkey, identity: `${member.id}~m1` }, grant: { room: hkey, roomAdmin: true } }),
    ]);

    // Closing breakouts: the breakout connection is now the stale one.
    connect(`${hkey}~br~b1`, `${member.id}~m2`);
    huddle.closeBreakouts(hkey);
    hooks.breakoutsChanged(hkey);
    await until(() => !rooms.get(`${hkey}~br~b1`)!.has(`${member.id}~m2`));
  });

  it('re-checks every connection from the participant_joined webhook', async () => {
    await webhook({ event: 'participant_joined', room: { name: hkey }, participant: { identity: `${outsider.id}~x` } }, 'wrong-secret').expect(
      403,
    );
    connect(hkey, `${outsider.id}~x`);
    connect(hkey, `${member.id}~ok`);
    await webhook({ event: 'participant_joined', room: { name: hkey }, participant: { identity: `${outsider.id}~x` } }).expect(200);
    expect(rooms.get(hkey)!.has(`${outsider.id}~x`)).toBe(false);
    await webhook({ event: 'participant_joined', room: { name: hkey }, participant: { identity: `${member.id}~ok` } }).expect(200);
    expect(rooms.get(hkey)!.has(`${member.id}~ok`)).toBe(true);
  });

  it('cuts a member’s media when they leave or are removed — but not after a quick reconnect', async () => {
    connect(hkey, `${member.id}~a`);
    // Left, but already back in (socket blip): keep the media.
    calls.length = 0;
    hooks.memberLeft(hkey, member.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(callsOf('RemoveParticipant')).toHaveLength(0);
    // A moderator removed them: cut it even though they're still present.
    hooks.memberLeft(hkey, member.id, true);
    await until(() => !rooms.get(hkey)!.has(`${member.id}~a`) && !rooms.get(hkey)!.has(`${member.id}~ok`));
    // Really left.
    connect(hkey, `${member.id}~b`);
    huddle.leave(hkey, member.id, 's-member');
    hooks.memberLeft(hkey, member.id);
    await until(() => !rooms.get(hkey)!.has(`${member.id}~b`));
    huddle.join(hkey, member.id, 's-member');
  });

  describe('server recording (Egress)', () => {
    const uploads = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');
    const recMessages = () =>
      prisma.message.findMany({ where: { channelId, contentText: { startsWith: '🔴 Huddle recording' } }, include: { attachments: true } });

    it('starts an egress into our storage, stops it, and posts the file once when it ends', async () => {
      calls.length = 0;
      expect(huddle.setRecording(hkey, owner.id, true)).toBe(true);
      hooks.recordingChanged(hkey, huddle.getSettings(hkey));
      await until(async () => (await prisma.huddleRecording.count({ where: { huddleKey: hkey } })) === 1);
      const row = await prisma.huddleRecording.findFirstOrThrow({ where: { huddleKey: hkey } });
      expect(row).toMatchObject({ status: 'ACTIVE', startedById: owner.id, egressId: `EG_${run}_1` });
      const [start] = callsOf('StartRoomCompositeEgress');
      expect(start.grant).toEqual({ room: hkey, roomRecord: true });
      expect(start.body).toEqual({
        room_name: hkey,
        layout: 'speaker',
        file_outputs: [{ file_type: 'MP4', filepath: `${uploads.replace(/[\\/]+$/, '')}/${row.storageKey}` }],
      });
      // A second "start" while one runs doesn't start another egress.
      hooks.recordingChanged(hkey, huddle.getSettings(hkey));
      await new Promise((r) => setTimeout(r, 100));
      expect(callsOf('StartRoomCompositeEgress')).toHaveLength(1);

      huddle.setRecording(hkey, null);
      hooks.recordingChanged(hkey, huddle.getSettings(hkey));
      await until(() => callsOf('StopEgress').length === 1);
      expect(callsOf('StopEgress')[0].body).toEqual({ egress_id: row.egressId });
      await until(async () => (await prisma.huddleRecording.findUniqueOrThrow({ where: { id: row.id } })).status === 'STOPPING');

      // Egress wrote the file into our uploads folder; LiveKit reports it ended.
      fs.mkdirSync(uploads, { recursive: true });
      fs.writeFileSync(path.join(uploads, row.storageKey), Buffer.from('fake mp4'));
      const ended = {
        event: 'egress_ended',
        egressInfo: { egressId: row.egressId, roomName: hkey, status: 'EGRESS_COMPLETE', fileResults: [{ size: '8', duration: '125000000000' }] },
      };
      await webhook(ended).expect(200);
      await webhook(ended).expect(200); // redelivery
      const msgs = await recMessages();
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ userId: owner.id, contentText: '🔴 Huddle recording · 2:05' });
      expect(msgs[0].attachments).toEqual([
        expect.objectContaining({ mimeType: 'video/mp4', sizeBytes: 8, storageKey: row.storageKey, uploaderId: owner.id }),
      ]);
      expect(await prisma.huddleRecording.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: 'COMPLETE',
        messageId: msgs[0].id,
      });
      // Channel members can download it like any attachment.
      const dl = await api().get(`/attachments/${msgs[0].attachments[0].id}`).set(auth(member.token));
      expect(dl.status).toBe(200);
      expect(dl.headers['content-length']).toBe('8');
      fs.rmSync(path.join(uploads, row.storageKey), { force: true });
    });

    it('takes the indicator down when the egress can’t start or fails on its own', async () => {
      egressFails = true;
      huddle.setRecording(hkey, owner.id, true);
      hooks.recordingChanged(hkey, huddle.getSettings(hkey));
      await until(() => huddle.getSettings(hkey).recordingBy === null);
      egressFails = false;

      huddle.setRecording(hkey, owner.id, true);
      hooks.recordingChanged(hkey, huddle.getSettings(hkey));
      await until(async () => (await prisma.huddleRecording.count({ where: { huddleKey: hkey, status: 'ACTIVE' } })) === 1);
      const row = await prisma.huddleRecording.findFirstOrThrow({ where: { huddleKey: hkey, status: 'ACTIVE' } });
      await webhook({ event: 'egress_ended', egressInfo: { egressId: row.egressId, status: 'EGRESS_FAILED', error: 'out of disk' } }).expect(200);
      expect(huddle.getSettings(hkey).recordingBy).toBeNull();
      expect(await prisma.huddleRecording.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'FAILED', error: 'out of disk' });
      expect(await recMessages()).toHaveLength(1); // nothing new posted
    });

    it('stops a running egress when the huddle ends', async () => {
      huddle.setRecording(hkey, owner.id, true);
      hooks.recordingChanged(hkey, huddle.getSettings(hkey));
      await until(async () => (await prisma.huddleRecording.count({ where: { huddleKey: hkey, status: 'ACTIVE' } })) === 1);
      calls.length = 0;
      hooks.huddleEnded(hkey);
      await until(() => callsOf('StopEgress').length === 1);
    });
  });
});
