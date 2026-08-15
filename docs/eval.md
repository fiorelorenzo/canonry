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
(`missing_in_source`, which nothing ever writes) and #166 (`job_finish`'s redundant
`documentId`, which cost one document four wasted steps out of nine).

What did work, and is worth recording as much as the failures: the review flow end to end
(accept, reject, undo, with `revision.author_kind` landing as `ai_accepted`), the
between-thresholds "ask the user" band firing on real matches at 0.53 and 0.67 similarity,
and the content-hash skip making an unchanged document free on the second run.

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
