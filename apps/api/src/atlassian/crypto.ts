import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM for OAuth tokens at rest. Format: iv.ciphertext.authTag (base64url).
 * Key: TOKEN_ENCRYPTION_KEY, 64 hex chars (32 bytes).
 */
function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY ?? '';
  if (hex.length !== 64) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex chars');
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function decryptToken(payload: string): string {
  const [iv, data, tag] = payload.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
