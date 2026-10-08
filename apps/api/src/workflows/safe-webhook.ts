import { createHmac } from 'crypto';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { BlockList, isIP, type LookupFunction } from 'net';

/**
 * Outgoing webhooks for workflows, hardened against SSRF:
 *  - https only (plain http only when WORKFLOW_WEBHOOKS_ALLOW_INSECURE=1, for dev/tests);
 *  - every address the hostname resolves to must be public — loopback, private,
 *    link-local, CGNAT, multicast, documentation and IPv4-mapped/NAT64 forms of
 *    those are refused;
 *  - the vetted address is the one we connect to (custom `lookup`), so DNS
 *    rebinding between "check" and "connect" can't redirect the request;
 *  - no redirects are followed, a hard timeout applies, and the response body is
 *    discarded after a small cap.
 */

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can reach IPv4 space indirectly
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** True when `address` is not a routable public unicast address. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) — judge the embedded IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return BLOCKED.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
    }
    return BLOCKED.check(lower, 'ipv6');
  }
  return true; // not an IP at all
}

const insecureAllowed = () => process.env.WORKFLOW_WEBHOOKS_ALLOW_INSECURE === '1';

/** Static checks on a configured URL (scheme, credentials, shape). Returns an error message or null. */
export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full URL, e.g. https://example.com/hook';
  }
  if (url.protocol !== 'https:' && !(insecureAllowed() && url.protocol === 'http:')) {
    return 'Webhook URLs must use https://';
  }
  if (url.username || url.password) return 'Put credentials in a header, not the URL';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !insecureAllowed() &&
    (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && isBlockedAddress(host)))
  ) {
    return 'Webhook URLs must point to a public address';
  }
  return null;
}

/** A dns lookup that refuses non-public answers (all of them, to avoid mixed rebinding). */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) return callback(new Error(`No addresses for ${hostname}`), '', 4);
    if (!insecureAllowed() && list.some((a) => isBlockedAddress(a.address))) {
      return callback(new Error(`Refusing to call non-public address for ${hostname}`), '', 4);
    }
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

export function signBody(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

const TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/** POST `payload` as JSON, signed with `secret`. Resolves with the HTTP status; rejects on any failure. */
export function postWebhook(rawUrl: string, payload: unknown, secret: string): Promise<number> {
  const problem = validateWebhookUrl(rawUrl);
  if (problem) return Promise.reject(new Error(problem));
  const url = new URL(rawUrl);
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: 'POST',
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Backstages-Workflows/1.0',
          'X-Backstages-Timestamp': timestamp,
          'X-Backstages-Signature': signBody(secret, timestamp, body),
        },
      },
      (res) => {
        let seen = 0;
        res.on('data', (chunk: Buffer) => {
          seen += chunk.length;
          if (seen > MAX_RESPONSE_BYTES) res.destroy();
        });
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('close', () => resolve(res.statusCode ?? 0));
        res.on('error', () => resolve(res.statusCode ?? 0));
      },
    );
    const deadline = setTimeout(() => req.destroy(new Error('Webhook timed out')), TIMEOUT_MS);
    req.on('timeout', () => req.destroy(new Error('Webhook timed out')));
    req.on('error', (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    req.on('close', () => clearTimeout(deadline));
    req.end(body);
  });
}
