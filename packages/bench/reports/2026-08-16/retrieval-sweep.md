# Retrieval threshold and top-k sweep, 2026-08-16 (issue #168)

`pnpm --filter @canonry/bench retrieval-sweep`. Real `alibaba/qwen3-embedding-4b` through
the live gateway, 32-entity bilingual Valdoria Reach indexed through the product's own
`indexEntity` path (issue #164), 32 chunks at 2560 dimensions, all eighteen
`ASK_QUESTIONS`. `@canonry/eval`'s `runRetrievalEval` does the sweeping; this file only
wires it to real Qdrant and a real embedded query per question
(`packages/bench/src/retrieval-sweep.ts`).

## Threshold, swept at the shipped top-k of 8

| threshold | recall@8  | mean hits admitted (of 32) |
| --------- | --------- | -------------------------- |
| 0.00      | 0.806     | 32.00                      |
| 0.05      | 0.806     | 32.00                      |
| 0.10      | 0.806     | 31.89                      |
| 0.15      | 0.806     | 31.33                      |
| 0.20      | 0.806     | 29.28                      |
| 0.25      | 0.806     | 24.78                      |
| 0.30      | 0.806     | 17.94                      |
| **0.35**  | **0.806** | **11.50**                  |
| 0.40      | 0.806     | 6.94                       |
| 0.45      | 0.722     | 4.06                       |
| 0.50      | 0.611     | 2.17                       |
| 0.55      | 0.500     | 1.39                       |
| 0.60      | 0.250     | 0.72                       |
| 0.65      | 0.194     | 0.44                       |

Recall is completely flat from 0.00 through 0.40 - the cliff sits between 0.40 and 0.45.
0.25 (the old default) was inside the flat range and cost nothing, but was not the best
point in it: it only trims a mean of 32 candidates down to 24.78. 0.35 - one measured step
below the cliff, the same margin-below-the-edge the original 2026-08-15 derivation used
rather than riding the edge - trims to a mean of 11.50, more than twice the noise cut, for
zero measured recall cost. `packages/indexing/src/retriever.ts`'s `DEFAULT_THRESHOLD` moves
to 0.35 on this basis; `SPEC.md` §11.4 updated to match.

## Top-k, swept at threshold 0.25

| top-k | mrr   | recall@k  | mean hits (constant: threshold-limited) |
| ----- | ----- | --------- | --------------------------------------- |
| 1     | 0.556 | 0.417     | 24.78                                   |
| 2     | 0.611 | 0.556     | 24.78                                   |
| 4     | 0.644 | 0.694     | 24.78                                   |
| 6     | 0.653 | 0.722     | 24.78                                   |
| **8** | 0.660 | **0.806** | 24.78                                   |
| 12    | 0.665 | 0.861     | 24.78                                   |
| 16    | 0.668 | 0.889     | 24.78                                   |
| 24    | 0.668 | 0.944     | 24.78                                   |
| 32    | 0.668 | 0.944     | 24.78                                   |

Recall keeps rising past top-k 8 on this corpus, plateauing at 0.944 from k=24. `retriever.ts`
keeps `DEFAULT_TOP_K` at 8 anyway: this is a 32-chunk corpus, so top-k 8 already returns a
quarter of the whole world, and the effect measured here is a property of that corpus size,
not of the model. Raising the shipped default on the strength of a 32-entity fixture would
double the sources in every real Ask answer, in a universe of any size, for a benefit this
measurement cannot show holds anywhere but here. Full reasoning is in `retriever.ts`'s doc
comment next to the constant.

## Top-k, broken out by language (the question the 2026-08-15 entry left open)

Same sweep, `ASK_QUESTIONS` split into the eight cross-language pairs (an Italian question
whose answer is in English prose, or the reverse) and the ten same-language ones:

| top-k       | cross-language recall (n=8) | same-language recall (n=10) |
| ----------- | --------------------------- | --------------------------- |
| 8           | 0.625                       | 0.950                       |
| 16          | 0.813                       | 0.950                       |
| 24          | 0.875                       | 1.000                       |
| 32 (no cap) | 0.875                       | 1.000                       |

Two findings, not one. Top-k crowding lands harder on cross-language questions: their
recall keeps climbing all the way to k=32 while same-language recall is already at its
ceiling by k=16, because a correct cross-language match tends to rank behind same-language
false positives on a corpus that chunks one entity into one whole-body vector. But even
with the top-k cap removed entirely, cross-language recall does not reach 1.000. Two of
the eight cross-language question-entity pairs (`ask-01`, `ask-06`) never surface their
target at any top-k - a floor no retrieval parameter moves, and the one part of this that
looks like a genuine embedding-ranking limit rather than a parameter artifact.

## Chunking granularity: not the explanation

`pnpm --filter @canonry/bench retrieval-sweep -- --chunk-budget=100` re-indexes the same
corpus at a 100-token chunk budget (`chunkWikiPage`'s shipped default is 400) into an
isolated collection, so the real "Own canon" collection is never touched.

| chunk budget  | chunks | recall@8 (threshold 0.25) | cross-language recall@8 |
| ------------- | ------ | ------------------------- | ----------------------- |
| 400 (shipped) | 32     | 0.806                     | 0.625                   |
| 100           | 44     | 0.750                     | 0.625                   |

Cross-language recall is identical at both granularities. Aggregate recall is _worse_ at
the finer granularity, because splitting an entity into 2-3 chunks gives that entity more
chances to occupy multiple top-k slots with its own content, crowding out a different
relevant entity - the same crowding effect the top-k sweep above found, cutting against
finer chunking here rather than for it. `chunkWikiPage`'s 400-token budget is not why
cross-language trails same-language on this corpus.

## Bottom line

Not the threshold: re-derived, moved from 0.25 to 0.35, recall-neutral by measurement.
Not decisively the chunker: tested at roughly 4x the granularity, no change to the
cross-language number. Mostly the corpus: 32 entities, one chunk each, means top-k 8
already returns a quarter of the world, and that crowding falls harder on cross-language
matches. What the corpus size cannot explain is `ask-01` and `ask-06` specifically, which
stay at zero recall at any top-k - either a real limit of this model's cross-lingual
ranking on these two question phrasings, or a property of these two questions rather than
the model; eight cross-language pairs is too few to tell those apart.
