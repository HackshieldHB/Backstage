import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function hmac(attachmentId: string, exp: number): string {
  return createHmac('sha256', process.env.JWT_ACCESS_SECRET ?? '')
    .update(`${attachmentId}.${exp}`)
    .digest('base64url');
}

/**
 * Signed download URL so plain <img> tags (which cannot send Authorization
 * headers) can load attachments. The signature is scoped to one attachment id.
 */
export function signAttachmentUrl(attachmentId: string): string {
  const exp = Date.now() + DEFAULT_TTL_MS;
  return `/attachments/${attachmentId}?exp=${exp}&sig=${hmac(attachmentId, exp)}`;
}

export function verifyAttachmentSignature(attachmentId: string, exp: string, sig: string): boolean {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expected = Buffer.from(hmac(attachmentId, expNum));
  const provided = Buffer.from(sig);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
