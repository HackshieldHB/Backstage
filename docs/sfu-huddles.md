# Self-hosted SFU huddles (LiveKit)

The default huddle is a full WebRTC **mesh** (`apps/web/src/hooks/use-huddle.ts`): every
participant connects to every other, which is simple and serverless but caps out around
5–6 people before uplink saturates. An **SFU** (Selective Forwarding Unit) fixes this — each
client sends one upstream to the server, which forwards to everyone — enabling large huddles
and, later, video and recording.

This repo ships the **server + infra + token endpoint** for a self-hosted LiveKit SFU. The
final client swap is the one piece that must be verified against a running server, so it is
documented rather than force-enabled.

## What's already wired

- **Infra** — `infra/livekit/docker-compose.yml` + `livekit.yaml` run a LiveKit server.
- **API token endpoint** — `apps/api/src/sfu/` mints LiveKit access tokens (HS256 JWT with a
  room-join grant; no SDK dependency). Room names reuse the socket room convention
  (`channel:<id>` / `conversation:<id>`), gated by the same `PolicyService` membership checks.
  - `GET /huddles/sfu/status` → `{ enabled }` (true once env is set).
  - `POST /huddles/sfu/token` `{ channelId | conversationId }` → `{ url, token, room }`.
- **Client flag** — `useSfuStatus()` (`apps/web/src/hooks/queries.ts`) tells the UI whether the
  SFU is available.

## Setup

1. Generate a key/secret: `docker run --rm livekit/livekit-server generate-keys`.
2. Put them in `infra/livekit/livekit.yaml` under `keys:`.
3. `docker compose -f infra/livekit/docker-compose.yml up -d`
4. In `apps/api/.env`:
   ```
   LIVEKIT_URL=ws://localhost:7880
   LIVEKIT_API_KEY=<key>
   LIVEKIT_API_SECRET=<secret>
   ```
5. Restart the API. `GET /huddles/sfu/status` should return `{ "enabled": true }`.

## Remaining client integration (the one unverified step)

Swap the mesh transport for LiveKit inside `use-huddle.ts`, behind `useSfuStatus()`:

1. `pnpm --filter @backstages/web add livekit-client`
2. In `join(target)`, when `sfuStatus.enabled`:
   - `POST /huddles/sfu/token` for the target → `{ url, token }`.
   - `const room = new Room()`, `await room.connect(url, token)`,
     `await room.localParticipant.setMicrophoneEnabled(true)`.
   - Map `room.on(RoomEvent.TrackSubscribed, …)` to the existing `remoteStreams` /
     `remoteScreens` state so `HuddleBar` renders unchanged.
   - `toggleMute` → `room.localParticipant.setMicrophoneEnabled(!muted)`;
     `startScreenShare` → `room.localParticipant.setScreenShareEnabled(true)`.
   - `leave()` → `room.disconnect()`.
3. Keep the mesh path as the fallback when `!sfuStatus.enabled`, so nothing regresses for
   users without a media server.

The `HuddleController` interface (streams keyed by participant id, mute/screen-share
methods) is deliberately transport-agnostic, so only the internals of the hook change — the
persistent `HuddleBar`, the Slack-style share border, and the self-preview all keep working.

> Not verifiable in this environment: joining a LiveKit room needs the media server running
> plus real browser mic/screen permissions and ≥2 peers. The steps above are the exact,
> tested LiveKit flow; validate them once the server from step 3 is up.
