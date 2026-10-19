import { createHmac } from 'node:crypto';
import { IceService, coturnCredentials } from './ice.service';

const KEYS = [
  'CLOUDFLARE_TURN_KEY_ID',
  'CLOUDFLARE_TURN_API_TOKEN',
  'TURN_URLS',
  'TURN_SECRET',
  'TURN_USERNAME',
  'TURN_CREDENTIAL',
  'TURN_TTL_SECONDS',
  'STUN_URLS',
];

describe('IceService', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
  });

  it('falls back to the public relay when nothing is configured', async () => {
    const cfg = await new IceService().forUser('u1');
    expect(cfg.relay).toBe('public');
    expect(cfg.iceServers[0].urls).toEqual(['stun:stun.l.google.com:19302']);
    expect(cfg.iceServers[1].urls[0]).toContain('openrelay.metered.ca');
  });

  it('mints coturn time-limited credentials from the shared secret', async () => {
    process.env.TURN_URLS = 'turn:turn.example.com:3478,turns:turn.example.com:5349';
    process.env.TURN_SECRET = 's3cret';
    process.env.TURN_TTL_SECONDS = '3600';
    const now = Date.UTC(2026, 9, 19, 0, 0, 0);
    const cfg = await new IceService().forUser('user-42', now);
    expect(cfg).toMatchObject({ relay: 'coturn', ttlSeconds: 3600 });
    const turn = cfg.iceServers[1];
    expect(turn.urls).toEqual(['turn:turn.example.com:3478', 'turns:turn.example.com:5349']);
    expect(turn.username).toBe(`${now / 1000 + 3600}:user-42`);
    expect(turn.credential).toBe(createHmac('sha1', 's3cret').update(turn.username!).digest('base64'));
  });

  it('clamps a too-short TTL to the default', async () => {
    process.env.TURN_URLS = 'turn:t:3478';
    process.env.TURN_SECRET = 'x';
    process.env.TURN_TTL_SECONDS = '5';
    expect((await new IceService().forUser('u')).ttlSeconds).toBe(12 * 60 * 60);
  });

  it('serves static credentials from the server env', async () => {
    process.env.TURN_URLS = 'turn:t:3478';
    process.env.TURN_USERNAME = 'bob';
    process.env.TURN_CREDENTIAL = 'pw';
    process.env.STUN_URLS = 'stun:a:1,stun:b:2';
    const cfg = await new IceService().forUser('u');
    expect(cfg.relay).toBe('static');
    expect(cfg.iceServers).toEqual([
      { urls: ['stun:a:1', 'stun:b:2'] },
      { urls: ['turn:t:3478'], username: 'bob', credential: 'pw' },
    ]);
  });

  it('uses Cloudflare TURN and drops port-53 urls', async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'tok';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            {
              urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
              username: 'cfu',
              credential: 'cfp',
            },
          ],
        }),
        { status: 201 },
      ),
    );
    const cfg = await new IceService().forUser('u');
    expect(fetchMock.mock.calls[0][0]).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers');
    expect(cfg.relay).toBe('cloudflare');
    expect(cfg.iceServers[1]).toEqual({
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'cfu',
      credential: 'cfp',
    });
  });

  it('falls back when Cloudflare fails', async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'tok';
    process.env.TURN_URLS = 'turn:t:3478';
    process.env.TURN_SECRET = 'x';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    expect((await new IceService().forUser('u')).relay).toBe('coturn');
  });

  it('coturnCredentials username expires ttl seconds from now', () => {
    const c = coturnCredentials(['turn:x'], 'k', 'me', 60, 1_000_000);
    expect(c.username).toBe('1060:me');
  });
});
