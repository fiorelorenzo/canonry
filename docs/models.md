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

`image_model_config` is a second table on a second axis (one active row per *feature*, not
per purpose) and it went the same way: migration 0011 seeded `portrait` and `variants` from
the two model names SPEC.md §9 happens to mention, and left `scene` with no row at all. The
`scene` section near the bottom is that measurement, run on 2026-08-19 against Replicate's
own list prices of that day.

One section near the bottom measures a provider's behaviour rather than a model's quality,
because a retry written against a guessed response shape is a guess with a test suite: the
shape of a throttled ElevenLabs sound generation, captured live on 2026-08-23 for #337 the
same way #334 captured Replicate's, which the `scene` section records in passing.

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

**The `extract` column covers seven documents and none of them is a OneNote page**, which
issue #329 found while re-scoring extraction after a change to `onenote.md`. The reason is
dated rather than deliberate: `KNOWN_PLAYBOOK_IDS` carried no `onenote` entry when this task
was written, so an export fell through to the generic path, which enumerates only `.md` and
`.txt`, and imported nothing. #162 fixed that months before this table was measured and the
task's own comment kept saying otherwise. So 0.839 above is a seven-case number, and nothing
in it moves when a OneNote prompt changes.

`packages/bench` now carries two `onenote` cases, both subpages, whose only expected relation
is the parent/subpage one that the export's folder tree implies rather than its prose. On
2026-08-23, `google/gemini-3.1-flash-lite` against the shipped prompt, three runs of each:
**0.625 to 0.767, and the folder-tree relation found in 5 of 6 runs.** They are not folded
into the table above, because that would silently redefine a column other rows were measured
on; the next full `--purpose cheap` sweep will include them and can restate it.

Two things to read them with. A perfect run cannot score 1.0: the playbook requires proposing
a minimal entity for the parent page and for every page this one links to, and the corpus gold
for a document names only the entities that document is about, so those legitimate proposals
count against precision. And the one run that missed the relation is the same run that
finished in 8 steps rather than 12: on this loop the failure mode is stopping early, not
reading the tree wrongly.

### The 0.839 carries over to OneNote's `.mht` export, and why that is not a new measurement

Issue #592 taught `packages/import` to read OneNote's own Single File Web Page export, and the
obvious next question is what the extract column says about that shape, since the number above
was measured against the folder tree. The answer is that it is the same number, and the reason
is worth writing down rather than re-sweeping for.

`ArchiveSourceReader.openUpload` does not hand a `.mht` to the model. It expands the envelope
into the folder tree the `onenote` playbook already reads, one `.htm` per page plus a sibling
`<page>_files/` folder per embedded resource, and the loop runs on that. So the input the model
sees is a page of OneNote HTML either way, and `packages/import/src/mhtml-fidelity.test.ts`
pins it: two fixtures describe the same three pages with byte-identical prose, one as the
folder tree the third-party tool produces and one as OneNote's own envelope, and every
paragraph of the first is asserted present, word for word, in what `source_read` returns for
the second. Re-running `--task extract` against a `.mht`-rendered corpus would measure the
same reading task twice and report the difference as noise.

**What does change is the parent/subpage rule, and it changes by having nothing to read.** The
`.mht` export carries no hierarchy at all: a whole notebook is its sections' pages concatenated
with no section name, no boundary and no nesting attribute, measured across all four real files
in `docs/corpus-onenote.md`. So a `.mht` produces a flat tree, no page is proposed as a
subpage, and the two `onenote` cases above, which are both subpages and exist precisely to
score that rule, have no `.mht` equivalent. The folder tree stays strictly better for a
notebook whose structure means something, and that is a property of the export format rather
than of any model.

A live comparison of the three formats a GM can get for one page, on the corpus's own
`Storia e Natura del Mondo` through `gemini-3.1-flash-lite`, 2026-08-23, one document each:

| format | playbook | credits | proposals | what it found |
| --- | --- | --- | --- | --- |
| `.mht` | `onenote` | 0.7228 | 4 | the place, the character, the faction he belongs to, and the treatise |
| `.pdf` | `pdf` | 0.4245 | 3 | the place, the character, the treatise |
| `.docx` | `docx` | 0.3046 | 2 | the place, the character |

`.mht` costs the most and returns the most, and it is the only one of the three that picked up
the faction. That is not a clean per-format comparison, because each row runs a different
playbook with a different prompt and a different step budget; it is the comparison a GM
actually experiences, which is what they get for uploading that file. The `.mht` bodies are
also the longest of the three, which is the same ranking read a second way.

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

What issue #279 then measured about the same model, because entity matching now depends on it
too: over a 24-pair labelled corpus of re-export name pairs, cosine separates a true pair from
a false one by 0.059 (mean 0.912 against 0.853), where a character-trigram baseline gets 0.225.
It wins decisively on the case it was added for, a translated name ("the Gilded Rat" against
"Il Ratto Dorato" goes from 0.074 to 0.80), and it has almost nothing to work with on bare
proper nouns otherwise: "Aldric Voss" against "Seraphine Duval", two entities with nothing in
common, scores 0.843. That is the same scale warning as the second finding above, seen from the
matching side, and it is why `EMBEDDING_MATCH_THRESHOLDS` is a separate constant from
`MATCH_THRESHOLDS` rather than the same band reused. Re-derive both with
`pnpm --filter @canonry/bench matching-sweep`. Two runs of that sweep against this model scored
the same pair 0.802 and 0.799, so treat a threshold placed within about 0.01 of an observed
score as noise rather than as a decision.

## `scene`: bytedance/seedream-4 (issue #258)

`image_feature` has three values and `image_model_config` had two rows, so `scene` was
reachable from the type system and dead in the database. This is the measurement that gave it
a row, and it is the first time any image model in this product has been measured rather than
cited. `portrait` and `variants` were still holding whatever migration 0011 seeded when this
section was written; issue #333 has since corrected both of them to the same list prices the
table below reads off, which is the one thing this sweep turned up about models it was not
measuring (migration 0044).

The harness is `packages/bench/src/media/scene.ts`. It runs the product's own
`composePrompt` with the feature the image will really carry, resolves the model out of
`image_model_config` through `resolveImageModel` (rewriting that row per arm, which is
exactly what an admin does at `/admin/models`), and submits through
`ReplicateImageProvider`, so every image below was charged, priced and written to
`model_call` the way a GM's would be. The one deliberate detour around the product is
`generateImages` itself: its similarity cache keys on universe, feature and prompt vector,
so the second arm to ask for "The Cistern Quarter" would have been served the first arm's
picture and the table would have measured nothing.

Six cases, drawn from the same Valdoria Reach the text bench uses, each there for a reason:
`valdoria` (a city) and `the-sable-reach` (a frozen strait, no people in its prose) are the
easy end; `the-gilded-rat` and `the-cistern-quarter` name people in their lead ("Mother
Sennah keeps it", "Sera Voss grew up here"), which is the sentence that turns a place into a
portrait of whoever is standing in it; `il-molo-vecchio` is Italian prose, because SPEC.md
§17 ships Italian; and `the-sable-winter` is an `event`, so one case is a moment rather than
a place.

Three of the four columns are measurable without an opinion. **shape** is the returned
file's own header: 16:9 asked for, within 4 per cent, which is loose enough that a model
rounding to 1344x768 (1.750) counts as obeying and tight enough that 1:1 or 4:3 does not.
**subject** and **adherence** are judged by the same two vision models from different houses
the text tasks use (`openai/gpt-5.4` and `anthropic/claude-opus-4.8`), asked whether the
image is of a place, a moment, a person, an object or nothing legible, and how much of the
entry text it actually shows. A case counts as portrait-shaped only when neither judge saw a
place or a moment, the same both-judges rule `judge.ts` documents. **usable** is the two
judges' yes/no on "would you put this in that entry's body as it stands", out of twelve.

| arm | prompt | shape | subject | adherence | usable | wall ms | predict s | USD/image | EUR/image |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **bytedance/seedream-4** | scene | 6/6 | 6/6 | **0.938** | **12/12** | 12233 | 10.9 | 0.030 | 0.0259 |
| black-forest-labs/flux-1.1-pro | scene | 6/6 | 6/6 | 0.813 | 12/12 | 3299 | 2.5 | 0.040 | 0.0346 |
| black-forest-labs/flux-schnell | scene | 6/6 | 6/6 | 0.771 | 12/12 | 64499 | **3.1** | **0.003** | **0.0026** |
| prunaai/p-image (the `portrait` row) | scene | 6/6 | 6/6 | 0.708 | 12/12 | 2067 | 1.1 | 0.005 | 0.0043 |
| prunaai/p-image, control | portrait | 6/6 | 6/6 | 0.625 | 10/12 | 1865 | 1.1 | 0.005 | 0.0043 |

`wall ms` is the median the bench measured end to end; `predict s` is Replicate's own
`metrics.predict_time` for the same predictions. The two disagree wildly for one model and
the reason is the next section, not the model.

Migration `0042_seed_scene_image_model.sql` writes the row and prices `image.scene` at 4
credits.

**Every candidate honoured 16:9 and every candidate produced a place, so neither of those
separated the field.** That includes the control, which is the finding I did not expect: the
`the-cistern-quarter` prose names three people and p-image still framed a street, with the
portrait prompt, on a 16:9 canvas. So the framing clause is not what stops a scene becoming a
portrait; asking for a wide canvas already does that on this field of models. What the clause
is worth is smaller and real: on the same model it moved adherence from 0.625 to 0.708 and
usable from 10/12 to 12/12, and the case it rescued is `valdoria`, which the portrait prompt
rendered as an aerial shot of a hill fort that both judges scored 0.13 and refused. That is
the whole justification for `SCENE_FRAMING`, stated at its real size.

**seedream-4 wins on the only column that separated anything.** 0.938 against 0.813 for the
next best, over six cases and two judges, and the gap is visible rather than statistical: it
is the only candidate that read the entry text back into the picture, painting "Valdoria" on
a quayside sign and "1247" into the corner of the Sable Winter, and the only one whose
harbour is a fantasy harbour rather than a photograph of motorboats. It also returns
2560x1440 where everything else returns 1344x768, which matters for an image that sits at the
full width of an entry body.

**The two rejected alternatives, with what taking them would have cost.**
`flux-schnell` is ten times cheaper, EUR 0.0026 against EUR 0.0259, and it is already the
`variants` row so adopting it would have needed no new provider relationship at all. What it
costs is 0.167 of adherence, garbled signage where seedream reads back the entry's own
proper nouns, two of six cases rendered as present-day photographs (`il-molo-vecchio` came
back as a marina full of motorboats), and letterboxing that spends part of a 16:9 canvas on
black bars. On ten scene images a month that price difference is EUR 0.23 against EUR 0.026,
which is not a number worth trading a visibly worse picture for. `flux-1.1-pro` is the
opposite trade: EUR 0.0346 an image, the most expensive arm, for 0.125 less adherence than
the model that costs a quarter less, and it decorates two of six with a caption bar of
illegible text.

**The margin is thin and that is a decision, not an oversight.** A credit is EUR 0.01
(`DEFAULT_CREDITS_PER_EUR`), so `image.portrait` at 3 credits sells an EUR 0.0043 image for
EUR 0.03, an 86 per cent margin. A seedream-4 scene costs EUR 0.0259, so 3 credits would sell
it at a 14 per cent margin and `flux-1.1-pro` would sell it at a loss. The migration prices
`image.scene` at **4 credits**, which is the number `image.variants` already uses and gives a
35 per cent margin, and I am recording rather than burying that this is still well under what
every other generated image in the catalogue earns. If that margin has to match
`image.portrait`'s, the answer flips to `flux-schnell` and this table is the reason to ask
first: that is a pricing decision, not a measurement.

### `google/imagen-4-fast` could not be measured at all

It was on the shortlist as the fourth house and never produced an image. Replicate accepted
every prediction and Google then answered `404 Not Found` for
`imagen-4.0-fast-generate-001` on its own Vertex endpoint
(prediction `fjfhvm0pp1rmy0d03e9vkyq6e0`), so the arm failed six for six at zero cost. Not a
content refusal and not a bad candidate, just a model that is currently broken behind
Replicate's proxy. `bytedance/seedream-4` took its place, which is why the field was measured
in two runs rather than one.

### Two things this run found that are not about model choice

**`Prefer: wait` is not enough, and the product was charging for the difference.** Replicate's
synchronous wait held the connection the full 60 seconds for `flux-schnell`, then answered
`202` with `status: "processing"` and `output: null`, while its own
`metrics.total_time` for that same prediction was 3.2 seconds. `generateImage` returned that
prediction happily, `withQuota` read a successful callback and charged 3 credits, and
`ReplicateImageProvider` then threw "returned no image output". Six out of six `flux-schnell`
cases did that, and `flux-schnell` is the model `variants` runs on. `generateImage` now polls
to a terminal state inside the quota callback and throws on anything that is not `succeeded`,
which is what keeps the charge and the image in step; the 64-second wall clock in the table
above is that path being exercised rather than anything about the model.

**Replicate throttles hard below $5 of credit.** 6 predictions a minute with a burst of 1,
which the bench paces around at one submission every 11 seconds. A GM clicking Generate twice
inside ten seconds would meet the same 429 as a failed generation, and the product does not
retry it. Not fixed here.

### What this measures and what it does not

Every arm ran with **no style modifier**, so these are the model's own defaults rather than
what a GM sees: production appends the universe's or the entry's `imagePromptModifier`, and
a house style is exactly the instrument that would pull p-image's photography towards the
rest of the field. The ranking is about which model reads a Valdoria entry and frames it,
with the style held out of it.

Six cases and two judges is enough to separate 0.94 from 0.71 and nowhere near enough to
separate 0.94 from 0.91, and `adherence` is a judged number even though `shape` next to it is
not. One image per case, no seeds fixed, so a case is one sample of a distribution and not a
verdict on it.

## The shape each image is generated at (issue #332)

Which model runs a feature is one decision and what shape it renders is another, and until
#332 the second one was never made: `prunaai/p-image` defaults to `aspect_ratio: "16:9"`,
`ReplicateImageProvider` sent only `prompt` and `num_outputs`, so every portrait this product
ever generated came back a landscape. Measured on the product's own path on 2026-08-19,
before and after: 1344x768 (1.75) with nothing sent, 1216x832 (1.462, p-image rounds to
multiples of 64) asking for 3:2.

The shape now lives on the `image_model_config` row, in `params.aspectRatio` (migration
0045), rather than in code, because an admin swapping a model at /admin/models is exactly the
moment a constant in the provider would go missing. `packages/media/src/aspect-ratio.ts`
carries each model's own `aspect_ratio` enum, read from its Replicate schema, and both the
save and the submission refuse a value the target model does not list rather than letting
Replicate fall back to its default, which is the failure this issue is.

| feature | model | shape | why |
| --- | --- | --- | --- |
| `portrait` | prunaai/p-image | `3:2` | the shape the cover band crops a character and an item to (`COVER_RATIO`, #284) |
| `variants` | black-forest-labs/flux-schnell | `3:2` | four alternates of what `portrait` produces, so it has to match |
| `scene` | bytedance/seedream-4 | `16:9` | measured: every arm of the #258 sweep rendered at 16:9 |

**`portrait`'s 3:2 is a decision and not a measurement, unlike everything else in this file.**
It follows the display: `COVER_RATIO` puts a character and an item at 3/2, a faction at 16/9
and a place, an event and a session at 21/9, so a 3:2 source is exact for the two types whose
picture is a subject and a top-and-bottom crop for the wider four, which is what
`COVER_POSITION` was written for. 16:9 was the opposite, wider than every band but a place's,
so a character's cover lost 14 per cent of its width at the sides and `COVER_POSITION`'s
`center top` for a character could not do anything at all. The tighter shapes #332 floats,
3:4 and 1:1, are a composition question rather than a cropping one and want the judged sweep
that issue describes: at 3:4 a place's 21/9 band keeps 32 per cent of the height, so that
trade needs a number behind it. That sweep is still owed.

## What a throttled ElevenLabs sound generation looks like (issue #337)

`generateImage` retries a Replicate 429 because #334 captured a real one and read
`Retry-After` off it. The audio side had no such capture, so `ElevenLabsAudioProvider`
retried nothing and #337 sat blocked on evidence rather than on code. This is that
evidence, measured on **2026-08-23** against the real `api.elevenlabs.io`, on the same
`payg` account the product runs on.

**The limit is concurrency, not requests per minute, and knowing that first is what made
the probe cheap.** Replicate's 429 came from six prediction creations a minute; ElevenLabs
publishes a per-plan table of simultaneous requests instead
(https://elevenlabs.io/docs/overview/models#concurrency-and-priority), so a paced burst of
the shape that provoked Replicate would have run all day without provoking this one. Two
things in that documentation turned out not to hold here. This account's tier, `payg`, is
not in the table at all: it lists Free, Starter, Creator, Pro, Scale, Business and
Enterprise. And the documented way to read the real number instead of inferring it, the
`current-concurrent-requests` and `maximum-concurrent-requests` response headers, does not
exist on this endpoint: a successful sound generation's
`access-control-expose-headers` names `character-cost` and nothing else. So the wave was
sized at 12 simultaneous requests, which clears every plan in the table except the two
15-slot ones, and the real limit came back in the refusal itself.

**What was requested.** The product's own call, byte for byte, from
`packages/bench/src/media/elevenlabs-throttle.ts`: twelve of these at once, nothing paced.

```
POST https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128
content-type: application/json
xi-api-key: <REDACTED ELEVENLABS_API_KEY>

{"text":"gentle rain falling on leaves","model_id":"eleven_text_to_sound_v2",
 "prompt_influence":0.8,"loop":true,"duration_seconds":5}
```

**What came back.** Four served, eight refused. The refusals arrived in 238-264ms; the
four that were served took 2784-2810ms. This is `request-1`, verbatim, headers and body:

```
HTTP/1.1 429
access-control-allow-headers: *
access-control-allow-methods: POST, PATCH, OPTIONS, DELETE, GET, PUT
access-control-allow-origin: *
access-control-max-age: 600
alt-svc: h3=":443"; ma=2592000
content-encoding: gzip
content-type: application/json
date: Sun, 23 Aug 2026 07:03:10 GMT
server: uvicorn
strict-transport-security: max-age=1800;
transfer-encoding: chunked
vary: Accept-Language, Accept-Encoding
via: 1.1 google
x-region: us-central1
x-trace-id: 332f31193d4ee91902a0cd173439968d

{"detail":{"type":"rate_limit_error","code":"concurrent_limit_exceeded","message":"Too many
concurrent requests. Your current subscription is associated with a maximum of 4 concurrent
requests (running in parallel). This is done such that a single user does not overwhelm our
systems and affect other users negatively. Please upgrade your subscription or contact sales
if you want to increase this limit.","status":"too_many_concurrent_requests","request_id":
"332f31193d4ee91902a0cd173439968d","docs_url":"https://elevenlabs.io/docs/eleven-api/resources/errors#rate-limiting-and-concurrency"}}
```

All eight refusals were identical apart from `x-trace-id`/`request_id`, which are the same
value as each other in every one of them. The successful responses carry
`content-type: audio/mpeg` and `character-cost: 27`, which is the same 27 credits for an
explicit five-second duration that #233 measured.

**The limit is 4, and the product's own semaphore is 3.** `DEFAULT_PROVIDER_CONCURRENCY`
in `packages/media/src/concurrency.ts` has held ElevenLabs at 3 since #70, on the strength
of SPEC.md §8.1's fixture rather than of a measurement, and `generateAmbientPack` renders a
pack's layers one after another. So a single web process cannot throttle itself: it can
hold at most three of the four slots. A 429 in production means something else was using
the account at the same time, and the candidates are the preview and prod stacks sharing
one ElevenLabs account, a bench run, and the ElevenLabs dashboard. That is exactly the case
a retry is for, and it is also why the retry is short.

**Three things this response does not carry, and the retry is written around their
absence.** There is no `Retry-After` header. There is no `retry_after` field, or any other
reset time, in the body. And there is no `current-concurrent-requests` or
`maximum-concurrent-requests` header on the 429 either, so even the position in the queue
is not disclosed. Everything that is knowable about when to try again is knowable only from
the timings above: a refusal costs 240ms and nothing else, and the thing being waited for
is one of the four in-flight generations finishing, which takes about 2.8 seconds.
`ELEVENLABS_THROTTLE_MAX_ATTEMPTS` and `ELEVENLABS_THROTTLE_BASE_DELAY_MS` in
`packages/media/src/audio/provider.ts` are 4 attempts and a jittered 750/1500/3000ms
backoff off the back of that: roughly two generations' worth of draining, and jittered
because eight requests were refused inside the same 30 milliseconds and a fixed schedule
would send all of them back into the same collision. They are chosen numbers, unlike
Replicate's, and the comment on them says so.

**What it cost.** 13 requests over two runs: one on its own first, to find out whether the
concurrency headers existed, then the wave of 12. Five of the 13 produced audio at 27
credits each, so **135 ElevenLabs credits** out of the 10,000 the account gets each month,
and the eight refusals cost nothing at all, carrying no `character-cost` header. In euros
it cost nothing: `AUDIO_MODEL_PARAMS.pricePerProviderCredit` is a measured 0 on this plan,
for the reasons that constant's own comment gives.

```bash
ELEVENLABS_API_KEY=... pnpm --filter @canonry/bench audio-throttle
```

The runner fires one wave and stops, whatever it finds. There is nothing to learn from a
second one: this endpoint discloses no reset semantics to characterise, and a bigger wave
would only buy a more expensive copy of the same body.

## Re-running this

```bash
pnpm --filter @canonry/bench corpus          # render the world into every source format
pnpm --filter @canonry/bench models -- --preflight
pnpm --filter @canonry/bench seed            # seed the world and index it
pnpm --filter @canonry/bench models -- --purpose cheap
pnpm --filter @canonry/bench models -- --purpose premium
pnpm --filter @canonry/bench models -- --purpose multimodal
pnpm --filter @canonry/bench scene-images                       # every arm, 30 images
pnpm --filter @canonry/bench scene-images -- --arm seedream-4   # one arm
```

Needs `AI_GATEWAY_API_KEY`, a live Qdrant, and a `DATABASE_URL` whose name ends in `_bench`
or `_e2e`; the runner refuses anything else, because it writes real proposals, revisions and
`model_call` rows on purpose. `scene-images` additionally needs `REPLICATE_API_TOKEN`, needs
no Qdrant, and spends about EUR 0.65 for a full sweep, so `--arm` exists to avoid re-running
the arms that were fine. The images themselves land in `packages/bench/.data/scene/<arm>/`,
which is gitignored: a run is evidence for one afternoon and the table above is what gets
committed.
