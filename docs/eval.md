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