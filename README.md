# Backstages

A production-quality team chat platform (Slack-core parity) with an Atlassian integration layer:
connect a Jira/Confluence site and **every member of that site becomes chattable in Backstages** —
existing accounts link by verified email, everyone else appears instantly as a provisional member
who activates on their first "Log in with Atlassian".

## Stack

| Package | Contents |
| --- | --- |
| `apps/web` | Next.js 14 (App Router), TypeScript, Tailwind, Zustand, TanStack Query, TipTap, Socket.IO client |
| `apps/api` | NestJS, Prisma + PostgreSQL 16, Socket.IO (`@socket.io/redis-adapter`), Redis, BullMQ |
| `packages/shared` | Zod schemas + inferred types + socket event contracts — imported by both apps, never duplicated |

## Setup

Prerequisites: Node >= 20, pnpm >= 9, Docker (or local PostgreSQL 16 + Redis 7 matching the env files).

```bash
pnpm install
docker compose up -d                          # PostgreSQL 16 + Redis 7
cp apps/api/.env.example apps/api/.env        # then set real secrets
cp apps/web/.env.example apps/web/.env.local

pnpm --filter @backstages/api prisma:deploy   # apply committed migrations
pnpm --filter @backstages/api seed            # demo workspace: 8 users / 6 channels / ~280 messages

pnpm dev:api    # http://localhost:3001
pnpm dev:web    # http://localhost:3000
```

Seed logins: `alice@example.com` … `henry@example.com`, password `password123!`.

## Verify

```bash
pnpm verify   # builds all packages, runs the API integration/e2e suites (jest + supertest
              # + socket.io-client against the real DB/Redis) and the Playwright browser e2e
```

The Playwright suite starts its own servers from the built artifacts. First run:
`pnpm --filter @backstages/web exec playwright install chromium`.

## Feature highlights

- **Auth**: 15-min JWT access + SHA-256-hashed rotating refresh tokens with reuse detection and
  family revocation; password reset via single-use tokens in their own table; per-route rate limits.
- **Authorization**: one fail-closed `PolicyService` gates every channel/DM/message/file/search
  operation; roles verified against the resource's actual workspace; GUESTs see only channels
  they were explicitly added to. Attacked directly by a dedicated test suite.
- **Messaging**: idempotent send pipeline (`clientMsgId`), optimistic UI with retry, single-level
  threads with "also send to channel", reaction toggles, tombstoned deletes, cursor pagination,
  Postgres FTS search (`tsvector` trigger + GIN index) with `from:/in:/before:/after:/has:` modifiers.
- **Realtime**: Socket.IO with JWT handshake, Redis adapter, rooms per user/channel/conversation/
  workspace, wired unread tracking (`lastReadMessageId` → counts → `unread:updated`), typing,
  presence (Redis TTL heartbeats + DND/AWAY overrides), live notifications.
- **Files**: 25MB server-enforced uploads, image previews + lightbox, HMAC-signed download URLs.
- **Atlassian**: OAuth 3LO connect + SSO, encrypted tokens, member directory sync (manual +
  nightly BullMQ), Jira webhooks → personal DMs and per-channel subscribed cards with
  issue-threading and badge dedup, link unfurling, `/jira KEY-123`, create-issue-from-message.
  See [docs/atlassian-setup.md](docs/atlassian-setup.md).

## API conventions

Every response is `{ "data": ..., "error": null }` or `{ "data": null, "error": { code, message } }`.
Validation uses the shared Zod schemas on both client and server. `GET /health` checks DB + Redis.
