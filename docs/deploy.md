# Sharing & deploying Backstages

Three ways to let people outside your network use Backstages, from quickest to most solid.

| | Link stays the same? | Needs | Good for |
|---|---|---|---|
| **1. Quick tunnel** (`scripts/share.ps1`) | No — new URL every run | Nothing | A quick demo today |
| **2. Named tunnel** (`scripts/share.ps1 -TunnelToken …`) | Yes | A domain on Cloudflare (free plan) | Running it from this PC for your team |
| **3. Server** (`deploy/docker-compose.prod.yml`) | Yes | A small Linux VPS with Docker | Always-on, not tied to your laptop |

> The web app has the API's URL **baked in at build time** (`NEXT_PUBLIC_API_URL`). Whenever the
> API URL changes, the web app must be rebuilt — the share script and the compose file handle this.

---

## 1. Quick tunnel (this PC, temporary link)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\share.ps1
```

It starts Postgres/Redis, opens two `*.trycloudflare.com` tunnels (web + API, over HTTP/2 because
QUIC/UDP is unreliable on many networks), updates `apps/api/.env` and `apps/web/.env.local`,
rebuilds, starts both apps, checks the public URLs and prints the link. Stop with
`scripts\share.ps1 -Stop`.

The link dies when the tunnel stops or the PC sleeps, and changes on every run.

## 2. Named tunnel (this PC, permanent link)

One-time setup in Cloudflare (your domain must use Cloudflare DNS):

1. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Name it `backstages`.
2. Copy the **tunnel token** shown in the install command (the long `eyJ…` string).
3. Add two **public hostnames** to the tunnel:
   - `chat.example.com` → `HTTP` → `localhost:3000`
   - `chat-api.example.com` → `HTTP` → `localhost:3001`

Then, every time:

```powershell
$env:BACKSTAGES_TUNNEL_TOKEN = '<token>'
powershell -ExecutionPolicy Bypass -File scripts\share.ps1 `
  -WebUrl https://chat.example.com -ApiUrl https://chat-api.example.com
```

Because the URLs never change, the web build is reused, and the Atlassian callback
(`https://chat-api.example.com/atlassian/callback`) only needs registering once.

## 3. Server (Docker Compose)

On a Linux box with Docker:

```bash
git clone <repo> backstages && cd backstages
cp deploy/.env.example deploy/.env      # fill in URLs + secrets
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

This runs Postgres, Redis, a one-shot `migrate` job, the API and the web app. Add:

- `--profile tunnel` — a Cloudflare named tunnel container (set `CLOUDFLARE_TUNNEL_TOKEN`; route the
  hostnames to `http://web:3000` and `http://api:3001`). No ports need to be opened.
- `--profile turn` — a coturn relay for huddles (see below). Needs UDP 3478 and 49160–49200 open.

Without the tunnel profile, put a reverse proxy with HTTPS (Caddy, nginx) in front of ports 3000/3001.
Browsers only allow microphone/camera access on HTTPS (or localhost).

Upgrading: `git pull` then the same `up -d --build` — migrations run automatically before the API starts.

---

## Settings worth turning on

### Meeting reminders that reach people with no tab open (Web Push)

```bash
cd apps/api && node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Put the two keys in `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. People then click **Turn on** in the
Calendar (or *Enable notifications* in their profile). Pushes are sent only when someone has no
Backstages tab open — an open tab shows its own alert — and not while they're out of office.

### Huddles across strict networks (TURN)

Peer-to-peer media fails on many corporate, campus and mobile networks. Configure a relay on the
**API** (never in the web build); browsers get short-lived credentials from `GET /huddles/ice-servers`:

- **Cloudflare TURN** — `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN`, or
- **Your coturn** — `TURN_URLS=turn:<host>:3478` + `TURN_SECRET` (the compose `turn` profile
  runs one with the same secret).

With neither, a free public relay is used — fine for testing, not for real meetings.

### Error tracking

Set `SENTRY_DSN` on the API. Browser crashes are forwarded through the API, so one DSN covers both.

### Restarts and huddles

Live huddle state (notes, polls, whiteboard, roles, transcript) is snapshotted to Redis every few
seconds, so a restart or deploy doesn't wipe a meeting: clients reconnect and the room is restored.
This assumes **one API instance**; running several at once still needs sticky sessions and isn't
supported for huddles yet.
