# Build from the REPOSITORY ROOT, not this directory:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_SOCKET_URL=https://api.example.com \
#     -t backstages-web .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
WORKDIR /repo

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they are
# build args — setting them at runtime does nothing. An image built for one
# environment cannot be promoted to another; rebuild per environment.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @backstages/shared build \
  && pnpm --filter @backstages/web build

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages/shared /repo/packages/shared
COPY --from=build /repo/apps/web/node_modules /repo/apps/web/node_modules
COPY --from=build /repo/apps/web/.next /repo/apps/web/.next
COPY --from=build /repo/apps/web/package.json /repo/apps/web/package.json
COPY --from=build /repo/apps/web/next.config.mjs /repo/apps/web/next.config.mjs

WORKDIR /repo/apps/web
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
