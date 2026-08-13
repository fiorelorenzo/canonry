# syntax=docker/dockerfile:1
#
# Multi-stage build for apps/web. Runtime image carries only production
# dependencies plus the adapter-node build output, never the monorepo source,
# devDependencies or the pnpm store.
#
# Build with, from the repo root:
#   docker build -f docker/Dockerfile \
#     --build-arg APP_VERSION=$(git describe --tags --always) \
#     --build-arg APP_COMMIT=$(git rev-parse --short HEAD) \
#     -t canonry-web .

ARG NODE_VERSION=22.22.3

# ---- base: pinned Node + pnpm, nothing else -------------------------------
FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app

# ---- fetch: populate the pnpm content-addressable store from the lockfile
# alone, so this layer only invalidates when the lockfile or workspace config
# change, never on application source changes. pnpm-workspace.yaml has to
# come along too: it carries minimumReleaseAgeExclude, and without it pnpm's
# supply-chain policy check rejects freshly-published entries fetch would
# otherwise happily pull.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ---- build: full workspace install (offline, from the fetched store), then
# build apps/web. @canonry/db and @canonry/ai are source-exported TypeScript
# workspace packages, so Vite inlines them directly; there is nothing to build
# in them beforehand.
FROM base AS build
COPY --from=fetch /root/.local/share/pnpm/store /root/.local/share/pnpm/store
COPY . .
RUN pnpm install --offline --frozen-lockfile

ARG APP_VERSION=0.0.0-dev
ARG APP_COMMIT=unknown
ENV APP_VERSION=${APP_VERSION} \
	APP_COMMIT=${APP_COMMIT}

RUN pnpm --filter web build

# ---- deploy: prune apps/web to its production dependency graph only. The
# workspace has no inject-workspace-packages config, so --legacy is required
# for `pnpm deploy` to physically copy workspace dependencies (@canonry/db)
# into the deploy target's own store rather than refusing to run; verified
# the result has no symlinks pointing back outside /deploy.
FROM build AS deploy
RUN pnpm --filter web deploy --prod --legacy /deploy

# ---- runtime: the shipped image -------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
RUN addgroup -S canonry && adduser -S canonry -G canonry
WORKDIR /app

ARG APP_VERSION=0.0.0-dev
ARG APP_COMMIT=unknown
# Baked in at build time, not read from the runtime environment, because the
# deploy health gate (SPEC.md #12) compares the *served* version against the
# artifact that was built, and that comparison is worthless if the version can
# be overridden by whatever .env happens to be mounted at boot.
ENV APP_VERSION=${APP_VERSION} \
	APP_COMMIT=${APP_COMMIT} \
	NODE_ENV=production \
	PORT=5196

COPY --from=deploy --chown=canonry:canonry /deploy/node_modules ./node_modules
COPY --from=build --chown=canonry:canonry /app/apps/web/build ./build
COPY --from=build --chown=canonry:canonry /app/apps/web/package.json ./package.json

USER canonry
EXPOSE 5196
CMD ["node", "build/index.js"]
