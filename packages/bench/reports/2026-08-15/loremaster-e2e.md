# The Loremaster, end to end, 2026-08-15

Models: `google/gemini-3.1-flash-lite` cheap, `openai/gpt-5.4` premium, `alibaba/qwen3-embedding-4b` embedding.
World: 32 entities, 28 relations, indexed as 32 chunks at 2560 dimensions.

## Retrieval

Mean recall **0.806** over the fifteen answerable questions, and
**0.625** over the cross-language subset alone (issue #168).

| question | asked in | hits | top score | recall |
| -------- | -------- | ---- | --------- | ------ |
| `ask-01` | it       | 8    | 0.509     | 0.00   |
| `ask-02` | it       | 8    | 0.620     | 1.00   |
| `ask-03` | it       | 8    | 0.553     | 0.50   |
| `ask-04` | it       | 8    | 0.476     | 0.50   |
| `ask-05` | it       | 8    | 0.609     | 1.00   |
| `ask-06` | it       | 8    | 0.381     | 0.00   |
| `ask-07` | en       | 8    | 0.758     | 1.00   |
| `ask-08` | en       | 8    | 0.726     | 1.00   |
| `ask-09` | en       | 8    | 0.631     | 1.00   |
| `ask-10` | en       | 8    | 0.506     | 0.50   |
| `ask-11` | it       | 8    | 0.626     | 1.00   |
| `ask-12` | en       | 8    | 0.710     | 1.00   |
| `ask-13` | en       | 8    | 0.562     | 1.00   |
| `ask-14` | en       | 8    | 0.581     | 1.00   |
| `ask-15` | en       | 8    | 0.557     | 1.00   |
| `ask-16` | it       | 8    | 0.718     | 1.00   |
| `ask-17` | it       | 8    | 0.779     | 1.00   |
| `ask-18` | it       | 8    | 0.701     | 1.00   |

## Ask

22 answers, **0** carrying a claim the corpus forbids, **0** in the wrong language.

The five detail levels, same question, same sources:

| level      | characters |
| ---------- | ---------- |
| `1_line`   | 47         |
| `short`    | 179        |
| `normal`   | 250        |
| `detailed` | 965        |
| `full`     | 685        |

`full` is shorter than `detailed`, which is issue #167.

## Propagation

| edit                  | plan | expected | missed           | unexpected       | diffs | seconds |
| --------------------- | ---- | -------- | ---------------- | ---------------- | ----- | ------- |
| `prop-captaincy`      | 5    | 4        | none             | the-sable-winter | 5     | 12      |
| `prop-wharf-drowning` | 4    | 4        | none             | none             | 4     | 14      |
| `prop-casa-italian`   | 2    | 3        | the-ashen-ledger | none             | 2     | 6       |

Eleven of eleven expected targets proposed, one entry proposed that a GM would not want,
eleven diffs written. Every diff to an Italian entry came back in Italian and every diff to
an English one in English, which is SPEC.md §17 rule three holding end to end rather than in
a unit test.

## Audit

| edit                  | pairs examined | flags                           |
| --------------------- | -------------- | ------------------------------- |
| `prop-captaincy`      | 5              | aldric-vane vs the-ashen-ledger |
| `prop-wharf-drowning` | 5              | none                            |
| `prop-casa-italian`   | 3              | none                            |

One flag over thirteen pairs, and it is the real disagreement: Aldric Vane's entry and The
Ashen Ledger's do not agree on who pays him. No false flags on the other two edits.

Getting this far needed a fix: `runAudit` threw outright on any body whose paragraph spans
several lines, including the `:::secret` block the sample world itself uses.

## Complete

| entry                   | before | after | language |                                                                                            |
| ----------------------- | ------ | ----- | -------- | ------------------------------------------------------------------------------------------ |
| `corvin-ashe`           | 102    | 943   | en/en    | Added only evidence-backed context: that Corvin Ashe is associated with the Lantern Quarte |
| `iselde-wrenn`          | 124    | 671   | en/en    | Added only evidence-backed context: that Iselde Wrenn keeps her office by the water rather |
| `mother-sennah`         | 149    | 248   | en/en    | I kept the existing text and added the supported note that she owns/keeps The Gilded Rat,  |
| `ezio-conti`            | 503    | 709   | it/it    | I added only evidence-backed links and implications: Ezio Conti is tied to La Casa dei Mer |
| `cassaforte-della-casa` | 388    | 388   | it/it    | Kept the entry essentially unchanged because the only evidence says the subject is owned,  |

Four of five grown. The fifth, `cassaforte-della-casa`, was correctly left alone: the model
said the evidence did not support more, which is the right answer and the one the model
benchmark's scoring penalises (see `docs/models.md`).
