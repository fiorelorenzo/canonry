# apps/web

Canonry's SvelteKit app: the wiki, the Loremaster copilot, table mode and the
players' wiki. SvelteKit 2 with Svelte 5 (runes), Tailwind 4, `adapter-node`.
See `SPEC.md` and `AGENTS.md` at the repo root for the product and the
conventions; this file only covers running and deploying this package.

## Developing

From the repo root, with `docker/compose.dev.yml` running (`pnpm db:up`):

```sh
pnpm install
pnpm dev
```

The dev server binds `127.0.0.1:5196` (`vite.config.ts`). It talks to Postgres
and Qdrant on the loopback ports `docker/compose.dev.yml` publishes; no
`.env` is required for local dev unless you are also exercising the AI
gateway (see the root `.env.example`).

## Checking

```sh
pnpm check   # svelte-check
pnpm lint    # prettier --check + eslint
pnpm test    # vitest
```

## Building

```sh
pnpm build
```

Output goes to `build/`, an `adapter-node` app: `node build/index.js` runs
it directly, reading configuration from environment variables (below).

## `/healthz`

`GET /healthz` (`src/routes/healthz/+server.ts`) is the liveness/readiness
probe used by `docker/compose.yml`'s healthcheck, the prodbox deploy's health
gate and CI's post-boot check (SPEC.md §12). It pings Postgres through
`@canonry/db`'s `ping()` and Qdrant with a 1.5s-timeout fetch, and never
throws or leaks a connection string, a secret, or a stack trace into the
response body.

- **200**, `status: "ok"` -- Postgres and Qdrant both answer.
- **200**, `status: "degraded"` -- Postgres answers, Qdrant does not. The wiki
  works without vectors; only semantic search and the Loremaster degrade.
- **503**, `status: "down"` -- Postgres does not answer. There is no wiki
  without it.

Body shape in every case:

```json
{ "status": "ok", "version": "0.4.1", "commit": "a1b2c3d", "db": true, "qdrant": true }
```

`version` and `commit` come from the `APP_VERSION` and `APP_COMMIT` build
args baked into the Docker image at build time (`docker/Dockerfile`), not
from the runtime environment -- the whole point is that they cannot drift
from what was actually built.

## Environment variables

Read at runtime, never at build time except `APP_VERSION`/`APP_COMMIT`. See
the root `.env.example` for the full list with fake values; the ones this
package reads directly:

| Variable                                                         | Used for                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                   | Postgres connection string (`@canonry/db`)                                                                                                                                                       |
| `QDRANT_URL`                                                     | Qdrant base URL, also probed by `/healthz`                                                                                                                                                       |
| `ORIGIN`                                                         | the public URL this deployment is served at; SvelteKit checks form POSTs' `Origin` header against it, so behind a reverse proxy this must be the public URL or every form submission answers 403 |
| `PORT`                                                           | port the server binds to                                                                                                                                                                         |
| `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_NAME`, `AI_GATEWAY_API_KEY` | Cloudflare AI Gateway (`@canonry/ai`)                                                                                                                                                            |
| `AI_GATEWAY_BASE_URL`                                            | optional override, for pointing tests at a local fake gateway                                                                                                                                    |

## Deploying

`docker/Dockerfile` builds a production image from the repo root:

```sh
docker build -f docker/Dockerfile \
  --build-arg APP_VERSION=$(git describe --tags --always) \
  --build-arg APP_COMMIT=$(git rev-parse --short HEAD) \
  -t canonry-web .
```

`docker/compose.yml` runs it alongside Postgres and Qdrant, and
`docker/Caddyfile.example` shows the reverse proxy that terminates TLS in
front of it. See `SPEC.md` §12 for the full deploy shape (two isolated
stacks, immutable releases, the health gate).
