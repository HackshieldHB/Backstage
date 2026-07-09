import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Authorization attack suite: every test here impersonates a hostile or
 * out-of-scope caller hitting the API directly by resource id.
 */
describe('authorization (e2e attack suite)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
    email: string;
  }
  const actors: Record<'owner' | 'admin' | 'member' | 'guest' | 'outsider', Actor> = {} as never;

  let ws1: string; // workspace under attack
  let ws2: string; // outsider's own workspace (they are OWNER there)
  let generalId: string;
  let devId: string; // public channel in ws1
  let secretsId: string; // private channel in ws1 (owner only)

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    for (const name of ['owner', 'admin', 'member', 'guest', 'outsider'] as const) {
      const email = `authz-${name}-${run}@test.local`;
      const res = await http()
        .post('/auth/signup')
        .send({ email, password: 'password123!', displayName: `${name} ${run}` })
        .expect(201);
      actors[name] = { id: res.body.data.user.id, token: res.body.data.accessToken, email };
    }

    // Owner sets up ws1 with #general (auto), a public and a private channel.
    const wsRes = await http()
      .post('/workspaces')
      .set(auth(actors.owner))
      .send({ name: `Attack Target ${run}` })
      .expect(201);
    ws1 = wsRes.body.data.id;

    const channels = await http().get(`/workspaces/${ws1}/channels`).set(auth(actors.owner));
    generalId = channels.body.data.find((c: { name: string }) => c.name === 'general').id;

    const dev = await http()
      .post(`/workspaces/${ws1}/channels`)
      .set(auth(actors.owner))
      .send({ name: 'dev', isPrivate: false })
      .expect(201);
    devId = dev.body.data.id;

    const secrets = await http()
      .post(`/workspaces/${ws1}/channels`)
      .set(auth(actors.owner))
      .send({ name: 'secrets', isPrivate: true })
      .expect(201);
    secretsId = secrets.body.data.id;

    // Bring admin/member/guest into ws1 via invites.
    for (const [name, role] of [
      ['admin', 'ADMIN'],
      ['member', 'MEMBER'],
      ['guest', 'GUEST'],
    ] as const) {
      const invite = await http()
        .post(`/workspaces/${ws1}/invites`)
        .set(auth(actors.owner))
        .send({ email: actors[name].email, role })
        .expect(201);
      await http()
        .post('/invites/accept')
        .set(auth(actors[name]))
        .send({ token: invite.body.data.token })
        .expect(200);
    }

    // Outsider owns their own workspace (tests cross-workspace admin power).
    const ws2Res = await http()
      .post('/workspaces')
      .set(auth(actors.outsider))
      .send({ name: `Outsider HQ ${run}` })
      .expect(201);
    ws2 = ws2Res.body.data.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: [ws1, ws2] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  describe('outsider (not a workspace member)', () => {
    it('cannot read the workspace, members, or channels', async () => {
      await http().get(`/workspaces/${ws1}`).set(auth(actors.outsider)).expect(404);
      await http().get(`/workspaces/${ws1}/members`).set(auth(actors.outsider)).expect(404);
      await http().get(`/workspaces/${ws1}/channels`).set(auth(actors.outsider)).expect(404);
      await http().get(`/workspaces/${ws1}/channels/browse`).set(auth(actors.outsider)).expect(404);
    });

    it('cannot read or join a channel by id', async () => {
      await http().get(`/channels/${devId}`).set(auth(actors.outsider)).expect(404);
      await http().get(`/channels/${devId}/members`).set(auth(actors.outsider)).expect(404);
      await http().post(`/channels/${devId}/join`).set(auth(actors.outsider)).expect(404);
    });

    it('cannot open a DM into the workspace', async () => {
      await http()
        .post(`/workspaces/${ws1}/conversations`)
        .set(auth(actors.outsider))
        .send({ memberIds: [actors.member.id] })
        .expect(404);
    });

    it('OWNER role in their own workspace grants nothing in ws1 (cross-workspace attack)', async () => {
      await http().patch(`/channels/${devId}`).set(auth(actors.outsider)).send({ topic: 'pwned' }).expect(404);
      await http().delete(`/channels/${devId}`).set(auth(actors.outsider)).expect(404);
      await http().post(`/channels/${devId}/archive`).set(auth(actors.outsider)).expect(404);
      await http()
        .post(`/workspaces/${ws1}/invites`)
        .set(auth(actors.outsider))
        .send({ email: 'evil@test.local', role: 'ADMIN' })
        .expect(404);
      await http()
        .patch(`/workspaces/${ws1}/members/${actors.member.id}`)
        .set(auth(actors.outsider))
        .send({ role: 'GUEST' })
        .expect(404);
    });
  });

  describe('private channels', () => {
    it('a regular member cannot see, join, or list a private channel', async () => {
      await http().get(`/channels/${secretsId}`).set(auth(actors.member)).expect(404);
      await http().post(`/channels/${secretsId}/join`).set(auth(actors.member)).expect(404);
      await http().get(`/channels/${secretsId}/members`).set(auth(actors.member)).expect(404);
    });

    it('private channels are hidden from the browser for non-members', async () => {
      const res = await http().get(`/workspaces/${ws1}/channels/browse`).set(auth(actors.member)).expect(200);
      const names = res.body.data.map((c: { name: string }) => c.name);
      expect(names).not.toContain('secrets');
      expect(names).toContain('dev');
    });

    it('even an ADMIN cannot act on a private channel they are not in', async () => {
      await http().delete(`/channels/${secretsId}`).set(auth(actors.admin)).expect(404);
      await http().post(`/channels/${secretsId}/archive`).set(auth(actors.admin)).expect(404);
    });
  });

  describe('GUEST isolation', () => {
    it('guest was not auto-added to #general and sees no channels initially', async () => {
      const res = await http().get(`/workspaces/${ws1}/channels`).set(auth(actors.guest)).expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('guest browse lists only explicitly-granted channels (not even public ones)', async () => {
      const res = await http().get(`/workspaces/${ws1}/channels/browse`).set(auth(actors.guest)).expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('guest cannot self-join a public channel', async () => {
      await http().post(`/channels/${devId}/join`).set(auth(actors.guest)).expect(404);
    });

    it('guest cannot create channels', async () => {
      await http()
        .post(`/workspaces/${ws1}/channels`)
        .set(auth(actors.guest))
        .send({ name: 'guest-channel' })
        .expect(403);
    });

    it('guest sees a channel only after being explicitly added', async () => {
      // Only channel members can add others — member joins the public channel first.
      await http().post(`/channels/${devId}/join`).set(auth(actors.member)).expect(200);
      await http()
        .post(`/channels/${devId}/members`)
        .set(auth(actors.member))
        .send({ userId: actors.guest.id })
        .expect(201);
      const res = await http().get(`/workspaces/${ws1}/channels/browse`).set(auth(actors.guest)).expect(200);
      expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['dev']);
    });
  });

  describe('roles and member management', () => {
    it('admin cannot demote another admin or the owner; only the owner can', async () => {
      // Promote member to ADMIN first (owner does it).
      await http()
        .patch(`/workspaces/${ws1}/members/${actors.member.id}`)
        .set(auth(actors.owner))
        .send({ role: 'ADMIN' })
        .expect(200);
      // admin (peer) cannot demote them.
      await http()
        .patch(`/workspaces/${ws1}/members/${actors.member.id}`)
        .set(auth(actors.admin))
        .send({ role: 'MEMBER' })
        .expect(403);
      // owner can.
      await http()
        .patch(`/workspaces/${ws1}/members/${actors.member.id}`)
        .set(auth(actors.owner))
        .send({ role: 'MEMBER' })
        .expect(200);
      // nobody can touch the owner.
      await http()
        .patch(`/workspaces/${ws1}/members/${actors.owner.id}`)
        .set(auth(actors.admin))
        .send({ role: 'MEMBER' })
        .expect(403);
    });

    it('a plain member cannot invite or manage members', async () => {
      await http()
        .post(`/workspaces/${ws1}/invites`)
        .set(auth(actors.member))
        .send({ email: 'friend@test.local' })
        .expect(403);
      await http()
        .delete(`/workspaces/${ws1}/members/${actors.guest.id}`)
        .set(auth(actors.member))
        .expect(403);
    });

    it('the owner cannot be removed', async () => {
      await http()
        .delete(`/workspaces/${ws1}/members/${actors.owner.id}`)
        .set(auth(actors.admin))
        .expect(403);
    });
  });

  describe('invites', () => {
    it('an email invite cannot be accepted by a different account', async () => {
      const invite = await http()
        .post(`/workspaces/${ws2}/invites`)
        .set(auth(actors.outsider))
        .send({ email: 'someone-else@test.local' })
        .expect(201);
      await http()
        .post('/invites/accept')
        .set(auth(actors.member))
        .send({ token: invite.body.data.token })
        .expect(403);
    });

    it('a revoked invite is rejected', async () => {
      const invite = await http()
        .post(`/workspaces/${ws2}/invites`)
        .set(auth(actors.outsider))
        .send({})
        .expect(201);
      await http()
        .delete(`/workspaces/${ws2}/invites/${invite.body.data.id}`)
        .set(auth(actors.outsider))
        .expect(200);
      await http()
        .post('/invites/accept')
        .set(auth(actors.member))
        .send({ token: invite.body.data.token })
        .expect(401);
    });

    it('a garbage token is rejected', async () => {
      await http().post('/invites/accept').set(auth(actors.member)).send({ token: 'garbage' }).expect(401);
    });

    it('a link invite works for any account and adds them to #general', async () => {
      const invite = await http()
        .post(`/workspaces/${ws2}/invites`)
        .set(auth(actors.outsider))
        .send({})
        .expect(201);
      await http()
        .post('/invites/accept')
        .set(auth(actors.guest))
        .send({ token: invite.body.data.token })
        .expect(200);
      const chans = await http().get(`/workspaces/${ws2}/channels`).set(auth(actors.guest)).expect(200);
      expect(chans.body.data.map((c: { name: string }) => c.name)).toContain('general');
    });
  });

  describe('#general protections', () => {
    it('cannot be left, archived, deleted, or renamed', async () => {
      await http().post(`/channels/${generalId}/leave`).set(auth(actors.owner)).expect(403);
      await http().post(`/channels/${generalId}/archive`).set(auth(actors.owner)).expect(403);
      await http().delete(`/channels/${generalId}`).set(auth(actors.owner)).expect(403);
      await http()
        .patch(`/channels/${generalId}`)
        .set(auth(actors.owner))
        .send({ name: 'not-general' })
        .expect(403);
    });
  });

  describe('conversations', () => {
    it('opening the same 1:1 twice returns the same conversation', async () => {
      const a = await http()
        .post(`/workspaces/${ws1}/conversations`)
        .set(auth(actors.owner))
        .send({ memberIds: [actors.member.id] })
        .expect(200);
      const b = await http()
        .post(`/workspaces/${ws1}/conversations`)
        .set(auth(actors.member))
        .send({ memberIds: [actors.owner.id] })
        .expect(200);
      expect(a.body.data.id).toBe(b.body.data.id);
    });

    it('cannot include a non-workspace user in a DM', async () => {
      await http()
        .post(`/workspaces/${ws1}/conversations`)
        .set(auth(actors.owner))
        .send({ memberIds: [actors.outsider.id] })
        .expect(400);
    });

    it('a non-participant cannot read a conversation by id', async () => {
      const dm = await http()
        .post(`/workspaces/${ws1}/conversations`)
        .set(auth(actors.owner))
        .send({ memberIds: [actors.member.id] })
        .expect(200);
      await http().get(`/conversations/${dm.body.data.id}`).set(auth(actors.admin)).expect(404);
      await http().get(`/conversations/${dm.body.data.id}`).set(auth(actors.outsider)).expect(404);
    });

    it('rejects group DMs above the 9-member cap', async () => {
      const tooMany = Array.from({ length: 9 }, () => randomUUID());
      await http()
        .post(`/workspaces/${ws1}/conversations`)
        .set(auth(actors.owner))
        .send({ memberIds: tooMany })
        .expect(400);
    });
  });

  describe('channel lifecycle', () => {
    it('duplicate channel names are rejected', async () => {
      await http()
        .post(`/workspaces/${ws1}/channels`)
        .set(auth(actors.member))
        .send({ name: 'dev' })
        .expect(409);
    });

    it('archived channels cannot be joined', async () => {
      const c = await http()
        .post(`/workspaces/${ws1}/channels`)
        .set(auth(actors.owner))
        .send({ name: 'old-stuff' })
        .expect(201);
      await http().post(`/channels/${c.body.data.id}/archive`).set(auth(actors.owner)).expect(200);
      await http().post(`/channels/${c.body.data.id}/join`).set(auth(actors.member)).expect(400);
    });

    it('a removed channel member loses access', async () => {
      const c = await http()
        .post(`/workspaces/${ws1}/channels`)
        .set(auth(actors.owner))
        .send({ name: 'ephemeral', isPrivate: true })
        .expect(201);
      const cid = c.body.data.id;
      await http()
        .post(`/channels/${cid}/members`)
        .set(auth(actors.owner))
        .send({ userId: actors.member.id })
        .expect(201);
      await http().get(`/channels/${cid}`).set(auth(actors.member)).expect(200);
      await http().delete(`/channels/${cid}/members/${actors.member.id}`).set(auth(actors.owner)).expect(200);
      await http().get(`/channels/${cid}`).set(auth(actors.member)).expect(404);
    });
  });
});
