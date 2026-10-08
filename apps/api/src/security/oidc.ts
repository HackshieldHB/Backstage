import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey } from 'crypto';

/** What we read from an IdP's /.well-known/openid-configuration. */
export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
}

export type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string; kty?: string };

const CLOCK_SKEW_S = 120;

export const randomUrlToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export const trimSlash = (s: string) => s.replace(/\/+$/, '');

export function parseDiscovery(raw: string): OidcDiscovery {
  const doc = JSON.parse(raw) as Partial<OidcDiscovery>;
  for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[key] !== 'string' || !doc[key]) throw new Error(`Discovery document is missing ${key}`);
  }
  return doc as OidcDiscovery;
}

/** Decode a compact JWS without verifying it. */
export function decodeJwt(token: string): {
  header: { alg?: string; kid?: string; typ?: string };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
} {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const [h, p, s] = parts;
  const json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  return { header: json(h), payload: json(p), signingInput: `${h}.${p}`, signature: Buffer.from(s, 'base64url') };
}

/**
 * Validate an OIDC ID token (signature + standard claims). Only asymmetric
 * algorithms are accepted (RS256 / ES256) — never `none` or HMAC, so a token
 * can't be forged with the client secret or by stripping the signature.
 */
export function verifyIdToken(
  token: string,
  keys: Jwk[],
  expected: { issuer: string; clientId: string; nonce: string; nowSeconds?: number },
): IdTokenClaims {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  const alg = header.alg;
  if (alg !== 'RS256' && alg !== 'ES256') throw new Error(`Unsupported ID token algorithm: ${String(alg)}`);

  const kty = alg === 'RS256' ? 'RSA' : 'EC';
  const candidates = keys.filter(
    (k) => k.kty === kty && (!k.use || k.use === 'sig') && (!k.alg || k.alg === alg) && (!header.kid || k.kid === header.kid),
  );
  if (candidates.length === 0) throw new Error('No matching signing key');
  const ok = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      return verifySignature(
        'sha256',
        Buffer.from(signingInput),
        alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key,
        signature,
      );
    } catch {
      return false;
    }
  });
  if (!ok) throw new Error('ID token signature is invalid');

  const claims = payload as unknown as IdTokenClaims;
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (trimSlash(String(claims.iss)) !== trimSlash(expected.issuer)) throw new Error('ID token issuer mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) throw new Error('ID token audience mismatch');
  if (aud.length > 1 && claims.azp !== expected.clientId) throw new Error('ID token azp mismatch');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new Error('ID token expired');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) throw new Error('ID token issued in the future');
  if (!claims.nonce || claims.nonce !== expected.nonce) throw new Error('ID token nonce mismatch');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('ID token has no subject');
  return claims;
}
