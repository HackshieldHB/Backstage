import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceConfigDto {
  iceServers: IceServer[];
  /** Seconds the credentials stay valid; the client refreshes before then. */
  ttlSeconds: number;
  /** Which relay the credentials are for (shown in diagnostics). */
  relay: 'cloudflare' | 'coturn' | 'static' | 'public';
}

const split = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Metered's free Open Relay — best-effort, rate-limited; only when nothing is configured. */
const PUBLIC_RELAY: IceServer = {
  urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
  username: 'openrelayproject',
  credential: 'openrelayproject',
};

/**
 * Hands huddle clients STUN/TURN servers with short-lived credentials, so no
 * long-lived relay secret is ever baked into the web bundle. Picks the first
 * configured provider:
 *
 *  1. Cloudflare Realtime TURN — CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
 *  2. coturn "REST API" shared secret — TURN_URLS + TURN_SECRET
 *     (coturn: `use-auth-secret` + `static-auth-secret=<TURN_SECRET>`)
 *  3. Static credentials kept server-side — TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
 *  4. Otherwise the public Open Relay (current behaviour, best-effort).
 *
 * STUN_URLS overrides the default STUN server. TURN_TTL_SECONDS sets the
 * credential lifetime (default 12h).
 */
@Injectable()
export class IceService {
  private readonly logger = new Logger(IceService.name);

  private get ttl(): number {
    const n = Number(process.env.TURN_TTL_SECONDS);
    return Number.isFinite(n) && n >= 600 ? Math.floor(n) : 12 * 60 * 60;
  }

  private stun(): IceServer {
    const urls = split(process.env.STUN_URLS);
    return { urls: urls.length ? urls : ['stun:stun.l.google.com:19302'] };
  }

  async forUser(userId: string, now = Date.now()): Promise<IceConfigDto> {
    const ttl = this.ttl;

    if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) {
      const cf = await this.cloudflare(ttl).catch((err) => {
        this.logger.warn(`Cloudflare TURN credentials failed, falling back: ${String(err)}`);
        return null;
      });
      if (cf) return { iceServers: cf, ttlSeconds: ttl, relay: 'cloudflare' };
    }

    const turnUrls = split(process.env.TURN_URLS);
    if (turnUrls.length && process.env.TURN_SECRET) {
      return {
        iceServers: [this.stun(), coturnCredentials(turnUrls, process.env.TURN_SECRET, userId, ttl, now)],
        ttlSeconds: ttl,
        relay: 'coturn',
      };
    }
    if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      return {
        iceServers: [
          this.stun(),
          { urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL },
        ],
        ttlSeconds: ttl,
        relay: 'static',
      };
    }
    return { iceServers: [this.stun(), PUBLIC_RELAY], ttlSeconds: ttl, relay: 'public' };
  }

  private async cloudflare(ttl: number): Promise<IceServer[]> {
    const keyId = encodeURIComponent(process.env.CLOUDFLARE_TURN_KEY_ID!);
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { iceServers?: { urls: string | string[]; username?: string; credential?: string }[] };
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) throw new Error('no iceServers in response');
    return body.iceServers.map((s) => ({
      // Port-53 URLs tend to time out in browsers (Cloudflare's own advice).
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
      ...(s.username ? { username: s.username } : {}),
      ...(s.credential ? { credential: s.credential } : {}),
    }));
  }
}

/**
 * coturn's time-limited credential scheme (the "TURN REST API"): the username is
 * `<expiry unix seconds>:<user id>` and the password is
 * base64(HMAC-SHA1(shared secret, username)). coturn rejects it after expiry.
 */
export function coturnCredentials(urls: string[], secret: string, userId: string, ttl: number, now = Date.now()): IceServer {
  const username = `${Math.floor(now / 1000) + ttl}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential };
}
