import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30-second steps, 6
 * digits) — what Google Authenticator, 1Password, Authy etc. use. Implemented
 * with Node's crypto so there is no extra dependency; verified against the RFC
 * 6238 test vectors in totp.spec.ts.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** RFC 4648 base32 (no padding) — the format authenticator apps expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random 160-bit secret, base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The HOTP value (RFC 4226) for `counter`. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  // Counter as a big-endian 64-bit integer (fits safely for realistic times).
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** The TOTP code for a moment in time. */
export function totp(secretBase32: string, atMs = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / TOTP_STEP_SECONDS), digits);
}

/**
 * Check a code, allowing one step of clock drift either way. Returns the
 * matched time step (so callers can refuse replays of the same step), or null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs = Date.now(),
  window = 1,
): number | null {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const key = base32Decode(secretBase32);
  const step = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(hotp(key, step + w));
    if (timingSafeEqual(expected, Buffer.from(normalized))) return step + w;
  }
  return null;
}

/** otpauth:// URI for authenticator apps (rendered as a QR code or opened directly). */
export function otpauthUri(secretBase32: string, account: string, issuer = 'Backstages'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
