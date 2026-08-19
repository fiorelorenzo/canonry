# @canonry/bench

The credentialed half of the evaluation story. `packages/eval` holds the pure harnesses,
which never call a model or a database on purpose; this package is the one that spends real
money against a real gateway, a real Postgres and a real Qdrant, and answers four
questions nothing else in the repo can:

1. **Which model runs which purpose** (`docs/models.md`), measured by running the product's
   own functions with each candidate swapped into `model_config`.
2. **Does an import work end to end**, for every source format SPEC.md §6.6 lists, including
   the re-import guarantees of §6.4.
3. **Does the Loremaster work end to end**: retrieval, ask, propagate, audit, complete.
4. **What a document's steps cost, and where in the resent transcript the money is**
   (`docs/loop-cost.md`, issue #271), measured per step through `GatewayDriver`'s optional
   profiler rather than inferred from a job's total.
5. **Where the decision thresholds actually sit**, for retrieval (`retrieval-sweep`) and for
   entity matching (`matching-sweep`), by scoring the product's own decision functions against
   a labelled corpus instead of choosing a number and defending it afterwards.

Nothing here ships. It is not imported by `apps/web`, and it may not be.

## The corpus

One world, Valdoria Reach, the same one `docs/ux/SAMPLE-WORLD.md` describes and
`packages/db/src/seed-fixture.ts` seeds, extended to 32 entities and 28 relations and
rendered into every source format:

| directory     | playbook    | what it is                                                                                                                                                          |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `obsidian`    | obsidian    | a real vault: `.obsidian/`, notes by type, wikilinks, Dataview inline fields, heading and block links, embeds, plus three notes that are not entities               |
| `kanka`       | kanka       | one JSON file per entity type, HTML entries, a `relations` array and inline `[entity:id]` mentions, one stub record and one private one                             |
| `world-anvil` | world-anvil | a Full World Export: `json/` and `html/`, article templates, drafts, one template that maps onto nothing                                                            |
| `pdf`         | pdf         | an eight-page handout, five pages of text and **three scans with no text layer**: typed, photocopied, handwriting-style                                             |
| `docx`        | docx        | two pandoc-built Word documents, one English and one Italian                                                                                                        |
| `generic`     | generic     | a GM's actual notes: several sessions in one file, a bullet list of NPCs, a rambling place description, a housekeeping file that yields nothing, one file with CRLF |
| `onenote`     | onenote     | a folder tree of exported OneNote pages: `notebook/section/page.htm`, a subpage in a folder named after its parent, an attachment in a sibling `_files/` folder     |

The `reports/2026-08-16/import-e2e.md` run is the last full read of every source through
`import-e2e`: 10 documents and 15 proposals for `onenote`, and re-import came back
non-idempotent for `onenote`, `obsidian` and `world-anvil`. Read that "no" as dated, not
current: the cause it names, `entity_propose` never checking the `sourceRef.path` a model
claims against the document it actually came from (issue #186), was fixed afterwards by
#205. Nobody has re-run `import-e2e` since to confirm the three sources idempotent now.

Every format ships as `v1` and `v2`, where `v2` is the same world exported a month later:
six entries changed at the source, one renamed (`The Gilded Rat` becomes `Il Ratto Dorato`,
the matcher case the sample world names), four new, two gone. `CHANGE_MANIFEST` in
`src/corpus/valdoria-reach.ts` states all of that as data, so a test can assert against it.

Five entries are Italian and two are deliberately half and half, because SPEC.md §17 is a
requirement rather than a nicety and a monolingual fixture cannot test it.

The gold lives in two places: per-document expectations in each renderer's output
(`DocumentExpectation`), and world-level gold in `src/corpus/gold.ts` (twenty labelled audit
pairs, eighteen Ask questions including three that are unanswerable, three propagation edits,
five thin entries).

## Running it

```bash
# once, and after any change to the world or a renderer
pnpm --filter @canonry/bench corpus

# ten seconds, before an hour of benchmark: is every candidate slug reachable, can it
# produce a structured object, can it hold a tool call
pnpm --filter @canonry/bench models -- --preflight

# seeds the bench universe and indexes its canon into Qdrant
pnpm --filter @canonry/bench seed

pnpm --filter @canonry/bench models -- --purpose cheap
pnpm --filter @canonry/bench models -- --purpose premium
pnpm --filter @canonry/bench models -- --purpose multimodal
pnpm --filter @canonry/bench models -- --purpose premium --only openai/gpt-5.4 --task diff

pnpm --filter @canonry/bench import-e2e
pnpm --filter @canonry/bench import-e2e -- --source kanka

pnpm --filter @canonry/bench loremaster-e2e

# re-render a report from results already on disk, free
pnpm --filter @canonry/bench rerender -- .data/models-premium.json premium

# issue #271: per-step transcript cost, one job per document, profiler on
pnpm --filter @canonry/bench loop-cost
pnpm --filter @canonry/bench loop-cost -- --source onenote
pnpm --filter @canonry/bench loop-cost -- --source kanka --documents all

# re-derive MATCH_THRESHOLDS / EMBEDDING_MATCH_THRESHOLDS from the labelled corpus. It scores
# four combinations over the same 24 pairs in one process: trigram and cosine, names only and
# names plus the MatchContext issue #310 added, so the before is measured against the same
# model at the same moment rather than remembered from a previous run.
#
# --runs is not a refinement. Cosines from this model move by a few thousandths between calls
# on identical input, and issue #279 came within one run of setting newBelow on the wrong side
# of SPEC.md §6.4's own example. The sweep reports each pair's spread across the runs and
# refuses to recommend a band that jitter could push into or out of an error, so one run
# answers a weaker question than the default nine.
#
# One embedMany call per run, about 2k embedding tokens a run, cheap enough to do on every
# change to the matcher or to the embedding model, which is what SPEC.md §6.4 asks for
pnpm --filter @canonry/bench matching-sweep
pnpm --filter @canonry/bench matching-sweep -- --runs=9

# issue #278: re-derive DEFAULT_TOP_K / DEFAULT_THRESHOLD / KEYWORD_BOOST_PER_MATCH.
# Without --vault it measures the 32-chunk own canon, which is what issue #168 measured.
# With it, a real community world goes in as a second data_source through the crawl
# pipeline first, so the sweep sees a universe of realistic size carrying both retrieval
# layers - clone it yourself, since a CC BY-SA corpus does not belong in an AGPL-3.0 repo:
#   git clone --depth 1 https://github.com/offendingcommit/valdris .data/corpus/valdris
# --repeats re-embeds the questions per repeat and reports the spread, which is how a
# difference is told from this model's few-thousandths run-to-run cosine jitter
pnpm --filter @canonry/bench retrieval-sweep -- --repeats=3
pnpm --filter @canonry/bench retrieval-sweep -- --vault=.data/corpus/valdris --repeats=5

# issue #278: how often AUDIT_PAIR_CAP actually binds. No model call and no gateway
# credential; --vault adds a second, larger world read straight off disk
pnpm --filter @canonry/bench audit-pairs -- --vault=.data/corpus/valdris
```

Everything is written to `.data/`, which is gitignored: a run is evidence for an afternoon,
the conclusion is what gets committed.

## What it needs, and what it refuses

- `AI_GATEWAY_API_KEY`, read from the repo-root `.env`. There is no offline mode and no
  fallback embedder, because a number produced by a stand-in would be a lie about the thing
  it names.
- `DATABASE_URL` **whose database name ends in `_bench` or `_e2e`**. The runner refuses
  anything else and says why: it writes real `model_config`, `proposal`, `revision`,
  `entity` and `model_call` rows, which is the point. `matching-sweep` is the one exception,
  and it earns it by writing nothing at all: it reads `model_config`'s `embedding` row and
  calls the gateway, so a guard against a database it cannot harm would only stop it from
  running. It needs no `QDRANT_URL` either.
- `QDRANT_URL`.
- Gateway credit. The runner checks the balance before each candidate and stops with a
  sentence naming the reason, because the first long run ran out halfway and produced a
  table in which five models scored 0.000 with a 100 per cent failure rate, which looks
  exactly like five models that cannot do the job.

## Three design rules worth keeping

**Run the product's functions, never a copy of their prompts.** `writePlanRationale`,
`judgeStatementPair`, `GatewayDriver`, `writeEntityDiff`, `completeEntry`, `runAsk`,
`ImportJobRunner`. Switching candidate means writing the `model_config` row and clearing the
thirty-second cache, which is what an admin does at `/admin/models`. A benchmark on invented
prompts measures the prompts.

**Score against gold where gold exists, and judge with two judges where it does not.** The
three prose tasks are scored by `openai/gpt-5.4` and `anthropic/claude-opus-4.8`, and a case
is zeroed only when both independently name a claim the context does not support. One judge
is a benchmark of that judge's taste.

**Report the shape of the errors, not only their size.** Two models with the same audit
accuracy can be failing in opposite directions, and only one of those directions makes the
feature unusable.
