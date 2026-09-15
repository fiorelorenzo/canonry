---
name: canonry-ux-verification
description: Use when verifying a Canonry UI change before calling it done - which routes to walk, how to get a real signed-in session, and this repo's own gotchas beyond the general render-and-check protocol.
metadata:
  version: 1.0.0
  updated: 2026-08-24
  origin: authored
  source: harvested from ~/.omp/agent/memories/--home-dev-projects-personal-canonry--/skills/canonry-ux-verification/SKILL.md
  status: active
---

# Canonry UX verification

The render-and-check protocol (multi-viewport, both palettes, `--axe --fail-on serious`,
real seeded data) is `ui-visual-review`. This is only what's specific to Canonry: which
routes to walk, how to get a session, and gotchas that protocol doesn't know about.

## Routes to walk

GM side, under `/w/[universe]/`: `entries`, `e/[slug]` (+ `edit`, `media`), `table`,
`ask`, `proposals`, `review`, `works`, `import`, `settings` (+ `settings/relations`).
Public side, under `/p/[universe]/`: the players' index and `[slug]` entry pages, plus
`media` and `preview`. A feature that only touches the GM side still needs one player-side
pass when it can affect what `/p/**` renders — guardrail 6 is "nothing unreviewed reaches
players", and that's the surface where a leak would actually show up.

## Session

AGENTS.md's "Working in a worktree" section has the full recipe (demo database, seed,
sign-up, grant `owner`, cookie via `uishot --cookie`). Nothing to add here beyond: use it
rather than inventing a login flow.

## Gotchas

- **AI-off is a per-universe DB column, not an env var.** Guardrail 4 ("the AI switches
  off completely") is `universe.aiEnabled`, toggled from the Settings page (or
  `UPDATE universe SET ai_enabled = false WHERE id = '<id>'` against the worktree's demo
  db). Recheck with it off: every generate/complete control disabled, the `aiOffBanner`
  copy showing, embeddings/search still working (guardrail 4 is about writing, not
  reading — see `runIndexEngine`'s own doc comment in `packages/copilot`).
- **A restored/demo database needs its media folder too.** Media is filesystem-backed,
  one directory per universe and kind under the storage root (`packages/media/src/storage.ts`);
  `media_asset.path` is relative to that root, not a URL. A DB copied without the matching
  files renders entries whose covers/galleries 404 — check the storage root came along
  with any dump used for a screenshot pass, not just the database.
