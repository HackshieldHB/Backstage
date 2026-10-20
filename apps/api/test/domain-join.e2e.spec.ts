import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TxtResolver } from '../src/security/domains.service';

/** "Anyone @acme.com can join" and join requests an admin approves. */
describe('domain join & join requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const domain = `acme-${run}.test`;
  const txt = new Map<string, string[]>();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let owner: { id: string; token: string };
  let workspaceId: string;
  let domainId: string;

  const signup = async (local: string, opts: { domain?: string; verified?: boolean } = {}) => {
    const email = `${local}-${run}@${opts.domain ?? domain}`;
    const res = await api().post('/auth/signup').send({ email, password: 'password123!', displayName: `${local} dj` }).expect(201);
    if (opts.verified !== false) await prisma.user.update({ where: { id: res.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
    return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
  };
  const setPolicy = (joinPolicy: string) =>
    api().patch(`/domains/${domainId}`).set(auth(owner.token)).send({ joinPolicy });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TxtResolver)
      .useValue({ resolve: async (name: string) => txt.get(name) ?? [] })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    owner = await signup('owner');
    workspaceId = (await api().post('/workspaces').set(auth(owner.token)).send({ name: `DJ ${run}` }).expect(201)).body.data.id;
    const added = await api().post(`/workspaces/${workspaceId}/domains`).set(auth(owner.token)).send({ domain }).expect(201);
    domainId = added.body.data.id;
    expect(added.body.data.joinPolicy).toBe('OFF');
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  it('only a verified domain can be opened, and only by the owner', async () => {
    await setPolicy('AUTO').expect(400); // not verified yet
    const added = await prisma.workspaceDomain.findUniqueOrThrow({ where: { id: domainId } });
    txt.set(`_backstages-challenge.${domain}`, [`backstages-verification=${added.token}`]);
    await api().post(`/domains/${domainId}/verify`).set(auth(owner.token)).expect(200);

    const admin = await signup('admin');
    await prisma.workspaceMember.create({ data: { workspaceId, userId: admin.id, role: 'ADMIN' } });
    await api().patch(`/domains/${domainId}`).set(auth(admin.token)).send({ joinPolicy: 'AUTO' }).expect(403);
    await setPolicy('BOGUS').expect(400);
    const res = await setPolicy('OFF').expect(200);
    expect(res.body.data.joinPolicy).toBe('OFF');
  });

  it('is invisible while the policy is OFF', async () => {
    const u = await signup('off');
    expect((await api().get('/me/joinable-workspaces').set(auth(u.token)).expect(200)).body.data).toEqual([]);
    await api().post(`/workspaces/${workspaceId}/join`).set(auth(u.token)).expect(404);
  });

  it('AUTO: people with a verified email on the domain join directly', async () => {
    await setPolicy('AUTO').expect(200);
    const u = await signup('auto');
    const list = await api().get('/me/joinable-workspaces').set(auth(u.token)).expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ id: workspaceId, name: `DJ ${run}`, domain, policy: 'AUTO', requestStatus: null }),
    ]);
    const joined = await api().post(`/workspaces/${workspaceId}/join`).set(auth(u.token)).expect(200);
    expect(joined.body.data).toEqual({ status: 'joined', workspaceId });
    const member = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: u.id } } });
    expect(member.role).toBe('MEMBER');
    const general = await prisma.channel.findFirstOrThrow({ where: { workspaceId, isDefault: true } });
    expect(await prisma.channelMember.count({ where: { channelId: general.id, userId: u.id } })).toBe(1);
    // No longer listed once in.
    expect((await api().get('/me/joinable-workspaces').set(auth(u.token)).expect(200)).body.data).toEqual([]);
  });

  it('never for an unverified email, another domain, or someone deactivated', async () => {
    const unverified = await signup('unverified', { verified: false });
    expect((await api().get('/me/joinable-workspaces').set(auth(unverified.token)).expect(200)).body.data).toEqual([]);
    await api().post(`/workspaces/${workspaceId}/join`).set(auth(unverified.token)).expect(403);

    const outsider = await signup('outsider', { domain: `other-${run}.test` });
    expect((await api().get('/me/joinable-workspaces').set(auth(outsider.token)).expect(200)).body.data).toEqual([]);
    await api().post(`/workspaces/${workspaceId}/join`).set(auth(outsider.token)).expect(404);

    const removed = await signup('removed');
    await prisma.workspaceMember.create({ data: { workspaceId, userId: removed.id, role: 'MEMBER', deactivatedAt: new Date() } });
    expect((await api().get('/me/joinable-workspaces').set(auth(removed.token)).expect(200)).body.data).toEqual([]);
    await api().post(`/workspaces/${workspaceId}/join`).set(auth(removed.token)).expect(403);
  });

  it('REQUEST: people ask, admins are notified and approve or deny', async () => {
    await setPolicy('REQUEST').expect(200);
    const asker = await signup('asker');
    const res = await api().post(`/workspaces/${workspaceId}/join`).set(auth(asker.token)).expect(200);
    expect(res.body.data).toEqual({ status: 'requested', workspaceId });
    // Asking twice doesn't duplicate.
    await api().post(`/workspaces/${workspaceId}/join`).set(auth(asker.token)).expect(200);
    expect((await api().get('/me/joinable-workspaces').set(auth(asker.token)).expect(200)).body.data[0].requestStatus).toBe('PENDING');
    // Not a member yet.
    expect(await prisma.workspaceMember.count({ where: { workspaceId, userId: asker.id } })).toBe(0);

    const ownerNotes = await prisma.notification.findMany({ where: { userId: owner.id, actorId: asker.id } });
    expect(ownerNotes.some((n) => (n.payload as { source?: string }).source === 'join_request')).toBe(true);

    const pending = await api().get(`/workspaces/${workspaceId}/join-requests`).set(auth(owner.token)).expect(200);
    expect(pending.body.data).toEqual([expect.objectContaining({ user: expect.objectContaining({ id: asker.id }), status: 'PENDING' })]);
    // A plain member can't see or decide.
    await api().get(`/workspaces/${workspaceId}/join-requests`).set(auth(asker.token)).expect(404);

    await api().post(`/workspaces/${workspaceId}/join-requests/${pending.body.data[0].id}/approve`).set(auth(owner.token)).expect(200);
    expect(await prisma.workspaceMember.count({ where: { workspaceId, userId: asker.id, deactivatedAt: null } })).toBe(1);
    await api().post(`/workspaces/${workspaceId}/join-requests/${pending.body.data[0].id}/deny`).set(auth(owner.token)).expect(400);
    const approvedNote = await prisma.notification.findFirst({ where: { userId: asker.id, actorId: owner.id } });
    expect(approvedNote?.payload).toMatchObject({ source: 'join_request', action: 'approved' });
  });

  it('a denied request shows as such, and can be re-opened', async () => {
    const u = await signup('denied');
    await api().post(`/workspaces/${workspaceId}/join`).set(auth(u.token)).expect(200);
    const req = await prisma.workspaceJoinRequest.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: u.id } } });
    await api().post(`/workspaces/${workspaceId}/join-requests/${req.id}/deny`).set(auth(owner.token)).expect(200);
    expect(await prisma.workspaceMember.count({ where: { workspaceId, userId: u.id } })).toBe(0);
    expect((await api().get('/me/joinable-workspaces').set(auth(u.token)).expect(200)).body.data[0].requestStatus).toBe('DENIED');
    await api().post(`/workspaces/${workspaceId}/join`).set(auth(u.token)).expect(200);
    expect((await prisma.workspaceJoinRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
  });
});
