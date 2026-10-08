import { createHmac } from 'crypto';
import { privateOutboundAllowed, safeRequest, validatePublicUrl } from '../common/safe-http';

export { isBlockedAddress, safeLookup } from '../common/safe-http';

/**
 * Outgoing workflow webhooks: https only (plain http only when
 * OUTBOUND_HTTP_ALLOW_PRIVATE=1, for dev/tests), public addresses only, no
 * redirects, 5s timeout, response body discarded after a small cap. See
 * common/safe-http.ts for the SSRF guard.
 */

const webhookSchemes = () => (privateOutboundAllowed() ? ['https:', 'http:'] : ['https:']);

/** Static checks on a configured webhook URL. Returns an error message or null. */
export function validateWebhookUrl(raw: string): string | null {
  return validatePublicUrl(raw, webhookSchemes());
}

export function signBody(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** POST `payload` as JSON, signed with `secret`. Resolves with the HTTP status; rejects on any failure. */
export async function postWebhook(
  rawUrl: string,
  payload: unknown,
  secret: string,
): Promise<number> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await safeRequest(rawUrl, {
    method: 'POST',
    schemes: webhookSchemes(),
    body,
    timeoutMs: 5000,
    maxBytes: 64 * 1024,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Backstages-Workflows/1.0',
      'X-Backstages-Timestamp': timestamp,
      'X-Backstages-Signature': signBody(secret, timestamp, body),
    },
  });
  // Redirects are deliberately not followed: a 3xx is reported as-is.
  return res.status;
}
