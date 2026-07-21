import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Rate limiting (enabled only for this suite via env flip — the guard reads
 * the flag per request, other suites run with limits disabled).
 */
describe('rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token: string;
  let channelId: string;

  const http = () => request(app.getHttpServer());

  /**
   * RateLimitGuard uses a FIXED window (`floor(now / windowMs)`), so a burst
   * that straddles a bucket boundary sees the counter reset mid-way and every
   * request succeeds. Under full-suite load the sends are slow enough for that
   * to happen, so wait out the tail of the current window when there isn't
   * comfortably enough of it left for the burst.
   */
  const awaitFreshWindow = async (windowSeconds: number, needMs = 8000) => {
    const windowMs = windowSeconds * 1000;
    const remaining = windowMs - (Date.now() % windowMs);
    if (remaining < needMs) await new Promise((r) => setTimeout(r, remaining + 50));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const user = await http()
      .post('/auth/signup')
      .send({ email: `rl-user-${run}@test.local`, password: 'password123!', displayName: 'RL User' })
      .expect(201);
    token = user.body.data.accessToken;

    const ws = await http()
      .post('/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `RL ${run}` })
      .expect(201);
    const channels = await http()
      .get(`/workspaces/${ws.body.data.id}/channels`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    channelId = channels.body.data[0].id;

    process.env.DISABLE_RATE_LIMIT = '0';
  });

  afterAll(async () => {
    process.env.DISABLE_RATE_LIMIT = '1';
    await prisma.workspace.deleteMany({ where: { name: `RL ${run}` } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  it('throttles login attempts to 10/minute per caller', async () => {
    let tooMany = 0;
    for (let i = 0; i < 12; i++) {
      const res = await http()
        .post('/auth/login')
        .send({ email: `rl-user-${run}@test.local`, password: 'wrong-password' });
      if (res.status === 429) tooMany++;
    }
    expect(tooMany).toBeGreaterThanOrEqual(2);
  });

  it('throttles message sends to 10 per 10 seconds per user', async () => {
    await awaitFreshWindow(10);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await http()
        .post(`/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientMsgId: randomUUID(),
          contentJson: { type: 'doc', content: [] },
          contentText: `burst ${i}`,
        });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);

    const throttled = await http()
      .post(`/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientMsgId: randomUUID(),
        contentJson: { type: 'doc', content: [] },
        contentText: 'still throttled',
      });
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.message).toMatch(/rate limit/i);
  });

  it('reads are unaffected by the send limit', async () => {
    await http().get(`/channels/${channelId}/messages`).set('Authorization', `Bearer ${token}`).expect(200);
  });
});
