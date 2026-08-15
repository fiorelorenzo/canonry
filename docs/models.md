# Which model runs which part of Canonry

`model_config` holds one active row per purpose (`packages/db/src/schema/model.ts`), and
until 2026-08-15 nothing had measured any of them. Migration 0024 seeded
`anthropic/claude-haiku-4.5` for `cheap` and `anthropic/claude-opus-4.8` for `premium`
because those were reasonable guesses, and it says so. `multimodal` had no row at all, so
SPEC.md §6.3's `page_image` path failed with `ModelNotConfiguredError` the first time a
scanned page reached it.

This document is the measurement that replaces the guess, and the harness that produced it
is `packages/bench`, so the next person to disagree can re-run it rather than argue.

Prices are the gateway's own list on 2026-08-15, converted at that day's ECB reference rate
(1 EUR = 1.1567 USD), the same rate migration 0024 used.

## The answer

| purpose | was | is | why in one line |
| --- | --- | --- | --- |
| `cheap` | `anthropic/claude-haiku-4.5` | **`google/gemini-3.1-flash-lite`** | scores higher on all three tasks, gets all twenty audit pairs right where the incumbent gets eighteen, and costs a fifth as much |
| `premium` | `anthropic/claude-opus-4.8` | **`openai/gpt-5.4`** | far better at the propagation diff, which is three quarters of the purpose's calls, at a third of the price and half the latency |
| `multimodal` | nothing, so a scanned page threw | **`google/gemini-3.1-flash-lite`** | every current vision model reads a scan; this one is the fastest and cheapest of them and is already the `cheap` row |
| `embedding` | `alibaba/qwen3-embedding-4b` | unchanged | already chosen by measurement, and nothing here re-opens it |

Migration `0028_measured_text_models.sql` writes those rows. The estimated cost of an active
user's text calls falls from EUR 10.45 a month to EUR 2.59.

Both winners are providers `KNOWN_PROVIDERS` already carries, so nothing in
`packages/ai/src/composition.ts` changes. Four candidates were measured from outside that
list on purpose, since evaluating a provider is how it earns a place on it, and none of them
won: `zai/glm-4.7-flash` came eighth of nine on `cheap`, and `zai/glm-4.7`,
`deepseek/deepseek-v4-flash` and `moonshotai/kimi-k2.5` never got past preflight.

## What was measured, and why it is measurable at all

The temptation with a model benchmark is to write fresh prompts for it. That measures the
prompts. Every task below instead runs **the product's own function** with the candidate
swapped into `model_config`, which is exactly what an admin does at `/admin/models`:

| Purpose | Task | What runs | How it is scored |
| --- | --- | --- | --- |
| `cheap` | `rank` | `writePlanRationale` | `@canonry/eval`'s propagation corpus, eleven cases over three worlds plus three of them re-run in Italian, fourteen in all. Recall of the entries a GM wants, minus the noise kept, plus whether the plan came back in the locale it was asked for |
| `cheap` | `audit` | `judgeStatementPair` | twenty labelled statement pairs, ten of which deliberately do **not** disagree. Balanced accuracy |
| `cheap` | `extract` | `GatewayDriver`, the real tool loop | seven documents across four export formats, scored against the corpus's own per-document gold |
| `premium` | `diff` | `writeEntityDiff` | eleven propagated updates, judged |
| `premium` | `complete` | `completeEntry` | five thin entries, judged |
| `premium` | `ask` | `runAsk` | eighteen questions over the indexed corpus, judged, three of them unanswerable on purpose |
| `multimodal` | `page` | `renderPage` plus a vision call | three scanned pages with no text layer, scored on character accuracy against the page the corpus printed and on the entities read off it |

The three prose tasks are scored by **two judges from different houses**
(`openai/gpt-5.4` and `anthropic/claude-opus-4.8`), and a case is zeroed only when **both**
independently name a claim the context does not support. That rule is a correction, not a
softening: the first run zeroed on either judge and the table it produced was a ranking of
how much each model annoyed gpt-5.4, which called an inferential clause an invention on an
answer opus scored four out of four for grounding.

The gold corpus, the world it describes and the exports it renders are
`packages/bench/src/corpus`, one Valdoria Reach rendered into every source format SPEC.md
§6.6 lists, so a run compares formats rather than fictions.

## Five candidates never reached a task

`--preflight` asks every slug for one sentence, one structured object and one tool call
before an hour of benchmark starts. Five could not produce a structured object at all, and
every Loremaster call in this product is a `generateObject`, so that is disqualifying at
any price:

| Candidate | What happened |
| --- | --- |
| `alibaba/qwen3.5-flash` | refuses `json_object` unless the word "json" appears in the messages, which this codebase does not write |
| `deepseek/deepseek-v4-flash` | no object matching the schema |
| `moonshotai/kimi-k2.5` | a response the SDK could not parse |
| `openai/gpt-oss-120b` | no object matching the schema |
| `zai/glm-4.7` | no object matching the schema (its cheap sibling `glm-4.7-flash` passes) |

A sixth, `xai/grok-4.1-fast-non-reasoning`, passed preflight and then failed under load:
every call carrying the eight-tool import surface, and every `generateObject` whose schema
carries a wide `z.enum` of entity ids, came back `GatewayInternalServerError: Bad Request`.
It scored 0.057 on `rank` with thirteen of fourteen cases failing, and zero on six of seven
extraction documents. Preflight's single trivial tool call was not enough to catch it,
which is worth remembering rather than fixing: a three-call preflight cannot stand in for
the real thing.

## `cheap`: google/gemini-3.1-flash-lite

Nine candidates ran the three tasks, 534 model calls' worth of monthly volume priced from
what each actually consumed. `weighted` weights each task by the calls it carries in a month
(extraction 214, audit 240, ranking 80) rather than treating them as equal; on this purpose
the two orderings agree.

| model | rank | audit | extract | mean | weighted | fail % | median ms | EUR / month |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **google/gemini-3.1-flash-lite** | 0.874 | **1.000** | **0.839** | **0.904** | **0.917** | 0 | 6026 | 1.74 |
| anthropic/claude-haiku-4.5 (was active) | 0.848 | 0.900 | 0.825 | 0.858 | 0.862 | 0 | 11851 | 7.84 |
| google/gemini-2.5-flash-lite | 0.870 | 0.800 | 0.820 | 0.830 | 0.819 | 0 | 2580 | **0.35** |
| mistral/mistral-small | 0.873 | 0.850 | 0.738 | 0.821 | 0.809 | 0 | 3468 | 0.90 |
| openai/gpt-4.1-nano | 0.829 | 0.700 | 0.829 | 0.786 | 0.771 | 0 | 5520 | 0.67 |
| openai/gpt-5-nano | 0.864 | 0.700 | 0.742 | 0.769 | 0.741 | 0 | 23537 | 2.61 |
| openai/gpt-5-mini | 0.854 | 0.650 | 0.778 | 0.761 | 0.732 | 0 | 32593 | 6.31 |
| zai/glm-4.7-flash † | 0.838 | 0.600 | 0.648 | 0.695 | 0.655 | 0 | 8082 | 0.60 |
| xai/grok-4.1-fast-non-reasoning | 0.057 | 0.950 | 0.314 | 0.440 | 0.561 | 49 | 917 | 0.14 |

† not in `KNOWN_PROVIDERS`.

**It wins on the task that decides whether the audit is usable at all.** The audit column
hides the number that matters, so here it is unpacked, over ten pairs that disagree and ten
that deliberately do not:

| model | balanced accuracy | false-flag rate | miss rate |
| --- | --- | --- | --- |
| google/gemini-3.1-flash-lite | **1.000** | 0.00 | 0.00 |
| xai/grok-4.1-fast-non-reasoning | 0.950 | 0.00 | 0.10 |
| anthropic/claude-haiku-4.5 | 0.900 | 0.10 | 0.10 |
| mistral/mistral-small | 0.850 | 0.20 | 0.10 |
| google/gemini-2.5-flash-lite | 0.800 | **0.40** | 0.00 |
| openai/gpt-4.1-nano | 0.700 | 0.40 | 0.20 |
| openai/gpt-5-nano | 0.700 | 0.00 | **0.60** |
| openai/gpt-5-mini | 0.650 | 0.00 | **0.70** |
| zai/glm-4.7-flash | 0.600 | **0.70** | 0.10 |

Both error directions ruin the feature and they ruin it differently. A false flag is
SPEC.md §5.1's "the copilot becomes noise" arriving through the audit door, and
`gemini-2.5-flash-lite` produces one on two of every five compatible pairs. A miss is an
audit that never says anything, and both OpenAI small models miss more than half of the
real disagreements, which is worse than not shipping the feature. Only
`gemini-3.1-flash-lite` got all twenty right.

**The cheap alternative is real and I am not taking it.** `gemini-2.5-flash-lite` is five
times cheaper again (EUR 0.35 against EUR 1.74 a month) and two and a half times faster,
and on ranking and extraction the two are within noise. The whole difference is that
40 per cent false-flag rate. EUR 1.39 per active user per month is what removing it costs,
and given SPEC.md §14 makes accept rate the metric that decides whether the copilot is
worth having, that is not a close call. If the audit is ever switched off,
`gemini-2.5-flash-lite` becomes the right answer and this paragraph is the reason.

**The incumbent loses on both axes.** `claude-haiku-4.5` scores lower, costs four and a
half times more, and is twice as slow. Nothing about the previous choice was wrong except
that nobody had measured it.

## `multimodal`: google/gemini-3.1-flash-lite

No row existed. The corpus's PDF carries three pages with no text layer at all, verified
through `packages/import`'s own `extractPdfPageTexts`: a typed sheet photographed at a
slight angle, a second-generation photocopy with speckle and low contrast, and a
handwriting-style note on lined paper.

| model | page | median ms | EUR / month |
| --- | --- | --- | --- |
| anthropic/claude-sonnet-4.6 | 0.781 | 8559 | 0.16 |
| **google/gemini-3.1-flash-lite** | 0.756 | **1933** | **0.01** |
| google/gemini-2.5-flash-lite | 0.755 | 1691 | 0.01 |
| alibaba/qwen3.5-flash | 0.750 | 8826 | 0.01 |
| mistral/ministral-14b | 0.726 | 4389 | 0.01 |
| mistral/pixtral-12b | 0.724 | 4396 | 0.01 |
| anthropic/claude-haiku-4.5 | 0.720 | 4645 | 0.05 |
| google/gemini-3-flash | 0.720 | 19481 | 0.21 |
| openai/gpt-5-mini | 0.713 | 17565 | 0.06 |
| openai/gpt-4.1-nano | 0.690 | 2296 | 0.01 |
| openai/gpt-5-nano | 0.652 | 22878 | 0.03 |
| xai/grok-4.1-fast-non-reasoning | 0.217 | 1599 | 0.01 |

**The honest reading is that this is not a hard task for anything current.** Character
accuracy against the page the corpus printed is 0.94 to 1.00 for every candidate except
grok, which is at 0.28 to 0.76 and cannot be used. What separates the rest is entity
recall, and the spread there is one or two entities on three pages, which is not enough to
rank a field on. So the choice is made on cost and latency among the models that can read a
page, and `gemini-3.1-flash-lite` is the same row the `cheap` purpose already points at,
nine times faster than the top scorer and sixteen times cheaper.

Two caveats stated rather than buried. The scans are machine-typed text photographed and
degraded with CSS, not a phone photo of somebody's actual handwriting, so this measures
"can read a degraded printed page" and not "can read a GM's notebook". And with only three
pages, a 0.03 gap between two rows means nothing.

## `premium`: openai/gpt-5.4

Eleven candidates over three tasks. The `mean` column treats the three as equal; the
`weighted` column weights each by the calls it carries in a month, and on the premium
purpose that is not a detail: `diff` is 190 of 242 calls and `complete` is twelve. The two
columns disagree about the winner, which is exactly why both are printed.

| model | diff | complete | ask | mean | weighted | median ms | EUR / month |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **openai/gpt-5.4** | **0.958** | 0.704 | 0.778 | **0.813** | **0.916** | **2397** | 0.84 |
| xai/grok-4.3 | 0.843 | 0.583 | 0.717 | 0.714 | 0.809 | 8351 | 0.66 |
| openai/gpt-5-mini | 0.848 | 0.408 | 0.719 | 0.658 | 0.805 | 20693 | 0.60 |
| google/gemini-3.1-pro-preview | 0.830 | 0.317 | 0.760 | 0.635 | 0.793 | 18261 | 5.10 |
| google/gemini-3-flash | 0.822 | 0.242 | 0.626 | 0.563 | 0.761 | 13308 | 1.95 |
| anthropic/claude-opus-4.8 (was active) | 0.723 | **0.833** | **0.861** | 0.806 | 0.752 | 4312 | 2.61 |
| openai/gpt-5.2 | 0.601 | 0.642 | 0.767 | 0.670 | 0.630 | 3543 | 0.77 |
| anthropic/claude-sonnet-4.6 | 0.614 | 0.333 | 0.702 | 0.550 | 0.614 | 6144 | 1.21 |
| google/gemini-2.5-flash | 0.576 | 0.204 | 0.677 | 0.486 | 0.574 | 8404 | 0.69 |
| anthropic/claude-haiku-4.5 | 0.326 | 0.608 | 0.637 | 0.524 | 0.391 | 3184 | 0.38 |
| mistral/mistral-large-3 | 0.424 | 0.000 | 0.312 | 0.245 | 0.385 | 4343 | 0.14 |

Nothing failed a call. Every zero above is an output the judges read and scored.

**On the unweighted mean the top two are tied** at 0.813 and 0.806, which is noise on
nineteen judged cases, and they are tied because they are good at different things: gpt-5.4
writes much better propagation diffs, opus-4.8 writes better completions and better Ask
answers. **On the weighted column they are not close**, 0.916 against 0.752, because the
diff is three quarters of the work. gpt-5.4 is also a third of the price and takes 2.4
seconds where opus takes 4.3, and the propagation diff is a thing a GM waits for.

So the choice is gpt-5.4, and the thing to watch is the completion. Opus is 18 points better
at it, `complete` is twelve calls a month, and if that operation ever becomes a headline
feature rather than a corner of the entry screen, this decision is worth re-running with the
weights that reflect it.

**mistral/mistral-large-3 is the row worth reading twice.** It did not fail, it did not time
out, and it scored zero on completion because both judges independently found invented
claims in all five drafts, and one of those drafts answered an Italian entry in English. For
a product whose first guardrail is that the copilot proposes and never invents, that is
disqualifying rather than merely last.

### Two caveats about the judged tasks

**The `complete` task punishes the right answer once.** `cassaforte-della-casa` is an
Italian item with two relations and nothing else, and the best models correctly declined to
grow it: gpt-5.4 returned it nearly unchanged with the summary "kept the entry essentially
unchanged because the only evidence says that". The bench scores a completion that does not
grow at 0.3 of its judged score, because a completion that returns the entry untouched is
usually a non-answer. Here it was the honest one. That single case costs both top models
about four points and it does not change the ranking, but the metric is wrong in that corner
and the next version of the task should ask the judge whether growing was warranted rather
than assuming it was.

**Nineteen judged cases is not many.** Three propagation diffs across eleven target entries,
five completions and eighteen questions. Good enough to separate 0.92 from 0.39; not good
enough to separate 0.81 from 0.80, which is precisely why the weighted column and not the
mean is what the choice rests on.

## `embedding`: unchanged

`alibaba/qwen3-embedding-4b` stays. It was already chosen by measurement rather than guess
(`packages/indexing/src/models.ts`, migration 0025, and the table in `docs/eval.md`), and
nothing here re-opens it. Worth recording that it worked: 32 chunks of the corpus embedded
at 2560 dimensions through the live gateway for EUR 0.00004.

## Re-running this

```bash
pnpm --filter @canonry/bench corpus          # render the world into every source format
pnpm --filter @canonry/bench models -- --preflight
pnpm --filter @canonry/bench seed            # seed the world and index it
pnpm --filter @canonry/bench models -- --purpose cheap
pnpm --filter @canonry/bench models -- --purpose premium
pnpm --filter @canonry/bench models -- --purpose multimodal
```

Needs `AI_GATEWAY_API_KEY`, a live Qdrant, and a `DATABASE_URL` whose name ends in `_bench`
or `_e2e`; the runner refuses anything else, because it writes real proposals, revisions and
`model_call` rows on purpose.
