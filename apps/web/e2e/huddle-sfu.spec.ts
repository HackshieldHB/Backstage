import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Huddle media through a real LiveKit SFU, with Chrome's fake mic/camera.
 * Needs a running livekit-server and the API started with LIVEKIT_URL /
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET — so it only runs with E2E_LIVEKIT=1:
 *
 *   livekit-server --dev --bind 127.0.0.1
 *   (api) LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret
 *   E2E_LIVEKIT=1 pnpm exec playwright test huddle-sfu
 *
 * With a LiveKit config whose `webhook:` points at the API, also set
 * E2E_LIVEKIT_SECRET (and E2E_LIVEKIT_KEY if not "devkey") to check that the
 * server throws out connections that were never admitted. E2E_MESH=1 runs the
 * same flow against an API without LiveKit (the peer-to-peer fallback).
 */
const viaSfu = !process.env.E2E_MESH;
test.skip(!process.env.E2E_LIVEKIT && !process.env.E2E_MESH, 'set E2E_LIVEKIT=1 with a LiveKit server running (or E2E_MESH=1)');

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  },
});

const run = Date.now().toString(36);
const seenTour = () => window.localStorage.setItem('bs.tour.sidebar.v1', '1');

async function newUser(ctx: BrowserContext, name: string) {
  await ctx.addInitScript(seenTour);
  const page = await ctx.newPage();
  await page.goto('/signup');
  await page.getByTestId('signup-name').fill(`${name} SFU`);
  await page.getByTestId('signup-email').fill(`e2e-sfu-${name}-${run}@example.com`);
  await page.getByTestId('signup-password').fill('password123!');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/welcome/);
  return page;
}

/** Remote <audio> elements whose track is receiving packets (track.muted === false). */
const liveRemoteAudio = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('audio')].filter((a) => {
        const s = a.srcObject as MediaStream | null;
        return !!s && s.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted);
      }).length,
  );

/** Remote camera <video> tiles that are decoding frames. */
const playingRemoteVideo = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('[data-testid="participant-tile"] video')].filter((v) => {
        const el = v as HTMLVideoElement;
        return !el.className.includes('-scale-x-100') && el.videoWidth > 0;
      }).length,
  );

test(`two people hear and see each other (${viaSfu ? 'LiveKit SFU' : 'peer-to-peer mesh'})`, async ({ browser }) => {
  const ctxA = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const ctxB = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const sockets: Record<'A' | 'B', string[]> = { A: [], B: [] };
  const pageA = await newUser(ctxA, 'ann');
  pageA.on('websocket', (ws) => sockets.A.push(ws.url()));
  await pageA.getByTestId('workspace-name').fill(`SFU ${run}`);
  await pageA.getByTestId('workspace-create').click();
  await expect(pageA.getByTestId('channel-title')).toContainText('general', { timeout: 15000 });

  await pageA.getByTestId('invite-button').click();
  await pageA.getByTestId('create-invite-link').click();
  const inviteUrl = (await pageA.getByTestId('invite-url').innerText()).trim();
  await pageA.keyboard.press('Escape');

  const pageB = await newUser(ctxB, 'ben');
  pageB.on('websocket', (ws) => sockets.B.push(ws.url()));
  await pageB.goto(`/invite/${inviteUrl.split('/invite/')[1]}`);
  await expect(pageB.getByTestId('channel-title')).toContainText('general', { timeout: 15000 });

  // A starts the huddle, B joins it.
  const tokenResponse = viaSfu ? pageA.waitForResponse((r) => r.url().includes('/huddles/sfu/token')) : null;
  await pageA.getByTestId('start-huddle').click();
  await expect(pageA.getByTestId('meeting-room')).toBeVisible({ timeout: 15000 });
  await pageB.getByTestId('join-huddle').click();
  await expect(pageB.getByTestId('meeting-room')).toBeVisible({ timeout: 15000 });

  // Audio flows both ways.
  await expect.poll(() => liveRemoteAudio(pageA), { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(() => liveRemoteAudio(pageB), { timeout: 20000 }).toBeGreaterThan(0);

  // Media went through the LiveKit server (or, in mesh mode, never touched it).
  expect(sockets.A.some((u) => u.includes(':7880'))).toBe(viaSfu);
  expect(sockets.B.some((u) => u.includes(':7880'))).toBe(viaSfu);

  // A turns the camera on (keyboard shortcut "v"); B sees moving video.
  await pageA.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pageA.keyboard.press('v');
  await expect.poll(() => playingRemoteVideo(pageB), { timeout: 20000 }).toBeGreaterThan(0);

  // Camera off → B's tile goes back to the avatar.
  await pageA.keyboard.press('v');
  await expect.poll(() => playingRemoteVideo(pageB), { timeout: 20000 }).toBe(0);

  // Breakouts: A (host) splits the two of them into separate rooms — each is its
  // own LiveKit room, so they stop hearing each other — then brings them back.
  await pageA.getByTestId('ctrl-more').click();
  await pageA.getByRole('button', { name: 'Breakout rooms' }).click();
  await pageA.getByRole('button', { name: 'Open breakout rooms' }).click();
  await expect(pageB.getByTestId('breakout-banner')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => liveRemoteAudio(pageA), { timeout: 20000 }).toBe(0);
  await expect.poll(() => liveRemoteAudio(pageB), { timeout: 20000 }).toBe(0);
  await pageA.getByRole('button', { name: 'Close breakout rooms' }).click();
  await expect.poll(() => liveRemoteAudio(pageA), { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(() => liveRemoteAudio(pageB), { timeout: 20000 }).toBeGreaterThan(0);

  // Server-side enforcement (needs livekit.yaml `webhook:` → the API, and the
  // secret here): someone holding a valid LiveKit token for this room who was
  // never admitted to the huddle gets thrown out by the participant_joined webhook.
  const lkSecret = process.env.E2E_LIVEKIT_SECRET;
  if (viaSfu && lkSecret) {
    const room = ((await (await tokenResponse!).json()) as { data: { room: string } }).data.room;
    expect(room).toBeTruthy();
    const { createHmac } = await import('crypto');
    const sign = (claims: Record<string, unknown>) => {
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: process.env.E2E_LIVEKIT_KEY ?? 'devkey', nbf: now - 5, exp: now + 300, ...claims })}`;
      return `${data}.${createHmac('sha256', lkSecret).update(data).digest('base64url')}`;
    };
    const forged = sign({ sub: 'intruder~x', video: { room, roomJoin: true, canPublish: true, canSubscribe: true } });
    /** Who LiveKit has in the room right now (server API, as an admin). */
    const identities = async () => {
      const res = await fetch('http://127.0.0.1:7880/twirp/livekit.RoomService/ListParticipants', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sign({ video: { room, roomAdmin: true } })}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      const body = (await res.json()) as { participants?: { identity: string }[] };
      return (body.participants ?? []).map((p) => p.identity);
    };

    // Mic permission so Chrome exposes real host candidates (not mDNS names LiveKit can't resolve).
    const ctxI = await browser.newContext({ permissions: ['microphone'] });
    const pageI = await ctxI.newPage();
    await pageI.goto('/login');
    const attempt = pageI.evaluate(async ({ token }) => {
      const lk = await import('https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/+esm' as string);
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
      await new lk.Room().connect('ws://127.0.0.1:7880', token).catch(() => undefined); // kicked mid-connect
    }, { token: forged });

    // The intruder gets in, then is removed within seconds — well before any
    // connect/ICE timeout (~15 s) could explain it leaving.
    await expect.poll(async () => (await identities()).includes('intruder~x'), { timeout: 10000, intervals: [50] }).toBe(true);
    const seenAt = Date.now();
    await expect.poll(async () => (await identities()).includes('intruder~x'), { timeout: 5000, intervals: [50] }).toBe(false);
    expect(Date.now() - seenAt).toBeLessThan(5000);
    // …while the admitted people stay.
    expect((await identities()).length).toBe(2);
    await attempt;
    await ctxI.close();
  }

  // B leaves: A no longer receives B's audio.
  await pageB.keyboard.press('Escape');
  await ctxB.close();
  await expect.poll(() => liveRemoteAudio(pageA), { timeout: 20000 }).toBe(0);
  await ctxA.close();
});
