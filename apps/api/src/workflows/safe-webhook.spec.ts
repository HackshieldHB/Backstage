import * as http from 'http';
import type { AddressInfo } from 'net';
import {
  isBlockedAddress,
  postWebhook,
  safeLookup,
  signBody,
  validateWebhookUrl,
} from './safe-webhook';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe', // mapped 169.254.169.254
    '64:ff9b::7f00:1',
    'not-an-ip',
  ])('blocks %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (addr) => {
      expect(isBlockedAddress(addr)).toBe(false);
    },
  );
});

describe('validateWebhookUrl', () => {
  const prev = process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
  beforeEach(() => delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE);
  afterAll(() => {
    if (prev === undefined) delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
    else process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE = prev;
  });

  it('accepts public https URLs', () => {
    expect(validateWebhookUrl('https://hooks.example.com/abc?x=1')).toBeNull();
  });

  it('rejects non-https, credentials, localhost and private IP literals (incl. obfuscated forms)', () => {
    expect(validateWebhookUrl('http://hooks.example.com')).toMatch(/https/);
    expect(validateWebhookUrl('ftp://example.com')).toMatch(/https/);
    expect(validateWebhookUrl('https://user:pw@example.com')).toMatch(/credentials/);
    expect(validateWebhookUrl('https://localhost/x')).toMatch(/public/);
    expect(validateWebhookUrl('https://api.localhost/x')).toMatch(/public/);
    expect(validateWebhookUrl('https://127.0.0.1/x')).toMatch(/public/);
    expect(validateWebhookUrl('https://2130706433/x')).toMatch(/public/); // decimal 127.0.0.1
    expect(validateWebhookUrl('https://0x7f.1/x')).toMatch(/public/);
    expect(validateWebhookUrl('https://[::1]/x')).toMatch(/public/);
    expect(validateWebhookUrl('https://169.254.169.254/latest')).toMatch(/public/);
    expect(validateWebhookUrl('not a url')).toMatch(/full URL/);
  });
});

describe('safeLookup', () => {
  const prev = process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
  beforeEach(() => delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE);
  afterAll(() => {
    if (prev === undefined) delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
    else process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE = prev;
  });

  it('refuses a hostname that resolves to loopback', (done) => {
    safeLookup('localhost', {}, (err) => {
      expect(err?.message).toMatch(/non-public/);
      done();
    });
  });
});

describe('postWebhook', () => {
  let server: http.Server;
  let received: { headers: http.IncomingHttpHeaders; body: string } | null = null;
  let port = 0;
  const prev = process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received = { headers: req.headers, body };
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: 'http://169.254.169.254/' });
          res.end();
        } else {
          res.writeHead(204);
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
    else process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE = prev;
    await new Promise((r) => server.close(r));
  });

  it('refuses a local target in normal (secure) mode without sending anything', async () => {
    delete process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE;
    received = null;
    await expect(postWebhook(`http://127.0.0.1:${port}/hook`, { a: 1 }, 's')).rejects.toThrow();
    expect(received).toBeNull();
  });

  it('posts signed JSON (insecure dev mode) and does not follow redirects', async () => {
    process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE = '1';
    const status = await postWebhook(`http://127.0.0.1:${port}/hook`, { hello: 'world' }, 'secret');
    expect(status).toBe(204);
    expect(JSON.parse(received!.body)).toEqual({ hello: 'world' });
    const ts = String(received!.headers['x-backstages-timestamp']);
    expect(received!.headers['x-backstages-signature']).toBe(
      signBody('secret', ts, received!.body),
    );

    expect(await postWebhook(`http://127.0.0.1:${port}/redirect`, {}, 'secret')).toBe(302);
  });
});
