import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** /welcome: confirm your profile, then create or join a workspace. */
describe('onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const email = (name: string) => `onb-${name}-${run}@test.local`;

  const signup = async (name: string, verified = true) => {
    const res = await api()
      .post('/auth/signup')
      .send({ email: email(name), password: 'password123!', displayName: `${name} onb` })
      .expect(201);
    if (verified) await prisma.user.update({ where: { id: res.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
    return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string, user: res.body.data.user };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  describe('profile step', () => {
    it('email sign-up is already onboarded (they typed their name)', async () => {
      const u = await signup('email');
      expect(u.user.needsOnboarding).toBe(false);
    });

    it('a social sign-up confirms its name once, then is onboarded', async () => {
      const u = await signup('social');
      // Accounts created by Google/GitHub/SSO start without onboardedAt.
      await prisma.user.update({ where: { id: u.id }, data: { onboardedAt: null } });
      const me = await api().get('/auth/me').set(auth(u.token)).expect(200);
      expect(me.body.data.needsOnboarding).toBe(true);

      await api().post('/me/onboarding').set(auth(u.token)).send({ displayName: '   ' }).expect(400);
      const done = await api().post('/me/onboarding').set(auth(u.token)).send({ displayName: '  Real Name  ' }).expect(200);
      expect(done.body.data).toMatchObject({ displayName: 'Real Name', needsOnboarding: false });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      const first = row.onboardedAt!;

      // Saving again doesn't move the onboarding time.
      await api().post('/me/onboarding').set(auth(u.token)).send({ displayName: 'Renamed' }).expect(200);
      const again = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(again.onboardedAt!.getTime()).toBe(first.getTime());
    });
  });

  describe('join an existing workspace', () => {
    let owner: Awaited<ReturnType<typeof signup>>;
    let workspaceId: string;

    beforeAll(async () => {
      owner = await signup('owner');
      workspaceId = (await api().post('/workspaces').set(auth(owner.token)).send({ name: `Onb ${run}` }).expect(201)).body.data.id;
    });

    const invite = (body: Record<string, unknown>) =>
      api().post(`/workspaces/${workspaceId}/invites`).set(auth(owner.token)).send(body).expect(201);

    it('lists invitations addressed to my verified email and joins with one click', async () => {
      const invitee = await signup('invitee');
      await invite({ email: email('invitee') });
      await invite({}); // a link invite: never listed

      const list = await api().get('/me/invitations').set(auth(invitee.token)).expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({
          workspace: expect.objectContaining({ id: workspaceId, name: `Onb ${run}`, memberCount: 1 }),
          invitedBy: 'owner onb',
          role: 'MEMBER',
        }),
      ]);

      // Someone else can't use it.
      const stranger = await signup('stranger');
      await api().post(`/me/invitations/${list.body.data[0].id}/accept`).set(auth(stranger.token)).expect(404);

      const joined = await api().post(`/me/invitations/${list.body.data[0].id}/accept`).set(auth(invitee.token)).expect(200);
      expect(joined.body.data.id).toBe(workspaceId);
      const general = await prisma.channel.findFirstOrThrow({ where: { workspaceId, isDefault: true } });
      expect(await prisma.channelMember.count({ where: { channelId: general.id, userId: invitee.id } })).toBe(1);

      // Used and already a member: gone from the list, and can't be reused.
      expect((await api().get('/me/invitations').set(auth(invitee.token)).expect(200)).body.data).toEqual([]);
      await api().post(`/me/invitations/${list.body.data[0].id}/accept`).set(auth(invitee.token)).expect(401);
    });

    it('needs a verified email, and ignores revoked/expired invitations', async () => {
      const unverified = await signup('unverified', false);
      await invite({ email: email('unverified') });
      expect((await api().get('/me/invitations').set(auth(unverified.token)).expect(200)).body.data).toEqual([]);
      const row = await prisma.workspaceInvite.findFirstOrThrow({ where: { email: email('unverified') } });
      await api().post(`/me/invitations/${row.id}/accept`).set(auth(unverified.token)).expect(403);

      const late = await signup('late');
      await invite({ email: email('late') });
      await prisma.workspaceInvite.updateMany({ where: { email: email('late') }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const revoked = await signup('revoked');
      await invite({ email: email('revoked') });
      await prisma.workspaceInvite.updateMany({ where: { email: email('revoked') }, data: { revokedAt: new Date() } });
      expect((await api().get('/me/invitations').set(auth(late.token)).expect(200)).body.data).toEqual([]);
      expect((await api().get('/me/invitations').set(auth(revoked.token)).expect(200)).body.data).toEqual([]);
    });

    it('a link invite cannot be accepted by id', async () => {
      const someone = await signup('linkonly');
      await invite({});
      const link = await prisma.workspaceInvite.findFirstOrThrow({ where: { workspaceId, email: null } });
      await api().post(`/me/invitations/${link.id}/accept`).set(auth(someone.token)).expect(404);
    });
  });
});
