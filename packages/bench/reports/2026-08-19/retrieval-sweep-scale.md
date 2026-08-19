# Retrieval defaults at 2325 chunks, 2026-08-19 (issue #278)

`pnpm --filter @canonry/bench retrieval-sweep -- --vault=.data/corpus/valdris --repeats=5`.
Real `alibaba/qwen3-embedding-4b` through the live gateway. The universe carries both
retrieval layers for the first time: 32 chunks of its own canon (32-entity bilingual
Valdoria Reach through `indexEntity`) plus 2293 chunks from a real community world
(Valdris, 78 notes, CC BY-SA 4.0, `offendingcommit/valdris`) indexed as a `data_source`
through `indexDataSource` into the same collection. 2325 chunks at 2560 dimensions, all
eighteen `ASK_QUESTIONS` with their gold unchanged, so every added chunk is competition.

The prose version of all of this, with the reasoning and the caveats, is `docs/eval.md`'s
2026-08-19 entry. This file is the tables.

Cosine scale on this corpus: gold hits median 0.4744 (min 0.2010), everything else median
0.1906, p99 0.4151.

## How many runs

Five repeats re-embedding the questions against one corpus embedding, plus two independent
full corpus embeddings into separate collections. Every recall and MRR figure in the flat
threshold band is identical across all seven; thresholds 0.45 and 0.50 move by 0.028, which
is one gold pair of 36. The two corpus embeddings agree to 0.0005 on the gold cosine median.

## Threshold, at top-k 8 and the shipped boost

| threshold | recall, 32 chunks | recall, 2325 chunks | admitted of 2325 | not-gold inside top-k |
| --------- | ----------------- | ------------------- | ---------------- | --------------------- |
| 0.00      | 0.806             | 0.750               | 2311.61          | 6.83                  |
| 0.05      | 0.806             | 0.750               | 2232.50          | 6.83                  |
| 0.10      | 0.806             | 0.750               | 2012.96          | 6.83                  |
| 0.15      | 0.806             | 0.750               | 1604.49          | 6.83                  |
| 0.20      | 0.806             | 0.750               | 1066.86          | 6.83                  |
| 0.25      | 0.806             | 0.750               | 588.97           | 6.83                  |
| 0.30      | 0.806             | 0.750               | 270.04           | 6.83                  |
| **0.35**  | **0.806**         | **0.750**           | **106.12**       | **6.56**              |
| 0.40      | 0.806             | 0.750               | 37.06            | 5.72                  |
| 0.45      | 0.704             | 0.656               | 10.94            | 3.86                  |
| 0.50      | 0.611             | 0.617               | 3.40             | 1.89                  |
| 0.55      | 0.500             | 0.500               | 1.54             | 0.88                  |
| 0.60      | 0.250             | 0.250               | 0.72             | 0.33                  |
| 0.65      | 0.194             | 0.194               | 0.44             | 0.17                  |
| 0.70      | 0.194             | 0.194               | 0.33             | 0.06                  |
| 0.75      | 0.083             | 0.083               | 0.11             | 0.00                  |

Flat 0.00 to 0.40, cliff from 0.45, at both corpus sizes. `DEFAULT_THRESHOLD` stays 0.35.

## Top-k, at threshold 0.35

| top-k  | recall, 32 chunks | recall, 2325 chunks | MRR   | same-language | cross-language | own canon | indexed | not-gold |
| ------ | ----------------- | ------------------- | ----- | ------------- | -------------- | --------- | ------- | -------- |
| 1      | 0.417             | 0.417               | 0.556 | 0.550         | 0.250          | 0.94      | 0.06    | 0.44     |
| 2      | 0.556             | 0.528               | 0.583 | 0.750         | 0.250          | 1.72      | 0.28    | 1.28     |
| 4      | 0.694             | 0.667               | 0.634 | 0.850         | 0.438          | 3.00      | 1.00    | 3.00     |
| 6      | 0.722             | 0.667               | 0.634 | 0.850         | 0.438          | 4.17      | 1.78    | 4.94     |
| 8      | 0.806             | 0.750               | 0.641 | 0.850         | 0.625          | 4.89      | 2.83    | 6.56     |
| **12** | **0.861**         | **0.806**           | 0.647 | **0.950**     | 0.625          | 5.90      | 5.10    | 9.78     |
| 16     | 0.861             | 0.806               | 0.647 | 0.950         | 0.625          | 6.56      | 7.39    | 12.72    |
| 24     | 0.861             | 0.806               | 0.647 | 0.950         | 0.625          | 6.94      | 12.11   | 17.83    |
| 32     | 0.861             | 0.833               | 0.647 | 0.950         | 0.688          | 7.83      | 15.67   | 22.22    |
| 48     | 0.861             | 0.833               | 0.647 | 0.950         | 0.688          | 8.49      | 23.00   | 30.21    |
| 64     | 0.861             | 0.861               | 0.648 | 0.950         | 0.750          | 8.99      | 29.38   | 37.03    |

Recall climbs past 8 on a corpus where top-k 8 is 0.34 per cent of the world, so issue
#168's "artefact of a 32-chunk fixture" reasoning does not hold. `DEFAULT_TOP_K` moves to
12: the last point that buys anything, and where same-language recall reaches its ceiling.

## Keyword boost, at top-k 8 and threshold 0.35

| per match | recall, 32 chunks | recall, 2325 chunks | MRR   | not-gold | promoted into the window | largest boost applied |
| --------- | ----------------- | ------------------- | ----- | -------- | ------------------------ | --------------------- |
| 0         | 0.750             | 0.694               | 0.651 | 6.67     | 0.00                     | 0.000                 |
| 0.005     | 0.722             | 0.694               | 0.655 | 6.67     | 0.22                     | 0.015                 |
| 0.01      | 0.722             | 0.694               | 0.650 | 6.67     | 0.22                     | 0.030                 |
| 0.02      | 0.806             | 0.750               | 0.646 | 6.56     | 0.61                     | 0.060                 |
| **0.03**  | **0.806**         | **0.750**           | 0.641 | 6.56     | 0.83                     | **0.090**             |
| 0.05      | 0.806             | 0.806               | 0.625 | 6.50     | 1.17                     | 0.150                 |
| 0.08      | 0.806             | 0.778               | 0.618 | 6.56     | 1.94                     | 0.240                 |
| 0.12      | 0.806             | 0.778               | 0.604 | 6.56     | 2.61                     | 0.360                 |

The most any hit matched was three keywords, so the largest boost 0.03 ever applied was
0.090 against a 0.283 gold-versus-other median gap. The six-keyword scenario the constant's
own comment feared does not occur with the extractor that ships.
`KEYWORD_BOOST_PER_MATCH` stays 0.03.

## Audit pair census

`pnpm --filter @canonry/bench audit-pairs -- --vault=.data/corpus/valdris`. No model call,
no gateway credential: `findCandidatePairs` uncapped over two worlds.

| world                      | edit         | simulated edits | mean  | median | p90 | max | no pair | more than 5 |
| -------------------------- | ------------ | --------------- | ----- | ------ | --- | --- | ------- | ----------- |
| Valdoria Reach, 32 entries | one sentence | 118             | 3.66  | 3      | 8   | 10  | 10.2%   | 22.9%       |
| Valdoria Reach, 32 entries | whole entry  | 32              | 5.06  | 5      | 8   | 12  | 0.0%    | 43.8%       |
| Valdris, 78 notes          | one sentence | 1394            | 10.90 | 3      | 40  | 71  | 13.9%   | 35.6%       |
| Valdris, 78 notes          | whole entry  | 78              | 17.23 | 13     | 45  | 71  | 0.0%    | 82.1%       |

The cap binds today, on a quarter to a third of single-sentence edits and most whole-entry
writes. `AUDIT_PAIR_CAP` stays 5, and the reason changes: it is load-bearing rather than
moot, and moving it needs the accept-and-dismiss-by-position data the new `/admin/metrics`
panel collects.

## Spend

0.014 USD across four runs: 2325 chunks embedded twice, 198 question embeddings, and one
four-note smoke run.
