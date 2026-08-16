# Import, end to end, 2026-08-15

Every source format, three imports each: the export, the same export again, and the export a
month later. Real `GatewayDriver`, real merge engine, real proposal rows,
`google/gemini-3.1-flash-lite` on the `cheap` purpose. Numbers read back out of `import_job`
and `proposal` afterwards rather than counted in the runner, so they are what the database
holds.

| source      | docs | first | second | changed | idempotent | first run | tokens in |
| ----------- | ---- | ----- | ------ | ------- | ---------- | --------- | --------- |
| obsidian    | 35   | 121   | 82     | 156     | **no**     | 633 s     | 2 684 421 |
| world-anvil | 32   | 105   | 77     | 149     | **no**     | 432 s     | 1 469 254 |
| kanka       | 7    | 43    | 0      | 55      | yes        | 117 s     | 678 437   |
| generic     | 5    | 31    | 0      | 31      | yes        | 60 s      | 155 481   |
| docx        | 2    | 18    | 0      | 29      | yes        | 32 s      | 100 849   |
| pdf         | 1    | 8     | 0      | 12      | yes        | 10 s      | 12 004    |
| onenote     | 0    | 0     | 0      | 0       | vacuously  | 0 s       | 0         |

SPEC.md §6.4: "importing the same export twice produces zero changes on the second run".
Four of six real sources hold. The two that do not are the two whose documents each name
several entities.

## Accepting what was proposed

| source      | first-run proposals | accepted | refused |
| ----------- | ------------------- | -------- | ------- |
| pdf         | 8                   | 8        | 0       |
| docx        | 18                  | 14       | 4       |
| kanka       | 43                  | 32       | 11      |
| generic     | 31                  | 19       | 12      |
| world-anvil | 105                 | 32       | 73      |
| obsidian    | 121                 | 34       | 87      |
| **total**   | **326**             | **139**  | **187** |

Every refusal is the same raw Postgres error, a unique violation on `entity_universe_slug_key`
or, for relations, a self-loop where two local ids resolved to one entity. Issue #160.

## What worked

- The review path end to end: accept, reject, undo, with `revision.author_kind` landing as
  `ai_accepted` on every accepted proposal (guardrail 2).
- The "ask the user" band of §6.4 firing on real matches rather than guessing: `Il Molo
Vecchio` at similarity 0.53 against one candidate, `Session 5` at 0.67 against four.
- The content-hash skip: an unchanged document costs nothing on the second run (kanka's
  second import: 7 documents, 2 seconds, 0.13 credits).
- Language survived every format: Italian entries produced Italian proposals.

## What did not

Issues #160 (duplicate creates, the big one), #161 (the §6.4 test is not in CI and fails on
two sources), #162 (a OneNote export enumerates zero documents), #163 (`missing_in_source` is
never written, over three imports that deliberately drop two entities), #166 (`job_finish`
cost one document four wasted steps out of nine).

A note on the three obsidian runs marked `stopped_at_ceiling`: all 35 documents were
processed and the credit budget was never touched (62 of 400 credits on the largest run).
The status comes from one or two documents per run reaching their 60-step ceiling, and the
log says why: the model called `source_list` with the same argument fourteen times in a row
and never called `job_finish`. The ceiling is the backstop working, but it fires 52 wasted
model calls late. Issue #169.

## Update, 2026-08-16 (issue #178)

The "idempotent: no" verdict above for obsidian and world-anvil was #160's accept-time
crash on `entity_universe_slug_key` (see "What did not" and the accept table's 187
refusals). #175 fixed the crash by folding a repeat sighting into the job's own
still-pending create instead of proposing a second one - but the fold only ever recorded
`entity_source_ref` for the _first_ document that named the entity, never the ones that
folded into it afterward. Fixed alone, the same two sources would still have failed the
second-run check in this table: no crash, but every folded-away document re-proposed as a
fresh `update` on every later import, forever. #178 gives every folded document its own
`entity_source_ref` row so it is skipped too.

This is not re-measured here: the table, token counts and every other number above are
this run's real measurement against `GatewayDriver` and are left as recorded. Whether
obsidian and world-anvil now read "yes" needs a fresh credentialed run, which this note is
not.
