import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { BlockList, isIP, type LookupFunction } from 'net';

/**
 * Outbound HTTP to user-supplied URLs (workflow webhooks, calendar feeds),
 * hardened against SSRF:
 *  - every address a hostname resolves to must be public — loopback, private,
 *    link-local (incl. cloud metadata), CGNAT, multicast, documentation and
 *    IPv4-mapped / NAT64 forms of those are refused;
 *  - the vetted address is the one we connect to (custom `lookup`), so DNS
 *    rebinding between "check" and "connect" can't redirect the request;
 *  - IP-literal URLs (which skip `lookup`) are checked up front;
 *  - redirects are never followed blindly (each hop is re-validated), and hard
 *    timeouts and size caps apply.
 * OUTBOUND_HTTP_ALLOW_PRIVATE=1 lifts the address checks (and allows plain http
 * webhooks) for local development and tests only.
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

/** Dev/test escape hatch — never set in production. */
export const privateOutboundAllowed = () => process.env.OUTBOUND_HTTP_ALLOW_PRIVATE === '1';

/**
 * Static checks on a user-supplied URL. `schemes` lists the allowed protocols
 * (e.g. ['https:']). Returns a human error message, or null when acceptable.
 */
export function validatePublicUrl(raw: string, schemes: string[]): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full URL, e.g. https://example.com/path';
  }
  if (!schemes.includes(url.protocol)) {
    return `The URL must start with ${schemes.map((s) => `${s}//`).join(' or ')}`;
  }
  if (url.username || url.password) return 'Put credentials in a header, not the URL';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !privateOutboundAllowed() &&
    (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && isBlockedAddress(host)))
  ) {
    return 'The URL must point to a public address';
  }
  return null;
}

/** A dns lookup that refuses non-public answers (all of them, to avoid mixed rebinding). */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) return callback(new Error(`No addresses for ${hostname}`), '', 4);
    if (!privateOutboundAllowed() && list.some((a) => isBlockedAddress(a.address))) {
      return callback(new Error(`Refusing to call non-public address for ${hostname}`), '', 4);
    }
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

/** One guarded request. Resolves with status, headers and (capped) body. */
export function safeRequest(
  rawUrl: string,
  opts: {
    method: 'GET' | 'POST';
    schemes: string[];
    headers?: Record<string, string | number>;
    body?: string;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  truncated: boolean;
}> {
  const problem = validatePublicUrl(rawUrl, opts.schemes);
  if (problem) return Promise.reject(new Error(problem));
  const url = new URL(rawUrl);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      { method: opts.method, lookup: safeLookup, timeout: opts.timeoutMs, headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        let seen = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          if (truncated) return;
          seen += chunk.length;
          if (seen > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (seen - opts.maxBytes)));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
          });
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
      },
    );
    const deadline = setTimeout(() => req.destroy(new Error('Request timed out')), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    req.on('close', () => clearTimeout(deadline));
    req.end(opts.body);
  });
}

/**
 * GET text from a public URL, following up to `maxRedirects` redirects — each
 * hop re-validated (scheme + public address), so a redirect can't reach inside.
 */
export async function safeGetText(
  rawUrl: string,
  opts: { schemes: string[]; timeoutMs: number; maxBytes: number; maxRedirects?: number },
): Promise<string> {
  let current = rawUrl;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const res = await safeRequest(current, {
      method: 'GET',
      schemes: opts.schemes,
      timeoutMs: opts.timeoutMs,
      maxBytes: opts.maxBytes,
      headers: { 'User-Agent': 'Backstages/1.0', Accept: 'text/calendar, text/plain, */*' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return res.body;
  }
  throw new Error('Too many redirects');
}
