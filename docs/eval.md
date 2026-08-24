# Eval harnesses

`packages/eval` holds the two harnesses SPEC.md §14 says have to exist before the
things they measure are built: a corpus of test worlds with expected propagations
(issue #99) and a retrieval gold corpus (issue #63). Neither harness calls a model
or a database. Both take the thing they measure as an injected function, so the
harness can be exercised against a trivial stub today and against the real
candidate selector (issue #49) or the real retriever (issues #57, #58) later
without this package changing.

Run everything with:

```
pnpm --filter @canonry/eval test
```

## Propagation eval (issue #99)

### Corpus format

A `PropagationWorld` (`src/propagation/types.ts`) is a small, self-contained world:

- `entities`: typed entries (`character`, `place`, `faction`, `item`, `event`,
  `session`), each with a slug, a name, optional aliases and a markdown `body`
  using `[[wikilink]]` mentions, the same shape as
  `packages/db/src/seed-fixture.ts`.
- `relations`: `{ from, label, to }` triples using the shipped `relation_type`
  catalogue's labels (`employs`, `located in`, `member of`, and so on).
- `cases`: one per edit. Each case names the edited entity, the entity's body
  after the edit, and the ground truth: `expected` (entity slugs a competent GM
  would want proposed, ordered best-first) and `mustNotPropose` (slugs that would
  be noise if proposed). A `rationale` string explains the call in prose, read by
  a human, not scored.

Three worlds ship in `src/propagation/corpus/`:

- **`valdoria-reach`**: the same twelve entities and nine relations
  `packages/db/src/seed-fixture.ts` seeds, so the corpus and
  `pnpm --filter @canonry/db seed` describe the same world (issue #122 added the last two
  entities, `la-casa-dei-mercanti` and `smugglers-ledger`, real bilingual canon rather than
  lorem ipsum). Duplicated by hand rather than imported, because `@canonry/eval` has no
  dependency on `@canonry/db` and `seed-fixture.ts` does not export its data. If the
  fixture changes, update this file to match. Two of its cases (issue #130) cross the
  English/Italian boundary on purpose - an edit to an English entry whose expected
  propagation is Italian, and the reverse - so cross-language recall is measured in the
  same harness as everything else, not in a separate report.
- **`brackwater-mire`**: a smuggling-toll setting built to stress precision.
  Several entities share a relation path to the edited entity without being
  narratively relevant to a specific edit, which is exactly the false positive a
  graph-only selector produces and a competent GM would not.
- **`thornwick-college`**: an academy setting whose third case is a ground-truth
  judgment call no relation-hop count would produce (an old, embarrassing
  anecdote about a provost's office, not about the provost herself), which is
  what a competent-GM corpus is for rather than a mechanically derived one.

### Adding a case

Add an entry to a world's `cases` array, or a new world file exported from
`src/propagation/corpus/index.ts`. Write `expected` and `mustNotPropose` as if you
were the GM reading the diff, and write the `rationale` first: if you cannot
justify the order or a must-not entry in a sentence, the ground truth is not
solid enough to score against.

### Running the eval and reading the report

```typescript
import { propagationWorlds, runPropagationEval } from '@canonry/eval';

const report = await runPropagationEval(propagationWorlds, mySelector, { cap: 10 });
```

`mySelector` is a `CandidateSelector`: `(ctx: { world, propagationCase }) =>
EntitySlug[]`, an ordered list of proposed entity slugs. `report` is a
`PropagationReport`:

| Field | Meaning |
| --- | --- |
| `meanRecall` | fraction of `expected` slugs found anywhere in the selector's output, averaged over cases |
| `meanRecallAtCap` | the same, but only counting the first `cap` slugs, the ones a GM actually sees under SPEC.md §5.1's ~10-entry cap |
| `meanFalsePositiveRate` | fraction of `mustNotPropose` slugs the selector proposed, averaged over cases - the noise signal |
| `meanOrderingScore` | mean reciprocal rank of each expected slug within the selector's output (0 when absent). This is an MRR-style score: a case with several expected entries cannot score 1.0 even from a perfect selector, since only one entry can occupy rank 1 |
| `totalFalsePositives` | raw count, across every case, useful as a single number to watch across runs |
| `cases` | per-case detail: `worldId`, `caseId`, what was `selected`, and every metric above scoped to that one case |

`report.cases[i].falsePositives` and `falsePositivesAtCap` name the exact slugs
that should not have been proposed, which is what a failing run points you at
first.

Measured against the three shipped worlds (eleven cases total, two of them crossing the
English/Italian boundary): a selector that returns every other entity in the world scores
`meanRecall: 1` but `meanFalsePositiveRate: 1` (47 false positives). A selector that
returns nothing scores `meanRecall: 0` across the board. A selector that returns exactly
the ground truth scores `meanRecall: 1`, `meanRecallAtCap: 1`, `meanFalsePositiveRate: 0`,
`totalFalsePositives: 0`, and `meanOrderingScore: 0.734` (below 1, correctly: several cases
expect more than one entity, and only one can occupy rank 1). `pnpm --filter @canonry/eval
test` runs all three as `test/propagation-runner.test.ts`; the real candidate selector's
own numbers, English and bilingual side by side, are in
`packages/copilot/src/eval.test.ts`.

### Accept-rate metric shape

`src/propagation/accept-rate.ts` implements the shape of SPEC.md §14 metric #1
("accept rate of propagation proposals") and #6 ("acceptance ratio per import,
watched per playbook, not in aggregate"). `proposal.outcome`
(`packages/db/src/schema/proposal.ts`) is the real instrumentation once
something reads it; this module operates on the minimal shape independent of
`@canonry/db` on purpose, so the harness keeps no dependency on the
implementation it will eventually measure:

```typescript
acceptRate(records: { outcome: 'pending' | 'accepted' | 'rejected' | 'superseded' }[]): AcceptRateResult
acceptRateByGroup(records: { outcome; group? }[]): Map<string, AcceptRateResult>
```

`ProposalOutcome` mirrors the real `proposal_outcome` enum exactly, including
`superseded` (a proposal whose target changed underneath it before anyone
decided). `AcceptRateResult.acceptRate` is `accepted / (accepted + rejected)`,
excluding both `pending` and `superseded` from the denominator so an undecided
or moot proposal never silently drags the rate toward zero, and is `null`
rather than `0` when nothing has been decided yet. A caller maps `proposal` rows
into this shape (`group` set to a playbook name, a propagation trigger, or
whatever axis needs watching separately) and this file does not change.

## Retrieval eval (issue #63)

### Corpus format

A `RetrievalCorpus` (`src/retrieval/types.ts`) is a set of `chunks` (`id`,
`entitySlug`, `breadcrumb`, `text`, optional `keywords`, mirroring the Qdrant
payload fields of SPEC.md §11.3) and `questions` (`id`, `question`,
`relevantChunkIds` ordered best-first).

`src/retrieval/corpus/valdoria-reach.ts` builds its chunks by running the
propagation harness's `valdoria-reach` world's entity bodies through
`chunkEntity` (`src/retrieval/corpus/chunk.ts`), a small deterministic splitter
that breaks a body on its `## ` headings, the same way the real chunker would.
This is why the retrieval corpus is real prose rather than lorem ipsum: it reads
the same fixture text a developer already has open in
`packages/db/src/seed-fixture.ts`, chunked once, and eight questions written
against those chunks (`who-keeps-the-gilded-rat`, `why-was-aldric-dismissed`, and
so on).

### Adding a question

Add an entry to `questions` naming the chunk ids (`entitySlug#index`, found by
reading the chunk list or `chunkEntity`'s output) that answer it, most relevant
first. To index a new entity's prose into the corpus, add it to
`propagationValdoriaReach.entities` (or extend `chunks` directly for a
non-propagation source) and run `chunkEntity` over it.

### Running the eval and reading the report

```typescript
import { valdoriaReachRetrieval, runRetrievalEval } from '@canonry/eval';

const report = await runRetrievalEval(valdoriaReachRetrieval, myRetriever, {
	topK: 8, // SPEC.md §11.4
	threshold: 0.5, // SPEC.md §11.4
	thresholdSweep: [0, 0.25, 0.75, 0.9]
});
```

`myRetriever` is a `Retriever`: `(question, corpus) => { chunkId, score }[]`,
every hit it has an opinion about, ranked or not. The runner sorts, applies
`threshold`, and truncates to `topK` itself - both are runner parameters, not
baked into the retriever, precisely so a change to either is a measurement
rather than a code change, per SPEC.md §11.4 ("re-run that eval before changing
the embedding model"). `report` is a `RetrievalReport`:

| Field | Meaning |
| --- | --- |
| `mrr` | mean reciprocal rank of the first relevant chunk, across all questions, after threshold and top-k are applied - the number SPEC.md §11.4 cites as 0.775 on the real 2044-chunk corpus |
| `recallAtK` | for each k in `recallAtKValues` (default `[1, 3, 5, topK]`), the mean fraction of a question's relevant chunks present within its top k thresholded hits |
| `thresholdEffect` | for `threshold` plus every value in `thresholdSweep`: `meanRecallAtTopK` (recall at the configured `topK` under that threshold) and `meanResultCount` (how many hits survive the threshold before the top-k cut). This is what makes "the threshold's effect" a number instead of an argument: raising the threshold shrinks `meanResultCount` and, past some point, `meanRecallAtTopK` |
| `questions` | per-question detail: `rank` (or `null`), `reciprocalRank`, `recallAtK`, `hitCount` |

Measured on the eight-question, twelve-chunk Valdoria Reach corpus: a retriever
that never returns a hit scores `mrr: 0` and every `recallAtK` value `0`. A
retriever that ranks the gold chunks first scores `mrr: 1` and
`recallAtK[8]: 1`. A retriever with no real relevance signal (chunks ranked by
their fixed position rather than by the question) scores `mrr: 0.303`, well
below the perfect retriever, and sweeping its threshold from 0 to 0.9 shrinks
`meanResultCount` from 12 to 2 and `meanRecallAtTopK` from 0.6875 to 0.25,
monotonically. `pnpm --filter @canonry/eval test` runs all of this as
`test/retrieval-runner.test.ts`.

## Cross-lingual retrieval and the embedding model (SPEC.md §17, issue #125)

SPEC.md §17: "an Italian question against an English canon must find the English
chunk, which makes the embedding model a multilingual choice rather than a free one,
and makes cross-lingual retrieval a test rather than a hope."
`packages/indexing/src/cross-lingual-retrieval.test.ts` is that test: against real
Qdrant, it indexes bilingual content and queries across the language boundary in both
directions (Italian query against English content, English query against Italian
content), quoting the actual rank/MRR `hashingEmbedder` (this box's only network-free
vectoriser - no AI Gateway credentials exist here) achieves, next to a same-language
baseline that proves the harness and corpus are not simply broken. It is a **mechanism**
test - "does a chunk's language flow through the payload, does nothing filter on it,
what does today's fallback vectoriser actually return" - never a claim about a real
embedding model's own recall, which nothing on this box can call.

### The model choice

`packages/indexing/src/models.ts` exports `RECOMMENDED_EMBEDDING_MODEL` with the full
reasoning in its doc comment; summarised here:

| Candidate | Provider | Published multilingual evidence | Verdict |
| --- | --- | --- | --- |
| `mistral-embed` | mistral | English-only per Mistral's own docs | disqualified - no multilingual claim exists to check |
| `text-embedding-3-small` | openai | MIRACL avg 44.0% | multilingual, but the weaker of OpenAI's two |
| `text-embedding-3-large` | openai | MIRACL avg 54.9% | strong fallback |
| `gemini-embedding-001` | google | #1 on MTEB Multilingual (task-mean 68.32), ~100 languages | **chosen** |

Candidates are restricted to providers `packages/ai/src/composition.ts`'s
`KNOWN_PROVIDERS` can already construct (anthropic and groq offer no embedding endpoint
at all, so they were never in the running). `google` / `gemini-embedding-001` is
recommended for `model_config`'s `'embedding'` purpose and named, with this same
reasoning, in the admin models panel (`apps/web/src/routes/admin/models/+page.svelte`).

### What is proven and what is not

**Proven** (this box, no credential needed): the indexing pipeline detects and tags
each chunk's own language in the Qdrant payload (`pipeline.test.ts`'s language-tagging
test), nothing in `queryLore`/`scoreLoreHits` filters on that field
(`packages/vector/src/lore.test.ts`, `cross-lingual-retrieval.test.ts`'s second
`describe` block), and today's fallback vectoriser's actual cross-lingual rank/MRR
numbers are measured rather than assumed.

**Not proven, and not proveable here**: MIRACL and MTEB Multilingual are aggregate
scores over many languages; neither publishes an isolated English&harr;Italian pair,
which is exactly the pair this product ships. Confirming `gemini-embedding-001`'s actual
en/it recall requires a live `google` credential, running `retrieval-eval.test.ts` and
`cross-lingual-retrieval.test.ts` with `createGatewayEmbedder` in place of
`hashingEmbedder`, and re-reading the resulting MRR next to the numbers already recorded
above. That live benchmark is the gap this document files, not a claim this document
makes.
## The first live run, 2026-08-15

Everything above measures a harness against a stub, because until 2026-08-15 this box had
no gateway credential. It now has one, and `packages/bench` is the credentialed half:
`packages/eval` stays pure, and the package next to it runs the product's own functions
against a real gateway, a real Postgres and a real Qdrant. Its README describes how; this
section records what the first run found, because several of the numbers contradict what
this document assumed.

### The model choice is no longer a guess

`packages/bench/reports/2026-08-15/` holds the rendered tables this document quotes.

`docs/models.md` is the measurement and the decision. In short: `cheap` moves from
`anthropic/claude-haiku-4.5` to `google/gemini-3.1-flash-lite`, `premium` from
`anthropic/claude-opus-4.8` to `openai/gpt-5.4`, `multimodal` gets its first row ever
(`google/gemini-3.1-flash-lite`), and the estimated text cost of an active user falls from
EUR 10.45 a month to EUR 2.59. `embedding` is unchanged.

### The live cross-lingual number, which this document filed as a gap

Against the real `alibaba/qwen3-embedding-4b`, over a 32-entity bilingual Valdoria Reach,
retrieval mean recall is **0.806**, and over the cross-language subset alone it is
**0.625**. Cross-lingual retrieval works and is measurably worse than same-language, which
is more than "not proven" and less than "fine". Issue #168 carries the finding and what to
do about it, in order: index a universe's own canon at all, re-derive the 0.25 threshold
against a corpus Ask actually queries, then re-measure.

One caveat that matters for reading that number: the corpus chunks one entity into one
chunk, so a question has to beat every other entity in the world on a single whole-body
vector, and top-k 8 of 32 returns a quarter of the world. This is not the 2044-chunk shape
SPEC.md §11.4's own numbers came from.

And one caveat that arrived later: since issue #703 `indexEntity` writes one entity-level
point per entity beside its body chunks, carrying the name, the aliases and the type rather
than any prose. Every retrieval number on this page, and the threshold and top-k
derivations in `packages/indexing/src/retriever.ts`, were measured before those points
existed, so a corpus of N entities now holds N points more than the figure quoted next to
them. Nothing was re-derived on that basis, deliberately: the point of the new points is
that a bodyless entry is findable at all, and what they cost a question a body already
answers is unmeasured. `indexCorpus` reports `entityPoints` separately from `chunks` so the
next re-derivation can say which of the two it is talking about.

### Import, end to end, for the first time

Every source format, three imports each (the export, the same export again, the export a
month later), against the real `GatewayDriver`:

| source | documents | first run | second run | changed run | idempotent |
| --- | --- | --- | --- | --- | --- |
| obsidian | 35 | 121 proposals in 633 s | 82 | 156 | **no** |
| world-anvil | 32 | 105 in 432 s | 77 | 149 | **no** |
| kanka | 7 | 43 in 117 s | 0 | 55 | yes |
| generic | 5 | 31 in 60 s | 0 | 31 | yes |
| docx | 2 | 18 in 32 s | 0 | 29 | yes |
| pdf | 1 | 8 in 10 s | 0 | 12 | yes |
| onenote | 0 | nothing, ever | 0 | 0 | vacuously |

SPEC.md §6.4's acceptance test ("importing the same export twice produces zero changes on
the second run") therefore fails on the two vault-shaped sources, and it fails for the same
reason 58 per cent of all import proposals cannot be accepted: within one job the merge
engine only matches against committed canon, so an entity named in several documents is
proposed as a `create` once per document and the second accept dies on the slug uniqueness
constraint. First-run accept rates: pdf 8/8, docx 14/18, kanka 32/43, generic 19/31,
world-anvil 32/105, obsidian 34/121.

Issues #160 (the duplicates), #161 (the test, and putting it in CI), #162 (OneNote), #163
(`missing_in_source`, which nothing ever writes), #166 (`job_finish`'s redundant
`documentId`, which cost one document four wasted steps out of nine) and #169 (a document
that spent fourteen consecutive steps calling `source_list` with the same argument, which
is why the obsidian runs report `stopped_at_ceiling`).

What did work, and is worth recording as much as the failures: the review flow end to end
(accept, reject, undo, with `revision.author_kind` landing as `ai_accepted`), the
between-thresholds "ask the user" band firing on real matches at 0.53 and 0.67 similarity,
and the content-hash skip making an unchanged document free on the second run.

**Update, 2026-08-16 (issue #178).** The "no" verdict in the idempotency table above was
#160's accept-time crash: a repeated name across documents died on `entity_universe_slug_key`
before a second run ever got the chance to matter. #175 fixed that by folding the repeat
sighting into the job's own still-pending create instead of proposing a duplicate - but the
fold only ever recorded `entity_source_ref` for the *first* document's path, never the
folded-away one's, so the same two vault-shaped sources (obsidian, world-anvil) would still
have failed the second-run check after #175 alone, for a different reason: no crash, but the
folded document re-proposed on every later import forever. #178 gives every folded document
its own `entity_source_ref` row. The table above is left as measured - this box has no
`AI_GATEWAY_*` credential outside a live `packages/bench` run, and none has re-run against
the real gateway since 2026-08-15, so whether obsidian and world-anvil now read "yes" is
unverified, not claimed here.

### The Loremaster, end to end

Also the first time. Three edits through `planPropagation` and `generatePlanDiffs`, the
same three through `runAudit`, five thin entries through `completeEntry`, eighteen questions
plus all five detail levels through `runAsk`:

- **propagation** proposed 11 of 11 expected targets across the three edits, with one
  unexpected entry and one miss, and wrote all 11 diffs;
- **SPEC.md §17 rule three holds end to end**: every diff to an Italian entry came back in
  Italian and every diff to an English one in English, and no Ask answer came back in the
  wrong language;
- **audit** raised one flag over 13 examined pairs, and it was the real disagreement;
- **complete** grew four of five thin entries and correctly declined the fifth, on the
  grounds that the evidence did not support more;
- **no answer, in 22, made a claim its sources did not carry.**

Two defects came out of it. `runAudit` crashed outright on any body whose paragraph spans
several lines, including the `:::secret` block the sample world itself uses, because
`splitIntoSentences` joins a paragraph's lines and `spanOf` then could not find the result
in the body; fixed in this same change, with a regression test that fails without it. And
Ask's `full` answer is 29 per cent shorter than its `detailed` one, which is issue #167.

## Issue #168: the threshold, top-k and cross-language re-derivation, 2026-08-16

The 2026-08-15 entry above filed cross-language recall as a finding and named three
things to do about it in order: index a universe's own canon at all (issue #164, merged
the morning of the 16th), re-derive the threshold and top-k against a corpus Ask actually
queries, then re-measure. This entry is that work.

### The bench now measures what ships

`packages/bench/src/index-canon.ts` was a sixty-line hand-rolled copy of chunk, extract,
embed, upsert, written before issue #164 existed because nothing else indexed a
universe's own canon. It is gone. `packages/bench/src/index-corpus.ts` calls the real
`indexEntity` (`@canonry/indexing`, the same call the canon-save-job worker makes) once
per seeded entity; `prepare.ts` and `e2e/loremaster.ts` both go through it now. Doing this
surfaced a real bug worth recording on its own: `packages/bench/src/corpus/seed.ts`
reseeded entities with a fresh random id on every run, which `indexDataSource` never
noticed but `indexEntity`'s delete-before-upsert does - it deletes a universe's own-canon
points by the *current* run's entity id, so a random id every reseed meant every repeat
run of `seed`, `loremaster-e2e` or `retrieval-sweep` against an already-indexed universe
left the previous run's points orphaned in Qdrant, doubling the corpus a second run
silently measured against (64 points where 32 were seeded, confirmed by scrolling the
collection). `seedWorld` now derives each entity's id deterministically from
`(universeId, slug)`, so a reseed replaces its own prior points instead of shadowing them.
With that fixed, indexing through the real path reproduces the 2026-08-15 numbers exactly
(below) - the migration itself moved nothing, which is the result worth having: the bench
was measuring the real pipeline all along in spirit, and now it does in fact.

### Threshold re-derived: 0.25 to 0.35, top-k left at 8

`pnpm --filter @canonry/bench retrieval-sweep` runs `@canonry/eval`'s `runRetrievalEval`
against the real 32-entity corpus through the live gateway - the corpus Ask actually
queries, not a purpose-built gold set. Sweeping the threshold at the shipped top-k of 8,
over all eighteen `ASK_QUESTIONS`:

| threshold | recall@8 | mean hits admitted (of 32) |
| --- | --- | --- |
| 0.00 - 0.40 | **0.806**, flat | 32.00 -> 6.94 |
| 0.45 | 0.722 | 4.06 |
| 0.50 | 0.611 | 2.17 |
| 0.55 | 0.500 | 1.39 |
| 0.60 | 0.250 | 0.72 |
| 0.65 | 0.194 | 0.44 |

Recall is completely flat from 0 through 0.40: every threshold in that range keeps
exactly the same answers, so 0.25 was costing nothing but also was not the best point
available in the flat range - it only trims a mean of 32 candidates to 24.78. 0.35, one
measured step below where the cliff actually sits (the same margin the 2026-08-15
derivation used, never the tightest point), trims to a mean of 11.50: more than twice the
noise cut, for zero measured recall cost. `packages/indexing/src/retriever.ts`'s
`DEFAULT_THRESHOLD` moves to 0.35; `SPEC.md` §11.4 updated to match.

`DEFAULT_TOP_K` stays at 8, and the sweep is why, not despite it. At threshold 0.25,
recall@k rises with k across the whole corpus: 0.806 at k=8, 0.889 at k=16, 0.944 at
k=24 and 32. Top-k 8 of a 32-chunk world visibly caps recall on *this* corpus. But
raising the shipped default on that basis would mean every real Ask answer, in every
universe of any size, carries twice the sources for a benefit this measurement cannot
show holds anywhere but a 32-chunk toy world - the same reasoning SPEC.md §11.4 already
applies to its own 2044-chunk number not transferring down. `retriever.ts` carries the
full reasoning next to the constant. The right corpus to re-sweep top-k against is one
with own-canon plus an imported wiki source, large enough that top-k 8 is a real fraction
of a real universe rather than a quarter of a 32-entity fixture; that does not exist yet.

### Cross-language re-measured: still 0.625, and now three separate findings instead of one

`pnpm --filter @canonry/bench loremaster-e2e`, full run, real `alibaba/qwen3-embedding-4b`,
the product's own indexing path, threshold 0.35, top-k 8: mean recall **0.806**,
cross-language mean recall **0.625** - unchanged from 2026-08-15's number. The threshold
move was recall-neutral by construction (it sits inside the flat range above), so this is
the expected result, not a surprise, and it rules the threshold out as the explanation.

Breaking the top-k sweep out by language answers the question the 2026-08-15 entry left
open - "is top-k 8 of 32 the reason cross-language is worse":

| top-k | cross-language recall (n=8) | same-language recall (n=10) |
| --- | --- | --- |
| 8 | 0.625 | 0.950 |
| 16 | 0.813 | 0.950 |
| 24 | 0.875 | 1.000 |
| 32 (no cap) | 0.875 | 1.000 |

Two things are true at once here. First, top-k *is* a real part of the story: cross-language
recall rises 0.625 to 0.875 as top-k grows, while same-language only rises 0.950 to
1.000 - the crowding top-k causes on a 32-chunk, one-chunk-per-entity corpus lands
disproportionately on cross-language questions, because a correct cross-language match
tends to rank behind same-language false positives rather than ahead of them. Second, even
with top-k removed entirely (k=32, every candidate above threshold returned), cross-language
recall does not reach 1.000. Two of the eight cross-language question-entity pairs
(`ask-01`, `ask-06`, both Italian questions about English-language content) never surface
their target at any top-k - a floor no amount of top-k or threshold tuning moves, and the
one piece of this that is a genuine embedding-ranking limit rather than a retrieval-parameter
artifact.

**The chunker is not the explanation.** Re-indexed the same corpus at a 100-token chunk
budget instead of the shipped 400 (`chunkWikiPage`'s default), one entity now split into
2-3 chunks instead of always 1, into an isolated collection so the real one was never
touched: 44 chunks instead of 32, and cross-language recall@8 at threshold 0.25 held at
**0.625**, identical to the coarse-chunked number. Aggregate recall@8 actually fell to
0.750 (from 0.806), because finer chunking gives one entity's own chunks more chances to
each occupy a top-k slot, crowding out a *different* relevant entity - the same crowding
effect the top-k sweep above found, now shown to cut against finer chunking rather than
for it on this corpus. `chunkWikiPage`'s 400-token budget is not the reason cross-language
trails same-language here.

### Where this leaves it

Not the threshold (re-derived, moved, recall-neutral by measurement). Not decisively the
chunker (tested at 4x the granularity, no change to the cross-language number, a modest
cost to the aggregate one). Mostly the corpus: a 32-entity world with one chunk per entity
means top-k 8 already returns a quarter of it, and that crowding falls harder on
cross-language matches than same-language ones - real, measured, and expected to shrink on
its own once a universe carries more than 32 chunks. What top-k and the corpus's size
cannot explain is `ask-01` and `ask-06` specifically: two Italian questions whose English
target never ranks above threshold at any top-k, which is either a genuine limit of
`alibaba/qwen3-embedding-4b`'s cross-lingual ranking on this exact question phrasing, or a
property of these two questions rather than the model in general - eight cross-language
question-entity pairs is too few to tell those apart. Settling it needs either a larger
bilingual gold set with more cross-language pairs than this fixture carries, or the
`text-embedding-3-large`/`gemini-embedding-001` comparison issue #168 names as its last
step - not run here, because the gap did not survive to that step in the form the issue
described it: it is now two specific hard questions and a small-corpus top-k effect, not
an eight-question-wide model weakness.

## The re-run, 2026-08-16, after the fixes

Nine of the issues the first run filed were fixed and merged the same night (#160 to #169,
plus #178 which came out of #161's own evidence). I re-ran the import end to end on the
result rather than trusting the PRs, and the numbers are in
`packages/bench/reports/2026-08-16/import-e2e.md`. The two that matter:

**Every import proposal is now acceptable: 165 of 165, against 139 of 326 before.** The
duplicate-create defect is gone, and with it the raw unique violation a GM used to see as a
500. Proposal counts roughly halved, which is the fix rather than a regression: 87 of
obsidian's original 121 were duplicates of entities other documents had already proposed.

**Four of seven sources now pass SPEC.md §6.4's re-import test, and three still fail**:
obsidian at 21 proposals on an identical second import, world-anvil at 48, and onenote,
which now imports at all, at 18. That is no longer the duplicate defect. It is issue #186:
`entity_propose` never validates `sourceRef.path`, so a proposal can name a document it did
not come from, and the `entity_source_ref` row it produces pairs one document's path with
another document's content hash. The skip then cannot fire for either. Five of eight OneNote
refs written on a first import carry a hash belonging to a different document, which is the
measurement in that issue.

The retrieval half was re-measured separately under #168 and is recorded above: the
threshold moved from 0.25 to 0.35 on evidence, and the cross-language gap did not move,
which the sweep attributes mostly to a 32-chunk corpus rather than to the model.

## Issue #278: the same three constants at 2325 chunks, 2026-08-19

Issue #168 left top-k at 8 while its own sweep found recall climbing past it, on one stated
reason: that a 32-chunk corpus makes top-k 8 a quarter of the world, so the climb is an
artefact of the fixture rather than a property of the model. That reason was never checked,
and the issue said so, naming its blocker as the absence of any universe of realistic size.
Issue #257 removed that blocker by landing a real community world in the import formats, so
this entry is the re-run at a size the reasoning can actually be tested against.

### The corpus, and how it was built

A universe that carries both layers, which is what SPEC.md §11.4's numbers govern and what
no previous sweep had:

- **Own canon:** the 32-entity bilingual Valdoria Reach, seeded and indexed through
  `indexEntity` exactly as before. 32 chunks.
- **An imported source:** Valdris, the 78-note CC BY-SA 4.0 community vault issue #257 already
  renders into the import formats (`offendingcommit/valdris`), read off disk by a new
  `WikiClient` (`packages/bench/src/corpus/vault.ts`) and indexed as a real `data_source`
  through `indexDataSource`, into the same per-universe collection. 2293 chunks.

2325 chunks in all, 72 times issue #168's corpus and past SPEC.md §11.4's own 2044-chunk
reference point. The vault goes in through the crawl pipeline rather than the LLM import loop
deliberately: the loop costs about six credits a note (`docs/demo.md` measured 19.37 for
three), which is five hundred credits for this vault, and it produces extracted proposals
rather than indexed prose, which is not the layer this sweep measures. Chunk, extract
metadata, embed, upsert is that layer, and `indexDataSource` is the production path for it.
The markdown is mapped to the wikitext subset `chunkWikiPage` understands (`## Heading` to
`== Heading ==`, links to their labels, fences and pipe tables flattened) so the chunker sees
the section structure the notes actually have; nothing rewrites prose.

The corpus itself stays out of the repo: it is share-alike text and this repo is AGPL-3.0.
`.data/corpus/valdris` is a clone, and the licence review is recorded on the `data_source`
row rather than bypassed, because `requireIndexableDataSource` is issue #61's enforcement
point and the bench has no business going around it.

**The eighteen `ASK_QUESTIONS` and their gold are unchanged**, so every added chunk is pure
competition. That is the design: the question is what 2293 more candidates do to the same
retrieval, not whether a new gold set scores differently.

### How many runs, given the jitter

Cosine scores from this model move by a few thousandths between identical calls, so a
single-run difference can be noise. Seven runs stand behind the tables below: five repeats
that re-embed the eighteen questions against one corpus embedding, and two independent full
corpus embeddings into separate collections (2325 chunks each, `--collection-suffix`).

Every recall and MRR figure inside the flat threshold band is **identical across all seven**,
spread 0.000. Only two points move at all, thresholds 0.45 and 0.50, by 0.028, which is one
gold question-entity pair out of 36 crossing the cutoff. The two corpus embeddings agree to
0.0005 on the gold cosine median (0.47439 against 0.47385) and to 0.2 chunks on every
admitted count. So five repeats was more than enough, and any difference below about 0.03 in
these tables should be read as noise rather than signal.

### Threshold: 0.35 confirmed at 72 times the corpus size

Swept at the shipped top-k, both corpora, same questions:

| threshold | recall, 32 chunks | recall, 2325 chunks | admitted of 2325 | not-gold inside top-k |
| --- | --- | --- | --- | --- |
| 0.00 | 0.806 | 0.750 | 2311.61 | 6.83 |
| 0.20 | 0.806 | 0.750 | 1066.86 | 6.83 |
| 0.25 | 0.806 | 0.750 | 588.97 | 6.83 |
| 0.30 | 0.806 | 0.750 | 270.04 | 6.83 |
| **0.35** | **0.806** | **0.750** | **106.12** | **6.56** |
| 0.40 | 0.806 | 0.750 | 37.06 | 5.72 |
| 0.45 | 0.704 | 0.656 | 10.94 | 3.86 |
| 0.50 | 0.611 | 0.617 | 3.40 | 1.89 |
| 0.60 | 0.250 | 0.250 | 0.72 | 0.33 |

The plateau holds and the cliff has not moved: flat from 0.00 to 0.40, falling from 0.45, at
both sizes. That was the open question and the answer is that a wide low-threshold band is
not a small corpus's luxury. 0.35 keeps a measured step of margin below 0.40, the same
discipline the two earlier derivations used, and stays.

What the measurement does change is what the threshold is *for*. On 32 chunks it decided how
much noise reached an answer. On 2325 it barely touches the window (6.83 not-gold hits at
threshold 0, 6.56 at 0.35) because top-k is doing that work; its job at real size is keeping
the candidate pool sane and staying off the cliff.

### Top-k: 8 to 12, and issue #168's reasoning was wrong

| top-k | recall, 32 chunks | recall, 2325 chunks | same-language | cross-language | own canon in window | indexed in window | not-gold |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 0.694 | 0.667 | 0.850 | 0.438 | 3.00 | 1.00 | 3.00 |
| 8 | 0.806 | 0.750 | 0.850 | 0.625 | 4.89 | 2.83 | 6.56 |
| **12** | **0.861** | **0.806** | **0.950** | 0.625 | 5.90 | 5.10 | 9.78 |
| 16 | 0.861 | 0.806 | 0.950 | 0.625 | 6.56 | 7.39 | 12.72 |
| 24 | 0.861 | 0.806 | 0.950 | 0.625 | 6.94 | 12.11 | 17.83 |
| 32 | 0.861 | 0.833 | 0.950 | 0.688 | 7.83 | 15.67 | 22.22 |
| 64 | 0.861 | 0.861 | 0.950 | 0.750 | 8.99 | 29.38 | 37.03 |

**Recall still climbs past 8 where top-k 8 returns 0.34 per cent of the world instead of a
quarter of it.** Issue #168's reason for inaction does not survive its own test, and I would
rather say that plainly than leave the comment standing: the climb is not a fixture artefact.

12 rather than 16 or 32 because 12 is the last point that buys anything - 16 and 24 buy
exactly nothing at either corpus size - and because it is where the same-language subset
reaches its own ceiling of 0.950, which is the point at which retrieval stops failing on
questions asked in the language their answer is written in. Everything past 12 is
cross-language tail needing k=32 or k=64 to move, at three to five times the sources; that is
the ranking problem the entries above already file, not a top-k one.

The cost, stated rather than buried: the window grows from a mean 7.7 hits to 11.0, of which
not-gold goes from 6.56 to 9.78, so every Ask answer carries about three more sources that do
not answer the question, on top of `ask.ts`'s six own-canon ones. MRR is unmoved (0.641 at
k=8, 0.647 at k=12), so the top of the list is the same list and the four new slots are tail.
The gain is two gold pairs of 36, reproducible with zero spread over seven runs, and thin
enough to name: a judged Ask run showing answer quality flat or worse at 12 would be grounds
to put it back, and that measurement does not exist.

### Keyword boost: 0.03 measured, and the risk it carried does not occur

`KEYWORD_BOOST_PER_MATCH` carried a comment admitting it was unverified with a specific fear:
six matched keywords at 0.03 would be worth 0.18, about the whole relevant-versus-unrelated
separation, so a chunk could win on vocabulary alone. Swept in the same run, at the shipped
top-k and threshold:

| per match | recall | MRR | not-gold in window | promoted into the window | largest boost applied |
| --- | --- | --- | --- | --- | --- |
| 0 (pure cosine) | 0.694 | 0.651 | 6.67 | 0.00 | 0.000 |
| 0.01 | 0.694 | 0.650 | 6.67 | 0.22 | 0.030 |
| 0.02 | 0.750 | 0.646 | 6.56 | 0.61 | 0.060 |
| **0.03** | **0.750** | **0.641** | **6.56** | **0.83** | **0.090** |
| 0.05 | 0.806 | 0.625 | 6.50 | 1.17 | 0.150 |
| 0.08 | 0.778 | 0.618 | 6.56 | 1.94 | 0.240 |
| 0.12 | 0.778 | 0.604 | 6.56 | 2.61 | 0.360 |

Six matches never happened: the most any hit matched was three keywords, so the largest boost
the shipped value ever applied was 0.090 against a gold-versus-other median gap of 0.283 on
this corpus, under a third of the separation. The boost also earns its place rather than
merely being harmless: 0.03 beats pure cosine by 0.056 recall for 0.010 of MRR. It stays.

0.05 scores 0.056 more recall again and I am not taking it. Its largest applied boost is
0.150, over half the separation, and the peak is not monotonic (0.08 and 0.12 fall back), so
on 36 gold pairs that step of two pairs is as likely to be this corpus as a real optimum.

One caveat that would reopen it: the match count is bounded by the extractor.
`heuristicExtractor`, which is what `canon-save.ts` and `indexDataSource` actually run, keeps
a chunk's eight most frequent non-stopword terms, and a short question overlaps at most three.
`createGatewayExtractor` has no bound on `excerptKeywords` and nothing wires it in production
today; the first deployment that does needs this re-run.

### What this corpus cannot say

The 2293 added chunks are a different world, which makes them weaker competition than more of
the same world: non-gold cosine median falls from 0.3040 on the 32-chunk corpus to 0.1906
here, and the non-gold p99 from 0.5573 to 0.4151, because a question about the Valdoria Watch
sits further from a page on Architect ruins than from another Valdoria entry. So this measures
"a large indexed source does not break the threshold", which was the open question, and does
not measure two thousand chunks of a universe's **own** canon crowding the boundary. That
needs a corpus nobody has.

### `AUDIT_PAIR_CAP`: the cap binds, which is the opposite of what I expected

`pnpm --filter @canonry/bench audit-pairs` runs `findCandidatePairs` uncapped, once per
simulated single-sentence edit and once per whole-entry write, over two worlds. No model call
and no gateway credential: the search is deterministic text matching.

| world | edit | simulated edits | mean | median | p90 | max | no pair at all | more than 5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Valdoria Reach, 32 entries | one sentence | 118 | 3.66 | 3 | 8 | 10 | 10.2% | 22.9% |
| Valdoria Reach, 32 entries | whole entry | 32 | 5.06 | 5 | 8 | 12 | 0.0% | 43.8% |
| Valdris, 78 notes | one sentence | 1394 | 10.90 | 3 | 40 | 71 | 13.9% | 35.6% |
| Valdris, 78 notes | whole entry | 78 | 17.23 | 13 | 45 | 71 | 0.0% | 82.1% |

I expected this to show the cap never binding, which would have made the number moot until
universes grew. It shows the opposite. The cap turns pairs away on 22.9 per cent of
single-sentence edits in the curated 32-entry world and 35.6 per cent in the real 78-note one,
and on most newly written entries. So it is load-bearing today, in both directions: every pair
past it is one more charged `cheap` call, and uncapped the search would average 10.9 calls per
edit on the community world with a tail at 71 against the current ceiling of 5.

That says the number matters. It says nothing about which number is right, and the half that
would - whether a GM's willingness to look at a flag falls off with its position - cannot be
produced offline. So it is instrumented instead: `auditFlagOutcomes` in `packages/db` reads
dismissals by `proposal.rank` off rows that already exist, and `/admin/metrics` grows an
"Audit flags by position" panel that says it has no data rather than drawing a line through
none. `CANONRY_AUDIT_PAIR_CENSUS=1` additionally makes each run report the pairs it could have
examined, off by default. **5 stays until that panel has rows.**

Two caveats on the Valdris numbers. `namesEntityIn` matches a whole phrase
case-insensitively, so a note titled "Social Hierarchy" is named by any body containing that
phrase, which is realistic for a wiki and inflates mentions relative to a world of proper
nouns. And the per-sentence figures sample 20 evenly spaced sentences per entry rather than
all 9768, because one uncapped call over that graph takes about 40 ms and the exhaustive
version is six minutes; the sample size is reported in the table.

### Re-running it

```bash
git clone --depth 1 https://github.com/offendingcommit/valdris .data/corpus/valdris
export DATABASE_URL=postgres://canonry:canonry@127.0.0.1:55432/canonry_bench
pnpm --filter @canonry/bench retrieval-sweep -- --repeats=3                       # 32 chunks
pnpm --filter @canonry/bench retrieval-sweep -- --vault=.data/corpus/valdris --repeats=5
pnpm --filter @canonry/bench audit-pairs -- --vault=.data/corpus/valdris
```

The whole thing cost **0.014 USD** of gateway spend: 2325 chunks embedded twice plus 198
question embeddings. Retrieval measurement is cheap; it was the corpus that was missing, not
the budget.