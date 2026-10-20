import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService, type OutgoingEmail } from '../src/email/email.service';
import { MissedActivityService } from '../src/digest/missed-activity.service';
import { RedisClient } from '../src/redis/redis.module';

/** Emails about mentions/DMs you missed while away. */
describe('missed-activity emails (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let missed: MissedActivityService;
  let redis: RedisClient;
  const outbox: OutgoingEmail[] = [];
  let failNext = false;
  const run = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  let author: { id: string; token: string };
  let channelId: string;
  let messageId: string;

  const signup = async (name: string, verified = true) => {
    const res = await api()
      .post('/auth/signup')
      .send({ email: `miss-${name}-${run}@test.local`, password: 'password123!', displayName: `${name} miss` })
      .expect(201);
    if (verified) await prisma.user.update({ where: { id: res.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
    return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string, email: `miss-${name}-${run}@test.local` };
  };
  /** A mention notification for `userId`, `minutesAgo` old. */
  const mention = (userId: string, minutesAgo: number, type: 'MENTION' | 'REACTION' = 'MENTION') =>
    prisma.notification.create({
      data: {
        userId,
        type,
        actorId: author.id,
        channelId,
        messageId,
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });
  // Sign-up also sends a verification email; only count missed-activity mail.
  const mailsTo = (email: string) =>
    outbox.filter((m) => m.to === email && m.subject !== 'Confirm your email for Backstages');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        send: async (m: OutgoingEmail) => {
          if (failNext) {
            failNext = false;
            throw new Error('smtp down');
          }
          outbox.push(m);
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    missed = app.get(MissedActivityService);
    redis = app.get(RedisClient);

    author = await signup('author');
    const ws = (await api().post('/workspaces').set(auth(author.token)).send({ name: `Miss ${run}` }).expect(201)).body.data.id;
    channelId = (await api().post(`/workspaces/${ws}/channels`).set(auth(author.token)).send({ name: `miss-${run}` }).expect(201)).body.data.id;
    messageId = (
      await api()
        .post(`/channels/${channelId}/messages`)
        .set(auth(author.token))
        .send({
          clientMsgId: randomUUID(),
          contentJson: doc('Can you review the launch plan before Friday?'),
          contentText: 'Can you review the launch plan before Friday?',
        })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  /** A verified teammate who is a member of the channel. */
  const teammate = async (name: string, verified = true) => {
    const u = await signup(name, verified);
    await prisma.channelMember.create({ data: { channelId, userId: u.id } });
    return u;
  };

  it('emails a mention that has been unread for a while, once per hour', async () => {
    const u = await teammate('basic');
    await mention(u.id, 20);
    expect(await missed.sendFor(u.id)).toBe(true);
    const [mail] = mailsTo(u.email);
    expect(mail.subject).toBe('author miss mentioned you in #miss-' + run);
    expect(mail.body).toContain('“Can you review the launch plan before Friday?”');
    expect(mail.body).toMatch(/\/unsubscribe#token=/);

    // Another mention right after: rate limited.
    await mention(u.id, 16);
    expect(await missed.sendFor(u.id)).toBe(false);
    expect(mailsTo(u.email)).toHaveLength(1);

    // An hour later only the new, unread one is included.
    await prisma.user.update({ where: { id: u.id }, data: { lastMissedEmailAt: new Date(Date.now() - 61 * 60_000) } });
    await prisma.notification.updateMany({
      where: { userId: u.id, createdAt: { lt: new Date(Date.now() - 18 * 60_000) } },
      data: { readAt: new Date() },
    });
    expect(await missed.sendFor(u.id)).toBe(true);
    expect(mailsTo(u.email)).toHaveLength(2);
  });

  it('waits until things have been unread for 15 minutes, and ignores reactions', async () => {
    const u = await teammate('fresh');
    await mention(u.id, 5);
    await mention(u.id, 30, 'REACTION');
    expect(await missed.sendFor(u.id)).toBe(false);
  });

  it('never emails an unverified address, someone online, or someone out of office', async () => {
    const unverified = await teammate('unverified', false);
    await mention(unverified.id, 20);
    expect(await missed.sendFor(unverified.id)).toBe(false);

    const online = await teammate('online');
    await mention(online.id, 20);
    await redis.set(`presence:online:${online.id}`, '1', 'EX', 60);
    expect(await missed.sendFor(online.id)).toBe(false);
    await redis.del(`presence:online:${online.id}`);

    const away = await teammate('ooo');
    await mention(away.id, 20);
    const ws = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.workspaceId, userId: away.id, oooUntil: new Date(Date.now() + 3600_000) } });
    expect(await missed.sendFor(away.id)).toBe(false);
  });

  it('does not quote a message from a channel you have left', async () => {
    const u = await teammate('leaver');
    await mention(u.id, 20);
    await prisma.channelMember.deleteMany({ where: { channelId, userId: u.id } });
    expect(await missed.sendFor(u.id)).toBe(true);
    const [mail] = mailsTo(u.email);
    expect(mail.body).not.toContain('launch plan');
    expect(mail.body).not.toContain(`#miss-${run}`);
  });

  it('gives the slot back when sending fails', async () => {
    const u = await teammate('retry');
    await mention(u.id, 20);
    failNext = true;
    await expect(missed.sendFor(u.id)).rejects.toThrow('smtp down');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastMissedEmailAt).toBeNull();
    expect(await missed.sendFor(u.id)).toBe(true);
  });

  it('can be turned off in settings or from the email link', async () => {
    const u = await teammate('optout');
    expect((await api().get('/me/email-preferences').set(auth(u.token)).expect(200)).body.data).toEqual({ missedActivity: true });
    await api().put('/me/email-preferences').set(auth(u.token)).send({ missedActivity: false }).expect(200);
    await mention(u.id, 20);
    expect(await missed.sendFor(u.id)).toBe(false);

    await api().put('/me/email-preferences').set(auth(u.token)).send({ missedActivity: true }).expect(200);
    const token = missed.unsubscribeToken(u.id);
    await api().post('/email/unsubscribe').send({ token: `${token}x` }).expect(401);
    await api().post('/email/unsubscribe').send({ token }).expect(200);
    expect((await api().get('/me/email-preferences').set(auth(u.token)).expect(200)).body.data).toEqual({ missedActivity: false });
  });

  it('the sweep finds people with something to read', async () => {
    const u = await teammate('sweep');
    await mention(u.id, 20);
    const before = mailsTo(u.email).length;
    await missed.runDue();
    expect(mailsTo(u.email).length).toBe(before + 1);
  });
});
