# Backstages

A team chat platform (Slack-core parity) with an Atlassian integration layer: connect a Jira/Confluence site and every member of that site becomes chattable in Backstages.

## Stack

- **apps/web** — Next.js 14 (App Router), TypeScript, Tailwind, Zustand, TanStack Query, Socket.IO client
- **apps/api** — NestJS, Prisma + PostgreSQL 16, Socket.IO (Redis adapter), BullMQ
- **packages/shared** — Zod schemas, inferred types, socket event contracts (imported by both apps)

## Prerequisites

- Node.js >= 20, pnpm >= 9
- Docker (for PostgreSQL 16 + Redis 7) — or locally running Postgres/Redis matching `apps/api/.env.example`

## Setup

```bash
pnpm install
docker compose up -d                     # PostgreSQL 16 + Redis 7
cp apps/api/.env.example apps/api/.env   # then edit secrets
cp apps/web/.env.example apps/web/.env.local

pnpm --filter @backstages/api prisma:deploy   # apply migrations (Phase 1+)
pnpm --filter @backstages/api seed            # demo workspace (Phase 1+)

pnpm dev:api    # http://localhost:3001
pnpm dev:web    # http://localhost:3000
```

## Verify

```bash
pnpm verify     # build + test all packages
```
