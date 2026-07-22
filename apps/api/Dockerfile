# Build from the REPOSITORY ROOT, not this directory:
#   docker build -f apps/api/Dockerfile -t backstages-api .
# The API depends on packages/shared, so the whole workspace has to be in scope.

# Debian slim rather than alpine: Prisma's query engine wants glibc, and the
# musl workaround is more trouble than the image size saves.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
WORKDIR /repo

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
# Manifests first so this layer caches until a dependency actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# The api postinstall runs `prisma generate`, which needs the schema present.
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @backstages/shared build \
  && pnpm --filter @backstages/api build

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages/shared /repo/packages/shared
COPY --from=build /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/package.json /repo/apps/api/package.json
# Migrations ship with the image so a release step can run `prisma migrate
# deploy` from the same artifact that will serve traffic.
COPY --from=build /repo/apps/api/prisma /repo/apps/api/prisma

WORKDIR /repo/apps/api
USER node
EXPOSE 3001

# Migrations are deliberately NOT run here: with more than one replica every
# container would race to migrate on boot. Run `pnpm prisma:deploy` as a
# separate release step against this image.
CMD ["node", "dist/main.js"]
