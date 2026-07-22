import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Correlation is only worth anything if the id a user can see is the same one
 * the server logged, so these assert the id travels end to end.
 */
describe('request correlation (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a request id header on a successful response', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives every request a distinct id', async () => {
    const a = await http().get('/health').expect(200);
    const b = await http().get('/health').expect(200);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('honours an inbound request id so it survives a proxy', async () => {
    const res = await http()
      .get('/health')
      .set('x-request-id', 'upstream-id-123')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('upstream-id-123');
  });

  it('puts the same id in the error envelope the caller sees', async () => {
    const res = await http().get('/workspaces/does-not-exist').expect(401);
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });
});
