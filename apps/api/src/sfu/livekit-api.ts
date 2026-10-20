import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Minimal LiveKit server-side toolkit with no SDK dependency: access tokens
 * (HS256 JWTs carrying a `video` grant), the Twirp server API (RoomService /
 * Egress) and webhook verification.
 */

export interface LivekitConfig {
  /** What browsers connect to (ws:// or wss://). */
  url: string;
  /** What the API calls for the server API (http(s)://); defaults to `url` with an http scheme. */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

export function livekitConfig(): LivekitConfig | null {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  const apiUrl = (process.env.LIVEKIT_API_URL || url).replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
  return { url, apiUrl, apiKey, apiSecret };
}

/** Server recording (Egress) is opt-in on top of the SFU: it needs an Egress worker. */
export function egressEnabled(): boolean {
  return livekitConfig() !== null && process.env.LIVEKIT_EGRESS === '1';
}

export interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  roomList?: boolean;
  roomRecord?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function signLivekitToken(
  cfg: Pick<LivekitConfig, 'apiKey' | 'apiSecret'>,
  claims: { identity?: string; name?: string; ttlSeconds: number; video: VideoGrant },
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: cfg.apiKey,
    nbf: now - 5,
    exp: now + claims.ttlSeconds,
    video: claims.video,
  };
  if (claims.identity) payload.sub = claims.identity;
  if (claims.name) payload.name = claims.name;
  const data = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac('sha256', cfg.apiSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export class LivekitApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One Twirp call (JSON). */
export async function twirp<T>(cfg: LivekitConfig, service: string, method: string, body: object, video: VideoGrant): Promise<T> {
  const token = signLivekitToken(cfg, { ttlSeconds: 60, video });
  const res = await fetch(`${cfg.apiUrl}/twirp/livekit.${service}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `LiveKit ${service}.${method}: HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { msg?: string };
      if (j.msg) message = `LiveKit ${service}.${method}: ${j.msg}`;
    } catch {
      /* keep status text */
    }
    throw new LivekitApiError(res.status, message);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Identities currently in a room (empty when the room doesn't exist). */
export async function listParticipantIdentities(cfg: LivekitConfig, room: string): Promise<string[]> {
  try {
    const res = await twirp<{ participants?: { identity?: string }[] }>(
      cfg,
      'RoomService',
      'ListParticipants',
      { room },
      { room, roomAdmin: true },
    );
    return (res.participants ?? []).map((p) => p.identity ?? '').filter(Boolean);
  } catch (err) {
    if (err instanceof LivekitApiError && err.status === 404) return [];
    throw err;
  }
}

/** Kick one connection out of a room; already gone counts as done. */
export async function removeParticipant(cfg: LivekitConfig, room: string, identity: string): Promise<void> {
  try {
    await twirp(cfg, 'RoomService', 'RemoveParticipant', { room, identity }, { room, roomAdmin: true });
  } catch (err) {
    if (err instanceof LivekitApiError && err.status === 404) return;
    throw err;
  }
}

/** Where an Egress writes its file. */
export type EgressOutput =
  | { kind: 's3'; bucket: string; region: string; accessKey: string; secret: string; endpoint?: string; filepath: string }
  | { kind: 'file'; filepath: string };

export async function startRoomCompositeEgress(cfg: LivekitConfig, room: string, output: EgressOutput): Promise<string> {
  const file: Record<string, unknown> = { file_type: 'MP4', filepath: output.filepath };
  if (output.kind === 's3') {
    file.s3 = {
      access_key: output.accessKey,
      secret: output.secret,
      region: output.region,
      bucket: output.bucket,
      ...(output.endpoint ? { endpoint: output.endpoint, force_path_style: true } : {}),
    };
  }
  const res = await twirp<{ egressId?: string; egress_id?: string }>(
    cfg,
    'Egress',
    'StartRoomCompositeEgress',
    { room_name: room, layout: 'speaker', file_outputs: [file] },
    { room, roomRecord: true },
  );
  const id = res.egressId ?? res.egress_id;
  if (!id) throw new LivekitApiError(500, 'LiveKit did not return an egress id');
  return id;
}

export async function stopEgress(cfg: LivekitConfig, egressId: string): Promise<void> {
  try {
    await twirp(cfg, 'Egress', 'StopEgress', { egress_id: egressId }, { roomRecord: true });
  } catch (err) {
    // Already finished/failed egresses can't be stopped — nothing left to do.
    if (err instanceof LivekitApiError && (err.status === 404 || err.status === 412)) return;
    throw err;
  }
}

/**
 * Verify a LiveKit webhook: the Authorization header is a JWT signed with our
 * API secret whose `sha256` claim is the base64 SHA-256 of the raw body.
 */
export function verifyLivekitWebhook(
  cfg: Pick<LivekitConfig, 'apiKey' | 'apiSecret'>,
  rawBody: Buffer,
  authorization: string | undefined,
): boolean {
  if (!authorization) return false;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;
  let header: { alg?: string };
  let payload: { iss?: string; exp?: number; nbf?: number; sha256?: string };
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  if (header.alg !== 'HS256') return false;
  const expected = createHmac('sha256', cfg.apiSecret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== cfg.apiKey) return false;
  if (typeof payload.exp === 'number' && payload.exp < now - 30) return false;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return false;
  const digest = createHash('sha256').update(rawBody).digest('base64');
  const claim = payload.sha256 ?? '';
  // LiveKit sends standard base64; accept the url-safe alphabet too.
  const norm = (v: string) => v.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return claim.length > 0 && norm(claim) === norm(digest);
}

/** Room name for a huddle: its key, plus the breakout room when in one. */
export function sfuRoomName(huddleKey: string, breakoutId: string | null): string {
  return breakoutId ? `${huddleKey}~br~${breakoutId}` : huddleKey;
}

/** Inverse of sfuRoomName (null for rooms that aren't ours). */
export function parseSfuRoomName(room: string): { key: string; breakoutId: string | null } | null {
  const m = /^((?:channel|conversation):[^~]+)(?:~br~([^~]+))?$/.exec(room);
  return m ? { key: m[1], breakoutId: m[2] ?? null } : null;
}

/** `<userId>~<nonce>` → userId. */
export function userIdOfIdentity(identity: string): string {
  const i = identity.indexOf('~');
  return i === -1 ? identity : identity.slice(0, i);
}
