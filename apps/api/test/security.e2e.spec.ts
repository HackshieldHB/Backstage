import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TxtResolver } from '../src/security/domains.service';
import { DataGovernanceService } from '../src/security/data-governance.service';
import { base32Decode, totp } from '../src/auth/totp';

describe('enterprise security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const orgDomain = `acme-${run}.test`;
  const txtRecords = new Map<string, string[]>();

  interface Actor {
    id: string;
    token: string;
    email: string;
  }
  let owner: Actor; // workspace owner
  let admin: Actor; // workspace admin
  let member: Actor; // plain member
  let outsider: Actor;
  let workspaceId: string;
  let publicChannelId: string;
  let privateChannelId: string;

  const api = () => request(app.getHttpServer());
  const auth = (a: { token: string }) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  const signup = async (name: string, email = `sec-${name}-${run}@test.local`): Promise<Actor> => {
    const res = await api()
      .post('/auth/signup')
      .send({ email, password: 'password123!', displayName: `${name} sec` })
      .expect(201);
    return { id: res.body.data.user.id, token: res.body.data.accessToken, email };
  };

  /** Add and DNS-verify a domain for a workspace (via the fake TXT resolver). */
  const verifyDomain = async (wsId: string, who: Actor, domain: string) => {
    const added = await api().post(`/workspaces/${wsId}/domains`).set(auth(who)).send({ domain }).expect(201);
    txtRecords.set(added.body.data.txtRecordName, [added.body.data.txtRecordValue]);
    return api().post(`/domains/${added.body.data.id}/verify`).set(auth(who));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TxtResolver)
      .useValue({ resolve: async (name: string) => txtRecords.get(name) ?? [] })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    owner = await signup('owner');
    admin = await signup('admin');
    member = await signup('member');
    outsider = await signup('outsider');
    workspaceId = (await api().post('/workspaces').set(auth(owner)).send({ name: `Sec ${run}` }).expect(201)).body
      .data.id;
    for (const who of [admin, member]) {
      const invite = await api().post(`/workspaces/${workspaceId}/invites`).set(auth(owner)).send({}).expect(201);
      await api().post('/invites/accept').set(auth(who)).send({ token: invite.body.data.token }).expect(200);
    }
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: admin.id } },
      data: { role: 'ADMIN' },
    });
    publicChannelId = (
      await api().post(`/workspaces/${workspaceId}/channels`).set(auth(owner)).send({ name: `pub-${run}` }).expect(201)
    ).body.data.id;
    privateChannelId = (
      await api()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(owner))
        .send({ name: `priv-${run}`, isPrivate: true })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    const ws = await prisma.workspace.findMany({ where: { name: { contains: run } }, select: { id: true } });
    const wsIds = ws.map((w) => w.id);
    await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { contains: run } },
          { isBot: true, botWorkspaceId: { in: wsIds } },
        ],
      },
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------

  describe('personal API tokens', () => {
    let readToken: string;
    let readTokenId: string;
    let writeToken: string;

    it('creates tokens (shown once, only a prefix listed afterwards)', async () => {
      const r = await api().post('/me/api-tokens').set(auth(member)).send({ name: 'ci read' }).expect(201);
      expect(r.body.data.token).toMatch(/^bs_pat_[A-Za-z0-9_-]{43}$/);
      expect(r.body.data.scope).toBe('read');
      readToken = r.body.data.token;
      readTokenId = r.body.data.id;
      const w = await api()
        .post('/me/api-tokens')
        .set(auth(member))
        .send({ name: 'ci write', scope: 'write', expiresInDays: 30 })
        .expect(201);
      writeToken = w.body.data.token;
      expect(w.body.data.expiresAt).not.toBeNull();

      const list = await api().get('/me/api-tokens').set(auth(member)).expect(200);
      expect(list.body.data).toHaveLength(2);
      expect(JSON.stringify(list.body.data)).not.toContain(readToken);
      const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: readTokenId } });
      expect(row.tokenHash).not.toContain(readToken.slice(7));
    });

    it('authenticates as the user; read tokens can only read', async () => {
      const me = await api().get('/auth/me').set(auth({ token: readToken })).expect(200);
      expect(me.body.data.id).toBe(member.id);
      await api()
        .post(`/channels/${publicChannelId}/join`)
        .set(auth({ token: readToken }))
        .expect(403);
      await api()
        .post(`/channels/${publicChannelId}/join`)
        .set(auth({ token: writeToken }))
        .expect(200);
      await api()
        .post(`/channels/${publicChannelId}/messages`)
        .set(auth({ token: writeToken }))
        .send({ clientMsgId: randomUUID(), contentJson: doc('from a script'), contentText: 'from a script' })
        .expect(201);
    });

    it('never lets a token reach credential or security routes', async () => {
      for (const t of [readToken, writeToken]) {
        await api().get('/me/api-tokens').set(auth({ token: t })).expect(403);
        await api().post('/me/api-tokens').set(auth({ token: t })).send({ name: 'x', scope: 'write' }).expect(403);
        await api().post('/auth/2fa/setup').set(auth({ token: t })).expect(403);
        await api().get(`/workspaces/${workspaceId}/export`).set(auth({ token: t })).expect(403);
      }
    });

    it('rejects unknown, revoked and expired tokens', async () => {
      await api().get('/auth/me').set(auth({ token: `bs_pat_${'x'.repeat(43)}` })).expect(401);
      await api().delete(`/me/api-tokens/${readTokenId}`).set(auth(outsider)).expect(404);
      await api().delete(`/me/api-tokens/${readTokenId}`).set(auth(member)).expect(200);
      await api().get('/auth/me').set(auth({ token: readToken })).expect(401);

      await prisma.apiToken.updateMany({
        where: { userId: member.id, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await api().get('/auth/me').set(auth({ token: writeToken })).expect(401);
    });
  });

  // ---------------------------------------------------------------------------

  describe('bot accounts', () => {
    let botId: string;
    let botToken: string;

    it('only admins create bots; the bot is a workspace member with a token', async () => {
      await api().post(`/workspaces/${workspaceId}/bots`).set(auth(member)).send({ name: 'Nope' }).expect(403);
      await api().post(`/workspaces/${workspaceId}/bots`).set(auth(outsider)).send({ name: 'Nope' }).expect(404);
      const res = await api()
        .post(`/workspaces/${workspaceId}/bots`)
        .set(auth(admin))
        .send({ name: 'Deploy Bot' })
        .expect(201);
      botId = res.body.data.bot.id;
      botToken = res.body.data.token.token;
      expect(res.body.data.token.scope).toBe('write');

      const me = await api().get('/auth/me').set(auth({ token: botToken })).expect(200);
      expect(me.body.data.displayName).toBe('Deploy Bot');
      await api().post(`/channels/${publicChannelId}/join`).set(auth({ token: botToken })).expect(200);
      await api()
        .post(`/channels/${publicChannelId}/messages`)
        .set(auth({ token: botToken }))
        .send({ clientMsgId: randomUUID(), contentJson: doc('deployed v1.2'), contentText: 'deployed v1.2' })
        .expect(201);

      const bots = await api().get(`/workspaces/${workspaceId}/bots`).set(auth(admin)).expect(200);
      expect(bots.body.data.map((b: { id: string }) => b.id)).toContain(botId);
    });

    it('bots cannot sign in with a password or mint their own tokens', async () => {
      const bot = await prisma.user.findUniqueOrThrow({ where: { id: botId } });
      expect(bot.passwordHash).toBeNull();
      await api().post('/auth/login').send({ email: bot.email, password: 'password123!' }).expect(401);
      await api().post('/me/api-tokens').set(auth({ token: botToken })).send({ name: 'x' }).expect(403);
    });

    it('deleting a bot revokes its tokens and deactivates it; messages stay', async () => {
      await api().delete(`/bots/${botId}`).set(auth(member)).expect(403);
      await api().delete(`/bots/${botId}`).set(auth(admin)).expect(200);
      await api().get('/auth/me').set(auth({ token: botToken })).expect(401);
      const bots = await api().get(`/workspaces/${workspaceId}/bots`).set(auth(admin)).expect(200);
      expect(bots.body.data.map((b: { id: string }) => b.id)).not.toContain(botId);
      expect(await prisma.message.count({ where: { userId: botId } })).toBe(1);
      await api().delete(`/bots/${botId}`).set(auth(admin)).expect(404);
    });
  });

  // ---------------------------------------------------------------------------

  describe('two-factor authentication', () => {
    let tfa: Actor;
    let secret: string;
    let recoveryCodes: string[];
    const at = (offsetSteps = 0) => totp(secret, Date.now() + offsetSteps * 30_000);

    beforeAll(async () => {
      tfa = await signup('tfa');
    });

    it('enables only after confirming a code, and issues recovery codes', async () => {
      const status = await api().get('/auth/2fa').set(auth(tfa)).expect(200);
      expect(status.body.data).toEqual({ enabled: false, recoveryCodesLeft: 0 });
      const setup = await api().post('/auth/2fa/setup').set(auth(tfa)).expect(200);
      secret = setup.body.data.secret;
      expect(base32Decode(secret)).toHaveLength(20);
      expect(setup.body.data.otpauthUri).toContain(`secret=${secret}`);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: tfa.id } });
      expect(row.totpSecretEnc).not.toContain(secret);

      // Not active yet: login still issues a session directly.
      const pre = await api().post('/auth/login').send({ email: tfa.email, password: 'password123!' }).expect(200);
      expect(pre.body.data.accessToken).toBeTruthy();

      await api().post('/auth/2fa/enable').set(auth(tfa)).send({ code: '000000' }).expect(400);
      const enabled = await api().post('/auth/2fa/enable').set(auth(tfa)).send({ code: at() }).expect(200);
      recoveryCodes = enabled.body.data.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      expect(recoveryCodes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
      await api().post('/auth/2fa/setup').set(auth(tfa)).expect(400);
    });

    it('login becomes two-step; the mfa token is not a session', async () => {
      const step1 = await api().post('/auth/login').send({ email: tfa.email, password: 'password123!' }).expect(200);
      expect(step1.body.data).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
      expect(step1.body.data.accessToken).toBeUndefined();
      await api().get('/auth/me').set(auth({ token: step1.body.data.mfaToken })).expect(401);

      await api().post('/auth/login/2fa').send({ mfaToken: step1.body.data.mfaToken, code: '123456' }).expect(401);
      // Codes from the enable step are already spent; use the next window.
      const ok = await api()
        .post('/auth/login/2fa')
        .send({ mfaToken: step1.body.data.mfaToken, code: at(1) })
        .expect(200);
      expect(ok.body.data.accessToken).toBeTruthy();
      await api().get('/auth/me').set(auth({ token: ok.body.data.accessToken })).expect(200);

      // The challenge is spent, and the same TOTP code can't be replayed.
      await api().post('/auth/login/2fa').send({ mfaToken: step1.body.data.mfaToken, code: at(1) }).expect(401);
      const again = await api().post('/auth/login').send({ email: tfa.email, password: 'password123!' }).expect(200);
      await api().post('/auth/login/2fa').send({ mfaToken: again.body.data.mfaToken, code: at(1) }).expect(401);
    });

    it('accepts each recovery code once and locks a challenge after 5 bad tries', async () => {
      const step1 = await api().post('/auth/login').send({ email: tfa.email, password: 'password123!' }).expect(200);
      const code = recoveryCodes[0].toUpperCase().replace('-', ' ');
      await api().post('/auth/login/2fa').send({ mfaToken: step1.body.data.mfaToken, code }).expect(200);
      const step2 = await api().post('/auth/login').send({ email: tfa.email, password: 'password123!' }).expect(200);
      await api().post('/auth/login/2fa').send({ mfaToken: step2.body.data.mfaToken, code }).expect(401);
      for (let i = 0; i < 4; i++) {
        await api().post('/auth/login/2fa').send({ mfaToken: step2.body.data.mfaToken, code: '000000' }).expect(401);
      }
      // Sixth try: locked even with a valid recovery code.
      await api()
        .post('/auth/login/2fa')
        .send({ mfaToken: step2.body.data.mfaToken, code: recoveryCodes[1] })
        .expect(401);
      const status = await api().get('/auth/2fa').set(auth(tfa)).expect(200);
      expect(status.body.data).toEqual({ enabled: true, recoveryCodesLeft: 9 });
    });

    it('disabling needs a valid code', async () => {
      await api().post('/auth/2fa/disable').set(auth(tfa)).send({ code: '000000' }).expect(400);
      await api().post('/auth/2fa/disable').set(auth(tfa)).send({ code: recoveryCodes[2] }).expect(200);
      const login = await api().post('/auth/login').send({ email: tfa.email, password: 'password123!' }).expect(200);
      expect(login.body.data.accessToken).toBeTruthy();
      expect(await prisma.recoveryCode.count({ where: { userId: tfa.id } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------

  describe('retention and export', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
    const seed = (text: string, createdAt: Date, extra: { channelId?: string; parentId?: string } = {}) =>
      prisma.message.create({
        data: {
          workspaceId,
          channelId: extra.channelId ?? publicChannelId,
          parentId: extra.parentId,
          userId: owner.id,
          contentJson: doc(text),
          contentText: text,
          createdAt,
        },
      });

    it('only the owner changes retention', async () => {
      await api()
        .put(`/workspaces/${workspaceId}/retention`)
        .set(auth(admin))
        .send({ retentionDays: 30, legalHold: false })
        .expect(403);
      await api()
        .put(`/workspaces/${workspaceId}/retention`)
        .set(auth(owner))
        .send({ retentionDays: 3, legalHold: false })
        .expect(400);
      const res = await api()
        .put(`/workspaces/${workspaceId}/retention`)
        .set(auth(owner))
        .send({ retentionDays: 30, legalHold: true })
        .expect(200);
      expect(res.body.data).toEqual({ retentionDays: 30, legalHold: true });
      const read = await api().get(`/workspaces/${workspaceId}/retention`).set(auth(admin)).expect(200);
      expect(read.body.data.legalHold).toBe(true);
    });

    it('deletes old messages (keeping roots of live threads); legal hold suspends it', async () => {
      const old = await seed(`old-${run}`, daysAgo(40));
      const oldRoot = await seed(`old-root-${run}`, daysAgo(45));
      const liveReply = await seed(`new-reply-${run}`, daysAgo(1), { parentId: oldRoot.id });
      const deadRoot = await seed(`dead-root-${run}`, daysAgo(50));
      const deadReply = await seed(`dead-reply-${run}`, daysAgo(49), { parentId: deadRoot.id });
      const recent = await seed(`recent-${run}`, daysAgo(2));
      const governance = app.get(DataGovernanceService);
      const ids = [old.id, oldRoot.id, liveReply.id, deadRoot.id, deadReply.id, recent.id];
      const remaining = async () =>
        (await prisma.message.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((m) => m.id);

      await governance.sweep();
      expect(await remaining()).toHaveLength(6); // legal hold

      await prisma.workspace.update({ where: { id: workspaceId }, data: { legalHold: false } });
      await governance.sweep();
      expect((await remaining()).sort()).toEqual([oldRoot.id, liveReply.id, recent.id].sort());
    });

    it('exports public channels for admins; private channels and DMs only for the owner', async () => {
      await seed(`secret-${run}`, new Date(), { channelId: privateChannelId });
      await api().get(`/workspaces/${workspaceId}/export`).set(auth(member)).expect(403);
      const pub = await api().get(`/workspaces/${workspaceId}/export`).set(auth(admin)).expect(200);
      expect(pub.body.data.format).toBe('backstages-export/1');
      expect(pub.body.data.channels.map((c: { id: string }) => c.id)).toContain(publicChannelId);
      expect(JSON.stringify(pub.body.data)).not.toContain(`secret-${run}`);
      expect(pub.body.data.conversations).toEqual([]);

      await api().get(`/workspaces/${workspaceId}/export?scope=all`).set(auth(admin)).expect(403);
      const all = await api().get(`/workspaces/${workspaceId}/export?scope=all`).set(auth(owner)).expect(200);
      expect(JSON.stringify(all.body.data)).toContain(`secret-${run}`);
      const audit = await prisma.auditLog.count({ where: { workspaceId, action: 'workspace.export' } });
      expect(audit).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------

  describe('verified domains', () => {
    it('verifies via DNS TXT; one workspace per domain', async () => {
      await api().post(`/workspaces/${workspaceId}/domains`).set(auth(admin)).send({ domain: orgDomain }).expect(403);
      await api().post(`/workspaces/${workspaceId}/domains`).set(auth(owner)).send({ domain: 'not a domain' }).expect(400);
      const added = await api()
        .post(`/workspaces/${workspaceId}/domains`)
        .set(auth(owner))
        .send({ domain: orgDomain.toUpperCase() })
        .expect(201);
      expect(added.body.data.domain).toBe(orgDomain);
      expect(added.body.data.txtRecordName).toBe(`_backstages-challenge.${orgDomain}`);
      await api().post(`/domains/${added.body.data.id}/verify`).set(auth(owner)).expect(400); // no record yet
      txtRecords.set(added.body.data.txtRecordName, ['unrelated', added.body.data.txtRecordValue]);
      const ok = await api().post(`/domains/${added.body.data.id}/verify`).set(auth(owner)).expect(200);
      expect(ok.body.data.verified).toBe(true);

      // A second workspace can't claim it, even if it publishes its own record.
      const other = (await api().post('/workspaces').set(auth(outsider)).send({ name: `Other ${run}` }).expect(201))
        .body.data.id;
      const res = await verifyDomain(other, outsider, orgDomain);
      expect(res.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------

  describe('SCIM provisioning', () => {
    let scimToken: string;
    const scim = () => ({ Authorization: `Bearer ${scimToken}` });
    let provisionedId: string;

    it('only the owner issues the SCIM token', async () => {
      await api().post(`/workspaces/${workspaceId}/scim/token`).set(auth(admin)).expect(403);
      const res = await api().post(`/workspaces/${workspaceId}/scim/token`).set(auth(owner)).expect(200);
      scimToken = res.body.data.token;
      expect(scimToken).toMatch(/^bs_scim_/);
      expect(res.body.data.baseUrl).toMatch(/\/scim\/v2$/);
      await api().get('/scim/v2/Users').expect(401);
      await api().get('/scim/v2/Users').set({ Authorization: 'Bearer bs_scim_wrong' }).expect(401);
      // The SCIM token is not a user session either.
      await api().get('/auth/me').set(scim()).expect(401);
    });

    it('provisions users on verified domains only (application/scim+json)', async () => {
      const refused = await api()
        .post('/scim/v2/Users')
        .set(scim())
        .set('Content-Type', 'application/scim+json')
        .send(JSON.stringify({ userName: `x-${run}@gmail.com`, active: true }))
        .expect(403);
      expect(refused.body.schemas[0]).toContain('Error');

      const res = await api()
        .post('/scim/v2/Users')
        .set(scim())
        .set('Content-Type', 'application/scim+json')
        .send(
          JSON.stringify({
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
            userName: `Grace.Hopper@${orgDomain}`,
            name: { givenName: 'Grace', familyName: 'Hopper' },
            emails: [{ value: `grace.hopper@${orgDomain}`, primary: true }],
            active: true,
          }),
        )
        .expect(201);
      expect(res.headers['content-type']).toContain('application/scim+json');
      expect(res.body.userName).toBe(`grace.hopper@${orgDomain}`);
      expect(res.body.displayName).toBe('Grace Hopper');
      expect(res.body.active).toBe(true);
      provisionedId = res.body.id;
      const user = await prisma.user.findUniqueOrThrow({ where: { id: provisionedId } });
      expect(user.isProvisional).toBe(true);
      expect(user.passwordHash).toBeNull();

      await api()
        .post('/scim/v2/Users')
        .set(scim())
        .send({ userName: `grace.hopper@${orgDomain}` })
        .expect(409);
    });

    it('filters, patches active, and deactivates on DELETE', async () => {
      const list = await api()
        .get(`/scim/v2/Users?filter=${encodeURIComponent(`userName eq "grace.hopper@${orgDomain}"`)}`)
        .set(scim())
        .expect(200);
      expect(list.body.totalResults).toBe(1);
      expect(list.body.Resources[0].id).toBe(provisionedId);
      await api().get('/scim/v2/Users?filter=title%20co%20%22x%22').set(scim()).expect(400);

      await api()
        .patch(`/scim/v2/Users/${provisionedId}`)
        .set(scim())
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'Replace', value: { active: false, displayName: 'Grace B. Hopper' } }],
        })
        .expect(200);
      let m = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId: provisionedId } },
        include: { user: true },
      });
      expect(m.deactivatedAt).not.toBeNull();
      expect(m.user.displayName).toBe('Grace B. Hopper');

      await api()
        .patch(`/scim/v2/Users/${provisionedId}`)
        .set(scim())
        .send({ Operations: [{ op: 'replace', path: 'active', value: true }] })
        .expect(200);
      await api().delete(`/scim/v2/Users/${provisionedId}`).set(scim()).expect(204);
      m = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId: provisionedId } },
        include: { user: true },
      });
      expect(m.deactivatedAt).not.toBeNull();
    });

    it('cannot see other workspaces or deactivate the owner', async () => {
      await api().get(`/scim/v2/Users/${outsider.id}`).set(scim()).expect(404);
      const r = await api()
        .patch(`/scim/v2/Users/${owner.id}`)
        .set(scim())
        .send({ Operations: [{ op: 'replace', path: 'active', value: false }] })
        .expect(400);
      expect(r.body.scimType).toBe('mutability');
    });

    it('a provisioned account cannot be claimed by password signup', async () => {
      await api()
        .post('/auth/signup')
        .send({ email: `grace.hopper@${orgDomain}`, password: 'password123!', displayName: 'Imposter' })
        .expect(409);
    });

    it('rotating the token invalidates the old one; disabling turns SCIM off', async () => {
      const old = scimToken;
      scimToken = (await api().post(`/workspaces/${workspaceId}/scim/token`).set(auth(owner)).expect(200)).body.data
        .token;
      await api().get('/scim/v2/Users').set({ Authorization: `Bearer ${old}` }).expect(401);
      await api().get('/scim/v2/Users').set(scim()).expect(200);
      await api().delete(`/workspaces/${workspaceId}/scim`).set(auth(owner)).expect(200);
      await api().get('/scim/v2/Users').set(scim()).expect(401);
    });
  });

  // ---------------------------------------------------------------------------

  describe('OIDC single sign-on (mock IdP)', () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
    let idp: http.Server;
    let issuer: string;
    const clientId = `client-${run}`;
    const clientSecret = 'top-secret';
    /** What the IdP will put in the next ID token. */
    let identity: Record<string, unknown> = {};
    let lastAuthorize: URL;
    const codes = new Map<string, { nonce: string; challenge: string }>();
    let privateBefore: string | undefined;

    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const idToken = (claims: Record<string, unknown>) => {
      const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64(claims)}`;
      return `${input}.${sign('sha256', Buffer.from(input), keys.privateKey).toString('base64url')}`;
    };

    beforeAll(async () => {
      privateBefore = process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;
      process.env.OUTBOUND_HTTP_ALLOW_PRIVATE = '1'; // the mock IdP is on 127.0.0.1
      idp = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', issuer);
        const json = (status: number, body: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (url.pathname === '/.well-known/openid-configuration') {
          return json(200, {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
          });
        }
        if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
        if (url.pathname === '/token' && req.method === 'POST') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            const form = new URLSearchParams(body);
            const basic = Buffer.from(String(req.headers.authorization).replace('Basic ', ''), 'base64').toString();
            if (basic !== `${clientId}:${clientSecret}`) return json(401, { error: 'invalid_client' });
            const pending = codes.get(form.get('code') ?? '');
            if (!pending) return json(400, { error: 'invalid_grant' });
            codes.delete(form.get('code')!);
            const verifier = form.get('code_verifier') ?? '';
            if (createHash('sha256').update(verifier).digest('base64url') !== pending.challenge) {
              return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
            }
            const now = Math.floor(Date.now() / 1000);
            json(200, {
              access_token: 'at',
              token_type: 'Bearer',
              id_token: idToken({ iss: issuer, aud: clientId, iat: now, exp: now + 300, nonce: pending.nonce, ...identity }),
            });
          });
          return;
        }
        json(404, {});
      });
      await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
      issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      if (privateBefore === undefined) delete process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;
      else process.env.OUTBOUND_HTTP_ALLOW_PRIVATE = privateBefore;
      await new Promise((r) => idp.close(r));
    });

    /** Run the browser side of the flow: start → (IdP issues a code) → callback. */
    const signIn = async (claims: Record<string, unknown>, opts: { tamperNonce?: boolean } = {}) => {
      identity = claims;
      const start = await api().get(`/auth/sso/start?workspaceId=${workspaceId}`).expect(302);
      lastAuthorize = new URL(start.headers.location);
      const code = randomUUID();
      codes.set(code, {
        nonce: opts.tamperNonce ? 'wrong' : lastAuthorize.searchParams.get('nonce')!,
        challenge: lastAuthorize.searchParams.get('code_challenge')!,
      });
      const state = lastAuthorize.searchParams.get('state')!;
      const cb = await api().get(`/auth/sso/callback?code=${code}&state=${state}`).expect(302);
      return { location: String(cb.headers.location), state, code };
    };
    const fragment = (location: string) => new URLSearchParams(location.split('#')[1] ?? '');

    it('configures the connection (owner only) from the discovery document', async () => {
      await api()
        .put(`/workspaces/${workspaceId}/sso`)
        .set(auth(admin))
        .send({ issuer, clientId, clientSecret })
        .expect(403);
      await api().put(`/workspaces/${workspaceId}/sso`).set(auth(owner)).send({ issuer, clientId }).expect(400);
      const res = await api()
        .put(`/workspaces/${workspaceId}/sso`)
        .set(auth(owner))
        .send({ issuer: `${issuer}/`, clientId, clientSecret })
        .expect(200);
      expect(res.body.data).toMatchObject({ issuer, clientId, enforced: false });
      expect(res.body.data.redirectUri).toMatch(/\/auth\/sso\/callback$/);
      const row = await prisma.ssoConnection.findUniqueOrThrow({ where: { workspaceId } });
      expect(row.clientSecretEnc).not.toContain(clientSecret);

      const d = await api().get(`/auth/sso/discover?email=someone@${orgDomain}`).expect(200);
      expect(d.body.data).toEqual({ sso: true, enforced: false, workspaceId });
      const none = await api().get(`/auth/sso/discover?email=someone@unverified-${run}.test`).expect(200);
      expect(none.body.data.sso).toBe(false);
    });

    it('signs in with PKCE + nonce, creating the account and membership', async () => {
      const { location } = await signIn({ sub: 'idp-ada', email: `ada@${orgDomain}`, name: 'Ada Lovelace' });
      expect(lastAuthorize.searchParams.get('code_challenge_method')).toBe('S256');
      expect(lastAuthorize.searchParams.get('client_id')).toBe(clientId);
      expect(location).toContain('/sso#');
      const access = fragment(location).get('access')!;
      const me = await api().get('/auth/me').set(auth({ token: access })).expect(200);
      expect(me.body.data.email).toBe(`ada@${orgDomain}`);
      expect(me.body.data.displayName).toBe('Ada Lovelace');
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: me.body.data.id } },
      });
      expect(member?.role).toBe('MEMBER');

      // Second sign-in matches by (issuer, subject) even if the email claim changes.
      const again = await signIn({ sub: 'idp-ada', email: `ada.l@${orgDomain}` });
      const me2 = await api().get('/auth/me').set(auth({ token: fragment(again.location).get('access')! })).expect(200);
      expect(me2.body.data.id).toBe(me.body.data.id);
    });

    it('activates a SCIM-provisioned account', async () => {
      const grace = await prisma.user.findUniqueOrThrow({ where: { email: `grace.hopper@${orgDomain}` } });
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: grace.id } },
        data: { deactivatedAt: null },
      });
      const { location } = await signIn({ sub: 'idp-grace', email: `grace.hopper@${orgDomain}` });
      expect(location).toContain('/sso#');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: grace.id } })).isProvisional).toBe(false);
    });

    it('refuses unverified domains, unverified emails, bad nonces and replayed state', async () => {
      expect((await signIn({ sub: 'x1', email: `eve@evil-${run}.test` })).location).toContain('error=sso-domain');
      expect((await signIn({ sub: 'x2', email: `eve@${orgDomain}`, email_verified: false })).location).toContain(
        'error=sso-unverified',
      );
      expect((await signIn({ sub: 'x3', email: `eve@${orgDomain}` }, { tamperNonce: true })).location).toContain(
        'error=sso-token',
      );
      expect(await prisma.user.count({ where: { email: `eve@${orgDomain}` } })).toBe(0);

      const ok = await signIn({ sub: 'idp-ada', email: `ada@${orgDomain}` });
      expect(ok.location).toContain('/sso#');
      const replay = await api().get(`/auth/sso/callback?code=${ok.code}&state=${ok.state}`).expect(302);
      expect(replay.headers.location).toContain('error=sso-expired');
      const denied = await api().get('/auth/sso/callback?error=access_denied&state=x').expect(302);
      expect(denied.headers.location).toContain('error=sso-denied');
    });

    it('enforced SSO blocks password login on the domain, except for the owner', async () => {
      const pw = await signup('pw', `pw-user@${orgDomain}`);
      await api()
        .put(`/workspaces/${workspaceId}/sso`)
        .set(auth(owner))
        .send({ issuer, clientId, enforced: true })
        .expect(200);
      await api().post('/auth/login').send({ email: pw.email, password: 'password123!' }).expect(403);
      await api()
        .post('/auth/signup')
        .send({ email: `new@${orgDomain}`, password: 'password123!', displayName: 'New' })
        .expect(403);
      // Owner keeps break-glass password access even on the domain.
      await prisma.user.update({ where: { id: owner.id }, data: { email: `owner-${run}@${orgDomain}` } });
      await api().post('/auth/login').send({ email: `owner-${run}@${orgDomain}`, password: 'password123!' }).expect(200);
      // Other domains are unaffected.
      await api().post('/auth/login').send({ email: member.email, password: 'password123!' }).expect(200);
    });
  });
});
