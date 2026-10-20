# Large meetings (LiveKit SFU) and server recording

Without a media server, huddles are a WebRTC **mesh**: everyone connects to everyone, which needs
nothing extra but runs out of upload bandwidth around 5–6 people with video. With a self-hosted
**LiveKit** SFU configured, every huddle sends its media through the server instead: each person
uploads once, and the server forwards to everyone, so meetings can be much larger.

Only the media path changes. Everything else in a huddle (participants, roles, waiting room, lock,
chat, reactions, polls, notes, whiteboard, annotations, captions, remote-control requests, breakout
assignments) still runs over the Socket.IO gateway, exactly as in mesh mode. Camera, screen share
(with tab audio), virtual backgrounds, push-to-talk, mute, browser recording, the active-speaker
ring and picture-in-picture all work the same either way.

**Choosing the mode:** each time someone joins a huddle, the app asks `GET /huddles/sfu/status`. If
LiveKit is configured, that huddle uses it; otherwise (or if the check fails) it uses the mesh. No
setting is needed in the web app.

## What the server enforces

The gateway decides who is in a huddle; the API mirrors that onto LiveKit:

- **Tokens only for admitted people.** `POST /huddles/sfu/token` requires channel/DM membership *and*
  presence in the huddle, so the waiting room and lock hold. Tokens last 10 minutes (LiveKit
  refreshes them for connected clients), and each connection gets its own identity
  (`<userId>~<random>`) so a second tab doesn't kick the first.
- **Breakout rooms are separate LiveKit rooms** (`channel:<id>~br~<roomId>`). The server picks the
  room for your token from your assignment; moving people reconnects them, and the API removes
  connections left behind in the wrong room.
- **Leaving or being removed** cuts that person's connections. A socket that drops and comes
  straight back keeps its media.
- **Every connection is re-checked** through LiveKit's `participant_joined` webhook. Anyone in a
  room they aren't admitted to (for example, someone replaying an old token) is removed.

## Setup

1. Generate a key pair: `docker run --rm livekit/livekit-server generate-keys` (the secret must be
   at least 32 characters).
2. Put it in `infra/livekit/livekit.yaml` (`keys:` and `webhook.api_key`). Set `webhook.urls` to the
   API's `/webhooks/livekit`, reachable from the LiveKit host.
3. `docker compose -f infra/livekit/docker-compose.yml up -d`
4. In `apps/api/.env`:
   ```
   LIVEKIT_URL=wss://sfu.example.com      # what browsers connect to (ws:// only for localhost)
   LIVEKIT_API_KEY=<key>
   LIVEKIT_API_SECRET=<secret>
   # LIVEKIT_API_URL=http://127.0.0.1:7880  # only if the API reaches LiveKit by another address
   ```
5. Restart the API. `GET /huddles/sfu/status` should return `{ "enabled": true, "recording": false }`.

For production, put LiveKit behind TLS (browsers require `wss://` on an HTTPS site), set
`rtc.use_external_ip: true`, and open TCP 7881 and UDP 50000–50100. See LiveKit's deployment
guide for TURN/TLS options.

## Server recording (LiveKit Egress)

With the SFU running, recordings can be made **on the server**: video and audio of the main room
(speaker layout, MP4) instead of an audio-only recording in the moderator's browser. A server
recording keeps going if the person who started it leaves. It stops when a moderator stops it or
the huddle ends. When it finishes, the file is posted to the huddle's channel/DM as the person who
started it, like a browser recording.

Enable it with an Egress worker:

1. `docker compose -f infra/livekit/docker-compose.yml --profile recording up -d`
   (`infra/livekit/egress.yaml` needs the same key pair; LiveKit and Egress share the Redis in that
   compose file).
2. In `apps/api/.env`: `LIVEKIT_EGRESS=1`.
3. Storage:
   - `STORAGE_DRIVER=s3`: Egress uploads straight to your bucket using the API's `S3_*` settings.
   - `STORAGE_DRIVER=disk`: Egress must write into the API's uploads folder. The compose file
     mounts `apps/api/uploads` at `/out`; set `LIVEKIT_EGRESS_FILE_DIR=/out`.
4. Make sure the webhook from step 2 of Setup reaches the API. `egress_ended` is what posts the file.

The status endpoint then reports `"recording": true`, and moderators see **Record meeting** (server)
instead of **Record audio** (browser). If Egress can't start, or fails partway, the recording
indicator is taken down for everyone and the person who started it is told.

Notes:

- Breakout rooms aren't included; the recording covers the main room.
- Each recording is tracked in the `HuddleRecording` table (status, file key, error), and a
  redelivered webhook never posts twice.
- Files of 2 GiB or more are stored with the size capped and download without a `Content-Length`
  header, so they still arrive complete.

> **Verification status:** SFU media (audio, camera, breakouts, leave, mesh fallback, and webhook
> enforcement) is covered by a Playwright test against a real `livekit-server` 1.13.10 with
> Chrome's fake devices (`apps/web/e2e/huddle-sfu.spec.ts`). Server recording is tested against a
> simulated LiveKit API only (`apps/api/test/sfu.e2e.spec.ts`). It has **not** been run with a real
> Egress worker (Egress needs Linux/Docker, which wasn't available here). Do one test recording
> after deploying it.
