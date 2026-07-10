/* eslint-disable no-console */
/**
 * End-to-end smoke: exercises the full messaging path against a RUNNING api
 * (default http://localhost:3001) using plain HTTP + a live socket, printing
 * a transcript of every step.
 *
 *   register 2 users -> workspace -> channel -> join -> message
 *   -> unread=1 (via REST and via socket push) -> read -> unread=0
 */
import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';

const BASE = process.env.SMOKE_API_URL ?? 'http://localhost:3001';
const run = randomUUID().slice(0, 8);

function step(msg: string) {
  console.log(`[smoke] ${msg}`);
}

async function api<T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = (await res.json()) as { data: T; error: { message: string } | null };
  if (!res.ok || json.error) {
    throw new Error(`${method} ${path} -> ${res.status}: ${json.error?.message ?? 'unknown'}`);
  }
  return json.data;
}

function waitFor<T>(socket: Socket, event: string, predicate: (p: T) => boolean, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const handler = (payload: T) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });
}

async function main() {
  step(`API under test: ${BASE}`);

  const alice = await api<any>('POST', '/auth/signup', {
    body: { email: `smoke-alice-${run}@example.com`, password: 'password123!', displayName: 'Smoke Alice' },
  });
  step(`registered user 1 (alice): ${alice.user.id}`);
  const bob = await api<any>('POST', '/auth/signup', {
    body: { email: `smoke-bob-${run}@example.com`, password: 'password123!', displayName: 'Smoke Bob' },
  });
  step(`registered user 2 (bob):   ${bob.user.id}`);

  const ws = await api<any>('POST', '/workspaces', {
    token: alice.accessToken,
    body: { name: `Smoke ${run}` },
  });
  step(`alice created workspace:   ${ws.id} (${ws.slug})`);

  const invite = await api<any>('POST', `/workspaces/${ws.id}/invites`, {
    token: alice.accessToken,
    body: {},
  });
  await api('POST', '/invites/accept', { token: bob.accessToken, body: { token: invite.token } });
  step('bob accepted the invite link and joined the workspace');

  const channel = await api<any>('POST', `/workspaces/${ws.id}/channels`, {
    token: alice.accessToken,
    body: { name: 'smoke-channel' },
  });
  step(`alice created channel:     #${channel.name} (${channel.id})`);

  await api('POST', `/channels/${channel.id}/join`, { token: bob.accessToken });
  step('bob joined the channel');

  // Bob connects a live socket before the message is sent.
  const bobSocket = io(BASE, { auth: { token: bob.accessToken }, transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    bobSocket.once('ready', () => resolve()); // server signals rooms are joined
    bobSocket.once('connect_error', reject);
  });
  step('bob connected a live socket (JWT handshake accepted, rooms ready)');

  const messagePromise = waitFor<any>(bobSocket, 'message:new', () => true);
  const unreadPromise = waitFor<any>(
    bobSocket,
    'unread:updated',
    (p) => p.channelId === channel.id && p.unread === 1,
  );

  const sent = await api<any>('POST', `/channels/${channel.id}/messages`, {
    token: alice.accessToken,
    body: {
      clientMsgId: randomUUID(),
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello from the smoke test' }] }] },
      contentText: 'hello from the smoke test',
    },
  });
  step(`alice sent a message:      "${sent.contentText}" (${sent.id})`);

  const received = await messagePromise;
  step(`bob's socket received message:new -> "${received.message.contentText}"`);

  await unreadPromise;
  step("bob's socket received unread:updated -> unread=1");

  const unreads = await api<any>('GET', `/workspaces/${ws.id}/unreads`, { token: bob.accessToken });
  const entry = unreads.find((u: any) => u.channelId === channel.id);
  if (entry.unread !== 1) throw new Error(`expected unread=1, got ${entry.unread}`);
  step(`REST confirms unread=1 for bob in #${channel.name}`);

  const zeroPromise = waitFor<any>(
    bobSocket,
    'unread:updated',
    (p) => p.channelId === channel.id && p.unread === 0,
  );
  const readResult = await api<any>('POST', `/channels/${channel.id}/read`, {
    token: bob.accessToken,
    body: { messageId: sent.id },
  });
  step(`bob marked the channel read (response unread=${readResult.unread})`);
  await zeroPromise;
  step("bob's socket received unread:updated -> unread=0");

  const after = await api<any>('GET', `/workspaces/${ws.id}/unreads`, { token: bob.accessToken });
  const afterEntry = after.find((u: any) => u.channelId === channel.id);
  if (afterEntry.unread !== 0) throw new Error(`expected unread=0, got ${afterEntry.unread}`);
  step(`REST confirms unread=0 for bob in #${channel.name}`);

  bobSocket.disconnect();
  step('SMOKE PASSED ✔ — full pipeline verified: auth, workspace, invite, channel, realtime message, unread wiring');
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err.message);
  process.exit(1);
});
