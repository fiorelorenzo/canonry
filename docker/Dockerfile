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

# Compiled here, in the stage that still has devDependencies, because the `deploy`
# stage below runs `pnpm deploy --prod`, which prunes them: by then tsc is gone and
# `pnpm --filter @canonry/db build` fails with "tsc: not found". The output is what
# the runtime image's migrate entrypoint runs.
RUN pnpm --filter @canonry/db build

# ---- deploy: prune apps/web to its production dependency graph only. The
# workspace has no inject-workspace-packages config, so --legacy is required
# for `pnpm deploy` to physically copy workspace dependencies (@canonry/db)
# into the deploy target's own store rather than refusing to run; verified
# the result has no symlinks pointing back outside /deploy.
FROM build AS deploy
RUN pnpm --filter web deploy --prod --legacy /deploy

# `pnpm --filter web deploy` above prunes @canonry/db's own runtime
# dependencies (drizzle-orm, postgres) away entirely: apps/web's Vite build
# already inlined both into build/server/chunks, so the web image never
# needs them as real node_modules entries. Migrations do need them as real,
# executable code (drizzle's migrator reads .sql files off disk and runs
# them through a live postgres-js connection, so it cannot be a bundled
# Vite chunk). Deploying @canonry/db as its own target, separately, gives a
# self-contained dist/migrate.js plus a real node_modules carrying exactly
# drizzle-orm and postgres alongside it -- copied into the runtime image below
# as ./migrate, entirely separate from ./node_modules so it never perturbs
# web's own dependency resolution.
#
# `dist/` comes from the explicit build in the stage above: `pnpm deploy` copies a
# package, it never runs its lifecycle scripts, so relying on it to compile shipped
# whatever `dist/` the build context happened to carry. That passed locally on a stale
# local `dist/` and failed in CI, where the context is clean, with
# "/deploy-db/dist: not found".
#
# CI=true is required, not decoration: `deploy --prod` re-runs `install --production`,
# which wants to purge the modules directory and refuses to without a TTY
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). A docker build has no TTY.
RUN CI=true pnpm --filter @canonry/db deploy --prod --legacy /deploy-db

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

# Migration entrypoint (compose.deploy.yml's `migrate` service runs
# `node migrate/dist/migrate.js` from this exact image, so the schema a
# release creates and the code that reads it are always the same build).
# dist/, not src/: Node's native TypeScript support refuses to strip types
# for any file whose path resolves under node_modules (drizzle-orm and
# postgres necessarily live there), and there is no reason to carry a type
# stripper into a runtime image when @canonry/db's own `build` already
# compiled this. .sql migration files stay alongside dist/ unmodified --
# migrate.js locates them at `<dirname of this file>/../migrations`, which
# `pnpm deploy`'s layout satisfies without any extra copying.
COPY --from=deploy --chown=canonry:canonry /deploy-db/dist ./migrate/dist
COPY --from=deploy --chown=canonry:canonry /deploy-db/migrations ./migrate/migrations
COPY --from=deploy --chown=canonry:canonry /deploy-db/node_modules ./migrate/node_modules

USER canonry
EXPOSE 5196
CMD ["node", "build/index.js"]
