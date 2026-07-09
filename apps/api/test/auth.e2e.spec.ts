import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { EmailService, OutgoingEmail } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';

class CaptureEmailService extends EmailService {
  public sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }
}

describe('auth lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const emails = new CaptureEmailService();
  const email = `auth-${randomUUID().slice(0, 8)}@test.local`;
  const password = 'correct horse battery';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emails)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  let userId: string;
  let accessToken: string;
  let refreshToken: string;

  it('rejects protected routes without a token', async () => {
    const res = await http().get('/auth/me').expect(401);
    expect(res.body.error.message).toMatch(/token/i);
    expect(res.body.data).toBeNull();
  });

  it('signs up and returns user + tokens in the envelope', async () => {
    const res = await http()
      .post('/auth/signup')
      .send({ email, password, displayName: 'Auth Tester' })
      .expect(201);
    expect(res.body.error).toBeNull();
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    userId = res.body.data.user.id;
    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
  });

  it('rejects duplicate signup', async () => {
    await http()
      .post('/auth/signup')
      .send({ email, password, displayName: 'Impostor' })
      .expect(409);
  });

  it('validates bodies with the shared Zod schema', async () => {
    const res = await http()
      .post('/auth/signup')
      .send({ email: 'not-an-email', password: 'x', displayName: '' })
      .expect(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(2);
  });

  it('CurrentUser resolves JWT sub to user.id — /auth/me returns the signup id', async () => {
    const res = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.data.id).toBe(userId);
    expect(res.body.data.email).toBe(email);
    // Raw JWT payload must never leak through: no `sub` on the response shape.
    expect(res.body.data.sub).toBeUndefined();
  });

  it('stores refresh tokens only as SHA-256 hashes', async () => {
    const rows = await prisma.refreshToken.findMany({ where: { userId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tokenHash).not.toBe(refreshToken);
      expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await http().post('/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    const res = await http().post('/auth/login').send({ email, password }).expect(200);
    expect(res.body.data.user.id).toBe(userId);
  });

  let rotatedToken: string;

  it('rotates the refresh token: new token works, old one is revoked', async () => {
    const res = await http().post('/auth/refresh').send({ refreshToken }).expect(200);
    rotatedToken = res.body.data.refreshToken;
    expect(rotatedToken).not.toBe(refreshToken);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('detects reuse of the rotated-out token and revokes the whole family', async () => {
    // Presenting the old (already rotated) token is treated as theft...
    const res = await http().post('/auth/refresh').send({ refreshToken }).expect(401);
    expect(res.body.error.message).toMatch(/reuse/i);
    // ...which must also kill the newer token from the same family.
    await http().post('/auth/refresh').send({ refreshToken: rotatedToken }).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const login = await http().post('/auth/login').send({ email, password }).expect(200);
    const rt = login.body.data.refreshToken;
    await http().post('/auth/logout').send({ refreshToken: rt }).expect(200);
    await http().post('/auth/refresh').send({ refreshToken: rt }).expect(401);
  });

  it('forgot-password responds identically for unknown emails and sends a token for known ones', async () => {
    const before = emails.sent.length;
    await http().post('/auth/forgot-password').send({ email: 'nobody@test.local' }).expect(200);
    expect(emails.sent.length).toBe(before); // no email for unknown address

    await http().post('/auth/forgot-password').send({ email }).expect(200);
    expect(emails.sent.length).toBe(before + 1);
    expect(emails.sent.at(-1)!.to).toBe(email);
  });

  it('resets the password with the emailed token, revoking existing sessions', async () => {
    const login = await http().post('/auth/login').send({ email, password }).expect(200);
    const oldRefresh = login.body.data.refreshToken;

    const tokenMatch = /: (\S+)$/.exec(emails.sent.at(-1)!.body);
    expect(tokenMatch).toBeTruthy();
    const resetToken = tokenMatch![1];

    const newPassword = 'brand new passphrase 9';
    await http().post('/auth/reset-password').send({ token: resetToken, password: newPassword }).expect(200);

    // Token is single-use.
    await http().post('/auth/reset-password').send({ token: resetToken, password: 'again again 1' }).expect(401);
    // Old password dead, old sessions dead, new password works.
    await http().post('/auth/login').send({ email, password }).expect(401);
    await http().post('/auth/refresh').send({ refreshToken: oldRefresh }).expect(401);
    await http().post('/auth/login').send({ email, password: newPassword }).expect(200);
  });

  it('reset tokens live in their own table, not the refresh token table', async () => {
    const resetRows = await prisma.passwordResetToken.findMany({ where: { userId } });
    expect(resetRows.length).toBeGreaterThan(0);
    // A reset token hash must never be usable as a refresh token.
    const overlap = await prisma.refreshToken.findMany({
      where: { tokenHash: { in: resetRows.map((r) => r.tokenHash) } },
    });
    expect(overlap).toHaveLength(0);
  });
});
