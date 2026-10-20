import { createHash, createHmac } from 'crypto';
import {
  livekitConfig,
  parseSfuRoomName,
  sfuRoomName,
  signLivekitToken,
  userIdOfIdentity,
  verifyLivekitWebhook,
} from './livekit-api';
import { messageIdFor, parseEgressInfo } from './sfu-recording.service';

const cfg = { apiKey: 'devkey', apiSecret: 'a-very-long-dev-secret-for-tests-only' };
const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

/** A webhook Authorization header the way LiveKit builds it. */
function webhookAuth(body: string, opts: { secret?: string; key?: string; sha?: string; exp?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    iss: opts.key ?? cfg.apiKey,
    nbf: now - 1,
    exp: opts.exp ?? now + 300,
    sha256: opts.sha ?? createHash('sha256').update(body).digest('base64'),
  };
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${data}.${createHmac('sha256', opts.secret ?? cfg.apiSecret).update(data).digest('base64url')}`;
}

describe('livekit-api', () => {
  it('signs a join token with the video grant LiveKit expects', () => {
    const jwt = signLivekitToken(cfg, {
      identity: 'u1~abc',
      name: 'Ann',
      ttlSeconds: 600,
      video: { room: 'channel:c1', roomJoin: true, canPublish: true, canSubscribe: true },
    });
    const [h, p, s] = jwt.split('.');
    expect(createHmac('sha256', cfg.apiSecret).update(`${h}.${p}`).digest('base64url')).toBe(s);
    const claims = decode(jwt);
    expect(claims).toMatchObject({ iss: 'devkey', sub: 'u1~abc', name: 'Ann', video: { room: 'channel:c1', roomJoin: true } });
    expect(claims.exp - claims.nbf).toBe(605);
  });

  it('names rooms per huddle and per breakout, and parses them back', () => {
    expect(sfuRoomName('channel:c1', null)).toBe('channel:c1');
    expect(sfuRoomName('conversation:d1', 'b-2')).toBe('conversation:d1~br~b-2');
    expect(parseSfuRoomName('conversation:d1~br~b-2')).toEqual({ key: 'conversation:d1', breakoutId: 'b-2' });
    expect(parseSfuRoomName('channel:c1')).toEqual({ key: 'channel:c1', breakoutId: null });
    expect(parseSfuRoomName('somebody-elses-room')).toBeNull();
    expect(userIdOfIdentity('u1~nonce')).toBe('u1');
    expect(userIdOfIdentity('u1')).toBe('u1');
  });

  it('derives the HTTP API url from the websocket url unless overridden', () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { LIVEKIT_URL: 'wss://sfu.example.com/', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' });
      delete process.env.LIVEKIT_API_URL;
      expect(livekitConfig()?.apiUrl).toBe('https://sfu.example.com');
      process.env.LIVEKIT_API_URL = 'http://livekit:7880';
      expect(livekitConfig()?.apiUrl).toBe('http://livekit:7880');
      delete process.env.LIVEKIT_API_SECRET;
      expect(livekitConfig()).toBeNull();
    } finally {
      process.env = saved;
    }
  });

  describe('verifyLivekitWebhook', () => {
    const body = JSON.stringify({ event: 'room_started', room: { name: 'channel:c1' } });
    it('accepts a correctly signed body', () => {
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), webhookAuth(body))).toBe(true);
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), `Bearer ${webhookAuth(body)}`)).toBe(true);
    });
    it('rejects tampering, wrong keys, expiry and missing headers', () => {
      expect(verifyLivekitWebhook(cfg, Buffer.from(body + ' '), webhookAuth(body))).toBe(false);
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), webhookAuth(body, { secret: 'other' }))).toBe(false);
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), webhookAuth(body, { key: 'other' }))).toBe(false);
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), webhookAuth(body, { exp: Math.floor(Date.now() / 1000) - 120 }))).toBe(false);
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), webhookAuth(body, { sha: '' }))).toBe(false);
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), undefined)).toBe(false);
      expect(verifyLivekitWebhook(cfg, Buffer.from(body), 'not-a-jwt')).toBe(false);
    });
  });

  it('normalises egress info in either JSON casing', () => {
    expect(
      parseEgressInfo({
        egressId: 'EG_1',
        status: 'EGRESS_COMPLETE',
        fileResults: [{ filename: 'x.mp4', size: '2048', duration: '65000000000' }],
      }),
    ).toEqual({ egressId: 'EG_1', status: 'EGRESS_COMPLETE', error: undefined, size: 2048, durationMs: 65_000 });
    expect(parseEgressInfo({ egress_id: 'EG_2', status: 4, error: 'boom' })).toEqual({
      egressId: 'EG_2',
      status: '4',
      error: 'boom',
      size: undefined,
      durationMs: undefined,
    });
    expect(parseEgressInfo({ status: 'EGRESS_COMPLETE' })).toBeNull();
  });

  it('gives each recording one stable, UUID-shaped message id', () => {
    expect(messageIdFor('r1')).toBe(messageIdFor('r1'));
    expect(messageIdFor('r1')).not.toBe(messageIdFor('r2'));
    expect(messageIdFor('r1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
