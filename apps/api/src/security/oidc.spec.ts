import { createHmac, generateKeyPairSync, sign, type KeyObject } from 'crypto';
import { decodeJwt, parseDiscovery, pkceChallenge, verifyIdToken, type Jwk } from './oidc';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsaJwk = { ...(rsa.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'r1', use: 'sig', alg: 'RS256' };
const ecJwk = { ...(ec.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'e1' };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = 1_800_000_000;
const expected = { issuer: 'https://idp.example.com', clientId: 'client-1', nonce: 'n-123', nowSeconds: NOW };
const claims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://idp.example.com/',
  sub: 'user-1',
  aud: 'client-1',
  exp: NOW + 300,
  iat: NOW,
  nonce: 'n-123',
  email: 'ada@acme.com',
  ...over,
});

function jwt(payload: object, opts: { alg?: string; kid?: string; key?: KeyObject } = {}) {
  const alg = opts.alg ?? 'RS256';
  const input = `${b64({ alg, kid: opts.kid ?? 'r1', typ: 'JWT' })}.${b64(payload)}`;
  let sig: Buffer;
  if (alg === 'RS256') sig = sign('sha256', Buffer.from(input), opts.key ?? rsa.privateKey);
  else if (alg === 'ES256') sig = sign('sha256', Buffer.from(input), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' });
  else if (alg === 'HS256') sig = createHmac('sha256', 'client-secret').update(input).digest();
  else sig = Buffer.alloc(0);
  return `${input}.${sig.toString('base64url')}`;
}

describe('verifyIdToken', () => {
  it('accepts a valid RS256 token (issuer compared without trailing slash)', () => {
    const c = verifyIdToken(jwt(claims()), [rsaJwk], expected);
    expect(c.sub).toBe('user-1');
    expect(c.email).toBe('ada@acme.com');
  });

  it('accepts ES256 and multi-audience tokens with a matching azp', () => {
    expect(verifyIdToken(jwt(claims(), { alg: 'ES256', kid: 'e1' }), [ecJwk], expected).sub).toBe('user-1');
    const multi = claims({ aud: ['client-1', 'other'], azp: 'client-1' });
    expect(verifyIdToken(jwt(multi), [rsaJwk], expected).sub).toBe('user-1');
    expect(() => verifyIdToken(jwt(claims({ aud: ['client-1', 'other'] })), [rsaJwk], expected)).toThrow(/azp/);
  });

  it('rejects alg none, HMAC, and a signature from another key', () => {
    expect(() => verifyIdToken(jwt(claims(), { alg: 'none' }), [rsaJwk], expected)).toThrow(/algorithm/);
    expect(() => verifyIdToken(jwt(claims(), { alg: 'HS256' }), [rsaJwk], expected)).toThrow(/algorithm/);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => verifyIdToken(jwt(claims(), { key: other.privateKey }), [rsaJwk], expected)).toThrow(/signature/);
    expect(() => verifyIdToken(jwt(claims(), { kid: 'unknown' }), [rsaJwk], expected)).toThrow(/signing key/);
  });

  it('rejects a tampered payload', () => {
    const [h, , s] = jwt(claims()).split('.');
    const forged = `${h}.${b64(claims({ email: 'ceo@acme.com' }))}.${s}`;
    expect(() => verifyIdToken(forged, [rsaJwk], expected)).toThrow(/signature/);
  });

  it('checks issuer, audience, expiry, iat and nonce', () => {
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ iss: 'https://evil.example.com' }, /issuer/],
      [{ aud: 'someone-else' }, /audience/],
      [{ exp: NOW - 600 }, /expired/],
      [{ iat: NOW + 3600 }, /future/],
      [{ nonce: 'other' }, /nonce/],
      [{ nonce: undefined }, /nonce/],
      [{ sub: '' }, /subject/],
    ];
    for (const [over, re] of bad) expect(() => verifyIdToken(jwt(claims(over)), [rsaJwk], expected)).toThrow(re);
    // Within the clock-skew allowance it still passes.
    expect(verifyIdToken(jwt(claims({ exp: NOW - 60 })), [rsaJwk], expected).sub).toBe('user-1');
  });
});

describe('oidc helpers', () => {
  it('computes the RFC 7636 S256 challenge', () => {
    // RFC 7636 Appendix B.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('parses discovery documents and rejects incomplete ones', () => {
    const doc = {
      issuer: 'https://idp',
      authorization_endpoint: 'https://idp/auth',
      token_endpoint: 'https://idp/token',
      jwks_uri: 'https://idp/jwks',
    };
    expect(parseDiscovery(JSON.stringify(doc)).jwks_uri).toBe('https://idp/jwks');
    expect(() => parseDiscovery(JSON.stringify({ ...doc, token_endpoint: undefined }))).toThrow(/token_endpoint/);
    expect(() => decodeJwt('a.b')).toThrow(/Malformed/);
  });
});
