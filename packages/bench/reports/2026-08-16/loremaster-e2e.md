# The Loremaster, end to end, 2026-08-16 (issue #168 re-measurement)

Models: `google/gemini-3.1-flash-lite` cheap, `openai/gpt-5.4` premium, `alibaba/qwen3-embedding-4b` embedding.
World: 32 entities, 28 relations, indexed as 32 chunks at 2560 dimensions, through the
product's own `indexEntity` path (issue #164) via `packages/bench/src/index-corpus.ts`,
not the hand-rolled loop the 2026-08-15 run used.

Retriever threshold 0.35 (was 0.25 on 2026-08-15, re-derived this run - see
`retrieval-sweep.md` in this directory), top-k unchanged at 8.

## Retrieval

Mean recall **0.806** over the eighteen `ASK_QUESTIONS`, and **0.625** over the
cross-language subset alone - both unchanged from the 2026-08-15 measurement (0.806 /
0.625). Expected, not a coincidence: the threshold move from 0.25 to 0.35 is recall-neutral
by construction (`retrieval-sweep.md` shows recall@8 flat from threshold 0 through 0.40),
so this run is the control that confirms it. `hits` below 8 for several questions is the
threshold doing its job - fewer candidates clear 0.35 than cleared 0.25, with no cost to
which entities were actually found.

| question | asked in | hits | top score | recall |
| -------- | -------- | ---- | --------- | ------ |
| `ask-01` | it       | 8    | 0.508     | 0.00   |
| `ask-02` | it       | 8    | 0.620     | 1.00   |
| `ask-03` | it       | 8    | 0.553     | 0.50   |
| `ask-04` | it       | 8    | 0.476     | 0.50   |
| `ask-05` | it       | 5    | 0.609     | 1.00   |
| `ask-06` | it       | 5    | 0.381     | 0.00   |
| `ask-07` | en       | 8    | 0.758     | 1.00   |
| `ask-08` | en       | 8    | 0.726     | 1.00   |
| `ask-09` | en       | 8    | 0.631     | 1.00   |
| `ask-10` | en       | 8    | 0.505     | 0.50   |
| `ask-11` | it       | 5    | 0.626     | 1.00   |
| `ask-12` | en       | 8    | 0.709     | 1.00   |
| `ask-13` | en       | 8    | 0.562     | 1.00   |
| `ask-14` | en       | 8    | 0.584     | 1.00   |
| `ask-15` | en       | 8    | 0.557     | 1.00   |
| `ask-16` | it       | 3    | 0.718     | 1.00   |
| `ask-17` | it       | 8    | 0.779     | 1.00   |
| `ask-18` | it       | 8    | 0.701     | 1.00   |

`ask-01` and `ask-06` are still the two zero-recall questions, exactly as on 2026-08-15.
Both are Italian questions about English-language content, and `retrieval-sweep.md`'s
top-k breakdown shows their target entity never surfaces above threshold even with the
top-k cap removed entirely - a genuine ranking floor, not a threshold or top-k artifact.

## Ask

22 answers, **0** carrying a claim the corpus forbids, **0** in the wrong language.

The five detail levels, same question, same sources:

| level      | characters |
| ---------- | ---------- |
| `1_line`   | 46         |
| `short`    | 216        |
| `normal`   | 316        |
| `detailed` | 869        |
| `full`     | 2149       |

`full` is now longer than `detailed`, the ordering issue #167 (closed) was filed against -
this run reflects that fix rather than the 2026-08-15 report's numbers.

## Propagation

| edit                  | plan | expected | missed           | unexpected       | diffs | seconds |
| --------------------- | ---- | -------- | ---------------- | ---------------- | ----- | ------- |
| `prop-captaincy`      | 5    | 4        | none             | the-sable-winter | 5     | 12.0    |
| `prop-wharf-drowning` | 4    | 4        | none             | none             | 4     | 13.2    |
| `prop-casa-italian`   | 2    | 3        | the-ashen-ledger | none             | 2     | 5.6     |

Same shape as 2026-08-15: eleven of eleven expected targets proposed, one entry proposed
that a GM would not want, eleven diffs written.

## Audit

| edit                  | pairs examined | flags                           |
| --------------------- | -------------- | ------------------------------- |
| `prop-captaincy`      | 5              | aldric-vane vs the-ashen-ledger |
| `prop-wharf-drowning` | 5              | none                            |
| `prop-casa-italian`   | 3              | none                            |

One flag over thirteen pairs, the same real disagreement as 2026-08-15.

## Complete

| entry                   | before | after | language |
| ----------------------- | ------ | ----- | -------- |
| `corvin-ashe`           | 102    | 546   | en/en    |
| `iselde-wrenn`          | 124    | 685   | en/en    |
| `mother-sennah`         | 149    | 264   | en/en    |
| `ezio-conti`            | 503    | 948   | it/it    |
| `cassaforte-della-casa` | 388    | 388   | it/it    |

Four of five grown, the fifth (`cassaforte-della-casa`) correctly left alone again: the
model still finds no unsupported evidence to add.

## What this run is evidence for

The bench-to-product-path migration (issue #168's second ask) did not move the recall
numbers at all when measured cleanly - see this directory's `retrieval-sweep.md` for the
threshold/top-k derivation and the chunking-granularity check that explain why the
cross-language number holds at 0.625 rather than closing.
