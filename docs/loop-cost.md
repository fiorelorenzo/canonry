# What a document's steps cost in the import loop

Issue #271 measured two real OneNote jobs whose corpora differed by a factor of five and
whose first document cost the same within six per cent, and filed the finding without a
plan: a document's bill looks like a function of how many steps it took rather than of
what those steps read. It also named the two things nobody had checked. Where in the
resent transcript the tokens actually are, and whether the other playbooks are flat in
the same way.

This document is that measurement. The harness is `packages/bench`'s `loop-cost` runner,
so the next person to disagree can re-run it rather than argue, and the same rule
`docs/models.md` follows applies: every number below comes from running the product's own
loop (`GatewayDriver`, the real playbook, the real tool surface, the real archive reader)
against the built corpus and a live gateway, never from a model of it.

Two full sweeps of the same thirteen documents, 2026-08-19, `google/gemini-3.1-flash-lite`
on the `cheap` purpose, 307 model calls, 1,363,296 input tokens, EUR 0.50 of real spend.

## The answer

| question | answer |
| --- | --- |
| Does a document's bill track its step count or its content? | Its step count. Pooled over both sweeps, credits against model calls is R2 0.874, credits against content characters R2 0.621, and the decisive evidence needs no regression at all: **the same document run twice, byte-identical input, cost 2.5328 and then 1.8426 credits because it took 23 steps and then 18** |
| Where do the resent tokens go? | Into the **system prompt**, not the accumulated tool results. On a healthy OneNote document the playbook prompt, the tool schemas and the opening ask are 3,512 tokens by the provider's own count, re-sent on every single step, **84.6 per cent** of that document's entire input bill; 53.5 per cent across all 26 runs. Prior tool results are 21 to 24 per cent of the last and largest step |
| Are the tool schemas the problem? | No. 964 tokens for OneNote's seven-tool surface, against the 1,050 that `gateway-driver.ts`'s flat `TOOL_DEFINITION_TOKEN_ESTIMATE` of 150 tokens per tool assumes, so the stand-in over-prices them, which is the safe direction for a ceiling |
| Is `onenote` special? | Not in the way #271 guessed. It does not spend closest to its step budget: it used 9 to 12 steps of 60, and the production job's 129,188 input tokens reconcile at 11 to 14 calls, not 60. What is special is that its **fixed block is the largest of the seven playbooks** (3,935 tokens on current `main`, from a 2,928-token system prompt) and it is re-sent on every step |
| Is any playbook's per-document cost proportional to content? | None of them. Among documents that have real work to do, cost is near-flat regardless of size: OneNote's smallest document cost slightly **more** than its largest (0.9743 against 0.8849 credits, for 1.77x less content). The only cheap documents are the ones the model skipped in two steps because they hold nothing |
| Is anything already discounting the resend? | Yes, by accident. Gemini's implicit prompt cache served **53.6 per cent of every input token this sweep spent**, on 49 per cent of calls, covering 83.5 per cent of a call when it fired. `ModelParams` had no cached-input price, so `computeCost` billed all of it at the full input rate. Fixed in #313; the last section of this document is that measurement |

**The fix the numbers point at is deterministic prompt caching of the loop's stable
prefix, plus a cached-input rate in `computeCost`.** Not transcript pruning, which the
next section explains cannot reach most of the money. Filed as #313, built, and measured
with this same harness at the end of this document - where half of it turned out to be
worth exactly what this section predicted and the other half turned out not to be
available at all, for a reason nothing here had checked.

## Where the tokens are, one document at a time

One OneNote page, `Valdoria Reach Campaign/Handouts/La Casa dei Mercanti.htm`, 813
characters of text, nine steps, four entities and three relations proposed. Token columns
are characters divided by four, this repo's own convention (`CHARS_PER_TOKEN_ESTIMATE`);
the last two columns are what the provider itself reported for the same call.

| step | messages | system | tool schemas | user turns | assistant text | tool call args | tool results | est. input | reported input | cache reads |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 2928 | 956 | 43 | 0 | 0 | 0 | 3927 | 3512 | 0 |
| 2 | 3 | 2928 | 956 | 43 | 0 | 117 | 326 | 4370 | 3789 | 0 |
| 3 | 5 | 2928 | 956 | 43 | 0 | 227 | 688 | 4842 | 4060 | 0 |
| 4 | 7 | 2928 | 956 | 43 | 0 | 416 | 801 | 5144 | 4163 | 3545 |
| 5 | 9 | 2928 | 956 | 43 | 0 | 570 | 914 | 5411 | 4234 | 3513 |
| 6 | 11 | 2928 | 956 | 43 | 0 | 718 | 1024 | 5669 | 4302 | 3485 |
| 7 | 13 | 2928 | 956 | 43 | 0 | 878 | 1138 | 5943 | 4376 | 3457 |
| 8 | 15 | 2928 | 956 | 43 | 0 | 1028 | 1248 | 6203 | 4446 | 0 |
| 9 | 17 | 2928 | 956 | 43 | 0 | 1153 | 1356 | 6436 | 4486 | 3421 |

Four things in that table are the whole spike.

**The first three columns never change, and they are most of the bill.** The system prompt,
the tool schemas and the opening ask are the only thing step 1 sends, and the provider
counted that at **3,512 tokens**. Those same bytes go out on all nine steps, so the resend
costs 31,608 of this document's 37,368 reported input tokens: **84.6 per cent**. The
transcript #271 named as the culprit, prior tool calls plus prior tool results, is 2,509
estimated tokens at its largest, and it is at its largest exactly once, on the last step.

**Assistant text is zero on every step.** The model never writes prose in this loop; it
calls tools. So one of the four buckets #271 asked about does not exist in practice, which
is worth knowing before anyone proposes summarising it.

**The accumulated part grows, but it grows slowly and it grows from nothing.** That gives a
hard ceiling on what pruning can do, and it can be stated exactly rather than argued: a
strategy that deleted the whole transcript before every step and re-sent only the fixed
block would pay 9 x 3,512 instead of 37,368, so it would save **15.4 per cent** of this
document. On the other OneNote page, 13.3 to 17.0 per cent across the two sweeps. Across
all 26 runs the same ceiling is 46.5 per cent, and it only gets that high because
`kanka/characters.json` at 37 steps is 68 per cent transcript. That is the best case for
pruning, before any of the risk `gateway-driver.ts`'s own `retryWithSmallerAskMessage`
comment already warns about: slicing a tool-calling transcript can orphan a tool result
whose call got cut, and a real provider rejects that outright.

| document | model calls | reported input | fixed block re-sent | fixed share | pruning ceiling |
| --- | --- | --- | --- | --- | --- |
| onenote `La Casa dei Mercanti.htm` | 9 | 37,368 | 31,608 | 84.6% | 15.4% |
| onenote `The Valdoria Watch.htm` | 11 | 46,555 | 38,632 | 83.0% | 17.0% |
| obsidian `Ezio Conti.md` | 13 | 51,224 | 40,703 | 79.5% | 20.5% |
| world-anvil `the-sable-winter.json` | 9 | 26,213 | 20,952 | 79.9% | 20.1% |
| world-anvil `smugglers-ledger.json` | 9 | 29,353 | 20,943 | 71.3% | 28.7% |
| generic `faction-rumours.txt` | 12 | 28,929 | 20,604 | 71.2% | 28.8% |
| pdf `players-handout.pdf` | 17 | 51,243 | 33,813 | 66.0% | 34.0% |
| docx `guida-del-quartiere.docx` | 14 | 40,835 | 22,456 | 55.0% | 45.0% |
| docx `campaign-brief.docx` | 18 | 76,549 | 28,800 | 37.6% | 62.4% |
| kanka `characters.json` | 37 | 302,134 | 96,940 | 32.1% | 67.9% |
| the three documents the model skipped in two steps | 2 | 3,491 to 6,332 | | 96.2 to 98.8% | 1.2 to 3.8% |
| **all 26 runs pooled** | **307** | **1,363,296** | **729,993** | **53.5%** | **46.5%** |

**The chars-over-four estimate drifts, and it drifts upward with depth.** 3,927 estimated
against 3,512 reported on step 1 is 12 per cent high; 6,436 against 4,486 on step 9 is 43
per cent high, because `JSON.stringify` of a structured message array is much longer than
the tokens it becomes. That is the safe direction for `wouldExceedCeiling`, which is why it
was chosen, and it also means the budget gate gets progressively more pessimistic the deeper
a document runs. Across the sweep the drift is 24 to 68 per cent.

## The fixed block, per playbook

Free to measure, deterministic, no gateway involved. This is the floor a document pays per
step before it has read anything, read off current `main`.

| playbook | system prompt | tool schemas | opening ask | fixed per step | step budget | fixed if a document spends its whole budget |
| --- | --- | --- | --- | --- | --- | --- |
| onenote | 2928 | 964 | 43 | **3935** | 60 | 236,100 |
| obsidian | 2808 | 964 | 35 | 3807 | 60 | 228,420 |
| kanka | 2720 | 964 | 33 | 3717 | 50 | 185,850 |
| world-anvil | 1965 | 964 | 36 | 2965 | 50 | 148,250 |
| pdf | 1464 | 994 | 34 | 2492 | 40 | 99,680 |
| generic | 1186 | 1064 | 34 | 2284 | 40 | 91,360 |
| docx | 1143 | 894 | 34 | 2071 | 40 | 82,840 |

The two sweeps ran just before #295 landed, which took `.default()` and `.optional()` off
four tool fields and so added them to each schema's `required` array: the tool-schema column
is 6 to 8 tokens larger now than in the per-step tables above, 0.2 per cent of a step, and
nothing else moved. The measured tables are left as measured rather than quietly patched.

`onenote` and `obsidian` carry the two longest prompts **and** the two largest step budgets,
which is the real reason #271 surfaced on OneNote rather than anywhere else. Not because
OneNote spends its budget: because every step it does spend is the most expensive step in
the product.

## Is it flat everywhere, or only on OneNote?

Two documents per source, the largest and the smallest the corpus holds for that playbook,
both sweeps averaged.

| source | largest | smallest | content ratio | credit ratio | flat? |
| --- | --- | --- | --- | --- | --- |
| onenote | 813 chars, 0.8849 | 459 chars, 0.9743 | 1.77x | **0.91x** | flat, and inverted |
| world-anvil | 1167 chars, 0.7085 | 457 chars, 0.5906 | 2.55x | 1.20x | flat |
| docx | 8960 chars, 2.1877 | 2944 chars, 1.0550 | 3.04x | 2.07x | partly |
| generic | 932 chars, 0.7509 | 155 chars, 0.0852 | 6.01x | 8.81x | not flat, and the small one is a housekeeping file the model skipped in two steps |
| obsidian | 823 chars, 1.4434 | 140 chars, 0.1442 | 5.88x | 10.01x | not flat, and the small one is a template the model skipped in two steps |
| kanka | 8060 chars, 5.9808 | 368 chars, 0.1255 | 21.9x | 47.7x | not flat, and the small one is a stub the model skipped in two steps |

Read the bottom three rows before concluding OneNote is special. Every cheap document in
this table is a document with **nothing in it**: a `Templates/Character.md`, a `todo.txt`, a
`notes.json` stub. The model reads it, decides there is no canon in it, and finishes in two
steps. Those two steps cost 0.085 to 0.144 credits, which is the price of the fixed block
twice over and nothing else, and their fixed share of the document bill is 94 to 97 per
cent.

Among documents that have real work in them the pattern is the one #271 saw, on every
playbook that has two such documents: near-flat, and on OneNote actually inverted, because
the smaller page happened to take two more steps in one of the two sweeps.

## The evidence that settles it: the same document, twice

Identical bytes, identical playbook, identical model, two sweeps.

| source | document | content | model calls | credits | swing |
| --- | --- | --- | --- | --- | --- |
| docx | `campaign-brief.docx` | 8960 chars | 23 then 18 | 2.5328 then 1.8426 | **1.37x** |
| kanka | `characters.json` | 8060 chars | 30 then 37 | 5.1152 then 6.8464 | 1.34x |
| obsidian | `Characters/Ezio Conti.md` | 823 chars | 17 then 13 | 1.6442 then 1.2425 | 1.32x |
| onenote | `The Valdoria Watch.htm` | 459 chars | 9 then 11 | 0.8590 then 1.0896 | 1.27x |
| world-anvil | `json/the-sable-winter.json` | 457 chars | 8 then 9 | 0.5525 then 0.6287 | 1.14x |
| pdf | `players-handout.pdf` | 1690 chars | 16 then 17 | 1.1803 then 1.2797 | 1.08x |
| generic | `todo.txt` | 155 chars | 2 then 2 | 0.0875 then 0.0828 | 1.06x |
| onenote | `La Casa dei Mercanti.htm` | 813 chars | 9 then 9 | 0.8844 then 0.8854 | 1.00x |
| docx | `guida-del-quartiere.docx` | 2944 chars | 13 then 14 | 1.0581 then 1.0519 | 1.01x |
| world-anvil | `json/smugglers-ledger.json` | 1167 chars | 9 then 9 | 0.7058 then 0.7112 | 1.01x |
| generic | `faction-rumours.txt` | 932 chars | 12 then 12 | 0.7547 then 0.7470 | 1.01x |
| obsidian | `Templates/Character.md` | 140 chars | 2 then 2 | 0.1439 then 0.1444 | 1.00x |
| kanka | `notes.json` | 368 chars | 2 then 2 | 0.1253 then 0.1257 | 1.00x |

Every document whose step count was stable priced within one per cent of itself. Every
document whose step count moved priced in proportion. Content was constant throughout. No
statistic is needed to read that: **step count is the price, and step count is the part
that varies run to run.**

## The correction to #271's own theory

#271's mechanism is right and its emphasis is wrong, and the distinction changes which fix
is worth building.

Right: the loop is stateless, it re-sends everything on every step, and a document's bill
therefore tracks step count rather than distinct bytes read. Confirmed, twice, on all seven
playbooks.

Wrong in three places:

**"onenote is the playbook that spends closest to its 60-step budget most often."** It is
not. Nine to twelve steps of sixty here, and #271's own production figure reconciles the
same way: 129,188 input tokens for one document is 11 to 14 model calls at this playbook's
3,512-token measured floor plus a page body of 6,000 to 9,000 tokens re-sent each time. At
60 steps the fixed block alone would be 235,620 tokens, nearly twice what that job spent in
total. The `stopped_at_ceiling` in that job was the **credit** ceiling, not the step
ceiling, and a lower default step budget would therefore change nothing.

**The accumulated transcript is the minority term on a small document.** By the provider's
own count the fixed block is 83 to 87 per cent of a OneNote document's input bill, so
everything the transcript accumulates over nine or eleven steps is the remaining 13 to 17.
It is the majority term only where a document is large and read early:
`kanka/characters.json` at 8,060 characters and 37 steps is 32 per cent fixed, so 68 per cent
transcript. So the balance flips with document size, and a fix aimed only at the transcript
helps exactly the documents that are already expensive for a legible reason.

**Tool schemas are not the problem, and neither is the estimate that stands in for them.**
964 tokens for OneNote's seven-tool surface against the 1,050 that
`TOOL_DEFINITION_TOKEN_ESTIMATE` assumes, and 1,064 against 1,200 for `generic`, which is the
only playbook enabling all eight. The one place the estimate is wrong is the transcript,
where chars-over-four runs 24 to 68 per cent high and gets worse with depth.

## Which fix, and why that one

**Deterministic prompt caching of the stable prefix, and a cached-input rate in
`computeCost`.** Every step's request is the previous step's request with messages appended:
the prefix is byte-identical by construction, never edited, never re-ordered. That is the
exact shape a provider prompt cache is built for, and it covers the whole resend, the fixed
block and the accumulated transcript alike, where a total transcript purge tops out at 15
per cent on a OneNote document and 46.5 per cent pooled.

It is not a hypothesis. It is already happening by accident: 730,321 of this sweep's
1,363,296 input tokens were served from Gemini's implicit cache, on 49 per cent of calls,
covering 83.5 per cent of a call when it fired. Two things follow.

The product is **billing tokens the provider did not charge full price for**. `ModelParams`
carries `pricePerInputMTok` and no cached-input rate, so `computeCost` prices all 730,321 of
them as fresh input. Credits are overstated, `wouldExceedCeiling` refuses steps the job
could afford, and #261's recalibrated 2.8-credits-per-document estimate is calibrated
against that overstatement.

And the hit rate is **incidental rather than driven**: it fired on 49 per cent of calls,
including a step 8 sandwiched between two hits, because nothing in this codebase asks for a
cache. Making it explicit is a change to how the request is built, not to what the loop
does, so it costs none of the guardrails. (#313 found the second half of that sentence right
and the first half not actionable on this provider: there is no request this codebase can
build that asks Google for a cache, because Google's is implicit and unconditional. See the
last section.)

Sizing it, as a band rather than a number, because the cached-read rate has to come from the
gateway's own price list and not from me: at 25 per cent of the input rate the sweep gets 37
per cent cheaper on today's incidental hit rate and 57 per cent cheaper if every call hits at
the coverage already observed; at 10 per cent, 44 and 69 per cent. Either end is a bigger
lever than anything else on this list. (The real rate is 12 per cent, and repricing this
sweep's own 730,321 cache reads at it takes the pooled bill down 43.0 per cent.)

**Second: fewer model calls.** The bill is calls times the fixed block, so batching is worth
real money and the sweep shows the model already varies by up to 1.37x on identical input.
`STEP_MAX_OUTPUT_TOKENS` was raised to 24,576 on 2026-08-19 for a different reason, so the
room to propose more per turn exists now and the playbooks do not ask for it. The input to
output ratio across this sweep is 62 to 1, so trading output for steps is close to free.

**Third: shorten the two long system prompts.** `onenote` at 2,928 tokens and `obsidian` at
2,808 against `docx` at 1,143 for a playbook doing the same job. A linear saving on every
step of every document, and it is worth doing after caching rather than instead of it,
because a cached prefix makes it much less urgent.

**What the numbers do not support.** Transcript pruning as the primary fix: it cannot reach
the fixed block, which is the majority of a small document's bill, and it carries the
orphaned-tool-result hazard already written down in `gateway-driver.ts`. Tool-result
summarisation: same ceiling, plus a model call of its own to produce each summary. A lower
default step budget: nothing in the sweep came close to its budget, and the production job
#271 measured stopped on credits. A cheaper mid-loop model: `cheap` is already
`gemini-3.1-flash-lite` at USD 0.25 per million input tokens, and `docs/models.md` records
what the one cheaper candidate costs in false flags.

## Caveats worth stating rather than burying

The corpus tops out at 8,960 characters for one document, while the production pages #271
measured are 24,000 to 36,000 characters each. So the flip point between "the fixed block
dominates" and "the resent page body dominates" is measured here at the small end and
projected at the large end. The projection reconciles with #271's own production token count
to within one per cent at 11 to 14 calls, which is the only cross-check available.

Two sweeps of thirteen documents is 26 runs. Enough to separate 1.37x from 1.00x on a
repeated document; not enough to trust the third decimal of any R2 in this file, which is
why the argument rests on the repeatability table and not on the regression.

Wall clock is deliberately absent. The box these ran on had several other agents on it, so
latency here would measure the box.

## What the fix actually bought (issue #313)

Same harness, same two OneNote documents, 2026-08-19, a few hours after the sweeps above.
`pnpm --filter @canonry/bench loop-cost -- --source onenote`, three arms, plus four probes
against the raw gateway. The change is two things: one field on every step's request
(`providerOptions.gateway.caching = 'auto'`, set in `callStep`) and a cached-input rate in
`computeCost`. The second half is worth what the section above predicted. The first half is
worth much less than it predicted, for a reason nothing in the spike had checked.

### There is no cache to ask Google for

`caching: 'auto'` is the only cache control the gateway exposes to an AI SDK caller, and
Vercel's own provider table says what it does: for Anthropic and MiniMax, which cache only
when asked, the gateway inserts `cache_control` breakpoints; for OpenAI, Google and DeepSeek,
which cache implicitly, "no change needed, caching happens automatically" and the request
goes through unmodified. `google/gemini-3.1-flash-lite` is in the second group. So the 49 per
cent hit rate above is not a hit rate this codebase can raise by changing how it builds a
request, and "deterministic rather than a coin flip" was the wrong expectation rather than an
unmet one.

Three measurements say so, and they agree.

**Four arms, interleaved, each with a salted system prompt so no arm can read another's
cache, eight steps each on a 3,953-token prefix that grows like the real loop's:**

| arm | calls after the first that read cache | input tokens served from cache |
| --- | --- | --- |
| control, nothing asked | 4 of 7 | 53.9% |
| `caching: 'auto'` | 5 of 7 | 67.3% |
| `caching: 'auto'` + `order: ['vertex']` | 5 of 7 | 67.3% |
| `caching: 'auto'` + `only: ['vertex']` | 2 of 7 | 26.8% |

Noise, in both directions, which is what a no-op looks like. Pinning the provider does not
help either: every one of those calls was served by `vertex` anyway, so the arm that forbade
the fallback simply removed a fallback.

**The runner itself, four times, and the interesting rows are the third and the fourth:**

| arm | order | calls cached | input served from cache | credits |
| --- | --- | --- | --- | --- |
| no cache control | first, cold | 14 of 24 | 46.2% | 2.4766, old pricing |
| `caching: 'auto'` | second | 23 of 26 | 69.3% | 2.7389, old pricing |
| no cache control again | third | 19 of 21 | 73.3% | 2.1428, old pricing |
| `caching: 'auto'`, cached rate seeded | fourth | 16 of 26 | 47.8% | **1.6800**, against 2.7303 for the same tokens under the old |

Read the second row on its own and the change looks like it took the loop from half its calls
to substantially all of them, which is exactly what #313's acceptance asked for. The third and
fourth rows are why that reading is wrong. With the change reverted and the cache warm from two
prior runs, the same loop gets 19 of 21 and a *higher* coverage than the arm that asked; with
the change back in place on the fourth run it falls to 16 of 26 and 47.8 per cent, near where
the cold arm started. Four draws of 46, 69, 73 and 48 per cent, in that order, is not a warm-up
curve and it is certainly not a lever: it is a provider deciding, per call, whether to serve a
prefix it already holds. The per-step reads say the same thing without the aggregate, and they
say it consistently: when a step hits, the read is a flat 3,300 to 3,640 tokens, which is the
fixed block and nothing else, and the misses are scattered rather than clustered at the start.

The fourth row is also the end-to-end check on the other half of the change. That run is the
only one with `pricePerCachedInputMTok` actually present on the `cheap` row, and the credits the
loop charged itself, 1.6800, match a hand recomputation from the recorded token counts to four
decimal places. Which is the whole point: 38.5 per cent off the same work, from pricing rather
than from asking.

**And on a provider that does need asking, the same field is the whole difference.** Six
steps against `anthropic/claude-haiku-4.5`, the model that held the `cheap` row until
migration 0028 four days ago and whose row 0028 deactivated rather than deleted:

| arm | calls after the first that read cache | input served from cache |
| --- | --- | --- |
| control | 0 of 5 | 0.0% |
| `caching: 'auto'` | 5 of 5 | 97.2% |

Step 1 writes 4,291 tokens; every step after it reads the previous step's whole prompt back
and writes only the 83 to 146 tokens it appended. That is the deterministic behaviour the
spike wanted, it is what this loop's append-only shape deserves, and on Anthropic the loop got
precisely none of it before this change. That is why the field is set unconditionally rather
than gated on the active row: `model_config` is switchable from `/admin/models` without a
deploy, so the loop must not depend on which provider it happens to be pointed at for its
prefix to be cacheable.

### The rate, and what it changes

From the gateway's own price list (`GET /v1/models`, the `input_cache_read` field), not from a
ratio: **USD 0.03 per million cached input tokens for `google/gemini-3.1-flash-lite`** against
USD 0.25 fresh, so 12 per cent, and **USD 0.25 against USD 2.50 for `openai/gpt-5.4`**, so 10
per cent. A single assumed multiplier would have been wrong on one of the two, which is why
the spike refused to guess it. Neither model is quoted a cache-write rate at all, because
neither charges for one; Anthropic does, at 1.25x its input rate for a five-minute entry,
which is why `ModelParams` carries `pricePerCacheWriteMTok` as well.

Repricing, three rows of arithmetic on recorded runs and one row the loop charged itself:

| run | input tokens | served from cache | bill before | bill after | drop |
| --- | --- | --- | --- | --- | --- |
| onenote, cold | 104,586 | 46.2% | 2.4766 credits | 1.5578 | 37.1% |
| onenote, warm | 90,715 | 73.3% | 2.1428 credits | 0.8788 | 59.0% |
| onenote, fourth arm, **actually billed this way** | 115,610 | 47.8% | 2.7303 credits | 1.6800 | 38.5% |
| the two full sweeps above, pooled | 1,363,296 | 53.6% | EUR 0.3232 | EUR 0.1843 | 43.0% |

So the band this document guessed at (37 to 57 per cent at a 25 per cent rate, 44 to 69 at 10)
lands at 37 to 59 per cent on the runs actually measured, and 43 per cent on the pooled sweep
it was guessing about. The money was never in asking for the cache; it was in paying for the
one we were already getting.

### Two things this leaves behind

**A cached read looks like it needs a large enough prefix, which is an argument against
shortening the long playbook prompts rather than for it.** Across the four probes the pattern
is monotone and hard to miss: 0 hits in 18 calls at a 3,083 to 3,478-token prefix, 16 of 28 at
3,953 to 4,497, and 11 of 12 at 6,795, where the read covered 90 per cent of the call. Nothing
here isolates a threshold, and Google publishes a minimum for implicit caching rather than
guaranteeing anything above it. But `onenote`'s fixed block is 3,935 tokens, which sits right
where hits start, and cutting the provenance and scope rationale out of its system prompt
would land it below anything measured to hit at all. That trim needs its own arm of this
runner before it ships, not just a token count, which is what #329 asks for. **#329 ran it,
and the trim lost: the section below is that measurement.** `obsidian`'s prompt is a different
case and was checked separately: its length is the seven wikilink forms and Dataview's inline
fields, both of them markup no other playbook sees and each row of them changing a decision,
so that one is earned. (It was 2,808 tokens when this was written and is 3,380 on 2026-08-23,
so read the number here as dated and `packages/import/playbooks/obsidian.md` as current.)

**`estimate.ts`'s 2.816 credits per OneNote document is now too high, and by an amount this
repo cannot compute.** That constant is the average of two real jobs' `spent_credits`, and
`spent_credits` priced their cache reads as fresh input; neither job recorded how many it got,
because nothing recorded cached tokens before #271 and nothing persists them even now. The
band above puts the honest figure between roughly 1.15 and 1.77 credits. It is deliberately
not hardcoded to either: `estimateAveragesForPlaybook` replaces a cold-start default with a
historical average the first time a real job finishes, so the right way to move that number is
to let one finish under the new arithmetic rather than to substitute a repricing of old token
counts for the measurement the row is supposed to carry. Filed as #330. **#330 ran three of
them against a real notebook and the row is 1.1492 now, at the very bottom edge of that band:
the "What #330 measured" section below is that measurement.**

## What #329 measured: shortening `onenote`'s prompt costs money (the trim is reverted)

The section above left an open question with a price on it. `onenote.md`'s system prompt is
2,928 tokens against `docx.md`'s 1,143 for a playbook doing the same job, 639 of them two
paragraphs of provenance and scope rationale that change no tool call (578 net of the one
sentence in them worth keeping), and it is re-sent
on every step of every document. Cutting them is obviously right on a token count and
possibly wrong on the bill, because a shorter prefix earns fewer of the cache reads that
already serve half of this loop's input. So the trim was made, measured, and reverted.

Seven arms, 2026-08-23, `google/gemini-3.1-flash-lite` on `cheap` with
`pricePerCachedInputMTok` present, `pnpm --filter @canonry/bench loop-cost -- --source onenote
--documents all` for the five ten-document arms and `--documents extremes` for the first two.
The prompt was swapped in place between arms and the runner is otherwise untouched, so the
only difference between a `trimmed` row and an `untrimmed` one is 578 tokens of prefix. The
table lists the arms in the order they ran.

**What the trim did to the prompt, measured rather than estimated:** the system prompt goes
from 11,712 characters (2,928 tokens by this repo's chars-over-four convention) to 9,399
(2,350), so the fixed block per step goes from 3,935 to 3,357 and the provider's own count of
step 1 goes from 3,517 to 2,917. That is 578 tokens, not the 1,100 #329 estimated from
reading the file: worth stating, because the estimate was 90 per cent high and the whole
argument for the trim was the size of it.

| arm | prompt | docs | calls | calls cached | input from cache | input tokens per call | fresh per call | USD of input per call | credits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before-A | untrimmed | 2 | 20 | 11 | 45.3% | 4,204 | 2,298 | 0.000632 | 1.2867 |
| after-A | trimmed | 2 | 17 | 6 | 32.3% | 3,685 | 2,493 | 0.000659 | 1.1546 |
| after-1 | trimmed | 10 | 122 | 52 | 38.2% | 3,739 | 2,310 | 0.000620 | 7.5718 |
| before-1 | untrimmed | 10 | 113 | 62 | 44.1% | 4,298 | 2,401 | 0.000657 | 7.3812 |
| before-2 | untrimmed | 10 | 125 | 101 | **64.1%** | 4,377 | 1,569 | **0.000477** | 6.2391 |
| after-2 | trimmed | 10 | 121 | 52 | 38.3% | 3,766 | 2,324 | 0.000624 | 7.5578 |
| after-3 | trimmed | 10 | 124 | 70 | 50.0% | 3,788 | 1,893 | 0.000530 | 6.7208 |

**Read the USD column and not the credits column.** Credits include output tokens, output
follows step count, and step count is the price and also the part that swings by up to 1.37x
on identical input, which is this document's own headline finding. The trim touches the input
prefix and nothing else, so input tokens repriced at the gateway's own two rates (USD 0.25
fresh, USD 0.03 cached per million) is the only column where a 578-token change is visible
above the noise.

**Pooled over the five ten-document arms: the trim makes a model call 5.1 per cent more
expensive.** 367 calls trimmed against 238 untrimmed, coverage 42.3 against 54.7 per cent,
USD 0.00059114 of input per call against 0.00056231. It sends 575 fewer input tokens per call
and pays for 210 more of them fresh.

**And the direction flips with cache warmth, which is why one arm each would have answered
wrongly.** A first pass over the ten documents is the cold case and the trim wins it (0.000657
untrimmed against 0.000620 and 0.000624, 5 per cent cheaper); a second consecutive pass over
the same ten with the same prefix is the warm case and the trim loses it by more (0.000477
against 0.000530, 11 per cent dearer). A real import job is the warm case: it is many
documents in sequence sharing one prefix, which is exactly what the second pass of each pair
is. So the warm pair is the production-relevant comparison and it is the worse of the two.

**The mechanism, from the per-step reads rather than the aggregate.** On the untrimmed prompt
the first cached read of a document arrives at step 2 to 6; on the trimmed prompt, never
before step 4 and usually step 5 to 7, in all 30 trimmed document runs. The trimmed prefix
starts at 2,917 tokens by the provider's count and has to grow through several steps of
transcript before this provider will serve it, and every one of those steps is billed fresh.
The arithmetic of that trade is one line: saving 578 tokens on a call that was going to miss
saves USD 0.000145, and converting one 3,900-token call from a hit to a miss costs USD
0.000858, about six times as much, so the trim can afford to break at most one hit in six and
measured it breaks about one in five (68.5 per cent of calls cached against 47.4).

**So the 3,478-token ceiling of #313's probes is not a hard floor.** The smallest prompt this
sweep saw served from cache was 3,476 tokens, on the trimmed prompt. What the probes were
seeing is not a cliff but a cost: below roughly 3,500 to 3,900 tokens a read fires late and
rarely, and "late and rarely" is enough to eat a 578-token saving whole.

**Reverted, and the provenance moved anyway.** The two paragraphs are back in
`onenote.md` byte for byte, so its `version` stays 4 and no import fingerprint changes. What
#329 keeps is `docs/onenote-export.md`, which is where a maintainer should look for how that
folder tree is produced and why the binary format waits, and a comment in the playbook's own
frontmatter, which the loader strips before the body becomes the system prompt, saying that
these paragraphs are load-bearing for cost rather than for behaviour. `obsidian.md`'s framing
at lines 20 to 24, about 90 tokens, was checked in the same pass and left alone: its fixed
block is 4,379 tokens, a 90-token cut moves nothing across any threshold measured here, and it
would cost a `version` bump and therefore a re-fingerprint of every Obsidian import.

**Accuracy was checked too, and it is not what decided this.** `docs/models.md`'s 0.839 for
`cheap` on `extract` turned out to cover seven documents, none of them a OneNote page, so a
OneNote prompt change could not have invalidated it. `packages/bench` now carries two
`onenote` extract cases, both subpages, whose only expected relation is the parent/subpage one
that the folder tree implies. Three runs of each prompt: the folder-tree relation was found in
6 of 6 trimmed runs and 5 of 6 untrimmed, and the scores (0.708 to 0.767 trimmed, 0.625 to
0.767 untrimmed) sit inside that variance. The rule the trim could have broken did not break.

Total spend for the whole measurement, both prompts and both runners: EUR 0.53.

## What #330 measured: what a real OneNote notebook actually costs per document

The section above left the calibration constant wrong on purpose, because the only honest way
to move it was a real import finishing under #313's arithmetic and there was no real notebook
on this box to import. #590's corpus is one (`docs/corpus-onenote.md`, sha256
`9b9a488a...`, somebody else's private campaign, nothing from it quoted here) and #599's
reader reads its own `.mht` export, so this is that measurement.

Three imports, 2026-08-23, driven through the product's own upload path (`POST` to
`/onboarding/import`'s `upload`, `confirm` and `start` actions, so detection, enumeration, the
estimate, admission and `startImportRun` all ran the way a GM's click runs them), one fresh
universe each, `google/gemini-3.1-flash-lite` on `cheap` with `pricePerCachedInputMTok`
present. Every figure below is read off `import_job`, not off a runner's report:

```sql
SELECT document_count, spent_credits, input_tokens, output_tokens, proposals_emitted,
       round(spent_credits / document_count, 4) AS credits_per_doc,
       round(extract(epoch FROM (finished_at - started_at))::numeric, 1) AS seconds
FROM import_job WHERE status = 'finished' AND playbook = 'onenote' ORDER BY created_at;
```

| scope          | docs | spent_credits | per document | input tokens | output tokens | proposals | seconds |
| -------------- | ---- | ------------- | ------------ | ------------ | ------------- | --------- | ------- |
| one page       | 1    | 0.5261        | 0.5261       | 33,193       | 588           | 3         | 9.3     |
| one section    | 23   | 31.0004       | **1.3478**   | 3,064,433    | 30,133        | 159       | 479.2   |
| whole notebook | 70   | 75.8718       | **1.0839**   | 6,295,130    | 63,887        | 281       | 952.9   |

**The row is 1.1492**, the document-weighted pool of the two multi-page runs: 106.8722 credits
over 93 documents. Which scope the average comes from is a real choice and not a rounding
detail, so here is what each one would have said and why this one won.

The one-page run says 0.5261, less than half the multi-page figure, and it is the flattering
case rather than the case that matters. This run also priced that choice rather than arguing
it: the notebook job started while the page job was the only history in the table, so
`estimateAveragesForPlaybook` handed the estimate screen 0.5261 and the GM was quoted **37
credits for work that then billed 75.8718**. It finished, because
`IMPORT_BUDGET_HEADROOM_MULTIPLIER` had budgeted 222, which is the clearest evidence yet that
the six-times headroom is doing the job #261 gave it. But a consent screen that understates by
half is the failure a cold-start default is there to avoid.

The notebook alone says 1.0839 and the section alone 1.3478, a 1.24x spread on the same
notebook read at two scopes, which is this document's own headline finding showing up again:
step count is the price, and step count varies. Pooling the two by document rather than
picking one averages that over 93 documents instead of 23 or 70, and it is the same arithmetic
`estimateAveragesForPlaybook` performs on real rows, so the cold start and the path that
replaces it now agree on what "average" means. #599 ran the same three files independently a
few hours earlier and reported 0.7228, 1.2195 and 1.1346 per document; pooling its two
multi-page runs the same way gives 1.1556, within 0.6 per cent of 1.1492 from a different
session, which is the closest thing to a repeat this corpus can offer.

**Reconciling with 2.816, because a 2.5x correction deserves an account of where it went.**
Repricing these same two jobs' recorded tokens the way `computeCost` did before #313 (every
input token fresh, `(input x 0.25 + output x 1.50) / 1.1567`, the USD rates on the `cheap` row
and the pinned FX rate) gives 214.4827 credits over the same 93 documents, so **2.3063 credits
per document under the old arithmetic**. Two thirds of the correction is therefore the pricing
fix (50.2 per cent off, from 2.3063 to 1.1492) and the remaining third is that #261's two jobs
simply took more steps per document than this corpus does: 2.816 was already 22 per cent above
what this notebook would have shown even before #313.

**And the cached share is recoverable from the rows that exist, which is the answer to whether
`model_call` needs a `cached_input_tokens` column.** `computeCost` is invertible when the
`model_config` params that produced a row are known: with fresh and cached input the only two
input buckets Google bills, `cached = (input x 0.25 + output x 1.50 - cost_eur x 1.1567 x 1e6)
/ 0.22`. Run over these three jobs' own `model_call` rows:

| scope          | model calls | calls that read cache | input served from cache |
| -------------- | ----------- | --------------------- | ----------------------- |
| one page       | 8           | 4                     | 42.4%                   |
| one section    | 322         | 223                   | 67.2%                   |
| whole notebook | 729         | 444                   | 57.2%                   |

Which is the same incidental, provider-decided pattern #313 measured, at the same magnitude,
now on 1,059 real production calls instead of a probe. The figure is not lost today, so the
column buys robustness rather than information: the inversion needs the exact price row that
priced the call, `model_config` is switchable from `/admin/models` without a deploy and
deactivates rows rather than deleting them, and a second cache bucket (Anthropic's cache
writes, which the `cheap` row would have if it moved back to `claude-haiku-4.5`) makes one
equation carry two unknowns and stop being invertible at all. So it is a decision about
whether historical cache accounting should survive a price change, not about whether
`cost_eur` is right. That is Lorenzo's call, recorded on #330.

**`avgSecondsPerDocument` stays 20.** Measured here at 13.6 (notebook) and 20.8 (section),
pooling to 15.4, so the shipped constant sits inside the measured range. It is not moved for
the reason this document keeps wall clock out of its own tables: these ran 20 documents wide
on a box with other agents on it, so the reading measures the box as much as the loop.

**What moving one constant moved.** `ONENOTE_CREDITS_PER_STEP` calibrates the six inferred
rows, so all seven change together, by the same 0.408 factor.

| playbook    | stepBudget | before | after      | measured?               |
| ----------- | ---------- | ------ | ---------- | ----------------------- |
| onenote     | 60         | 2.8160 | **1.1492** | yes, the two jobs above |
| obsidian    | 60         | 2.8160 | 1.1492     | no                      |
| world-anvil | 50         | 2.3467 | 0.9577     | no                      |
| kanka       | 50         | 2.3467 | 0.9577     | no                      |
| docx        | 40         | 1.8773 | 0.7661     | no                      |
| pdf         | 40         | 1.8773 | 0.7661     | no                      |
| generic     | 40         | 1.8773 | 0.7661     | no                      |

**Two of the six are now tighter than a document this repo has measured, and no margin was
added to hide it.** Repricing the sweep at the top of this document puts `campaign-brief.docx`
at roughly 1.0 to 1.4 credits against `docx`'s new 0.7661, and `kanka/characters.json` at
roughly 2.8 to 3.8 against `kanka`'s new 0.9577. Three reasons that is the right answer
anyway. A per-document average over a whole job is not the cost of that job's most expensive
document, which is what those two figures are. What protects a job from a low estimate is the
budget headroom, not the estimate, and the notebook run above is the demonstration. And the
row a playbook actually needs is a real job in that playbook, which
`estimateAveragesForPlaybook` installs the first time one finishes. What a low estimate does
cost is a consent screen that understates, so the fix is measuring the other six the way this
one was measured, not widening a guess.

**The historical-average path fires, which is worth knowing before anyone buys more precision
here.** All three runs confirmed it from the estimate screen's own number: the first was quoted
3 credits for one document, which is `ceil(2.816)` and therefore the cold-start default; the
notebook was quoted 37, which is `ceil(70 x 0.5261)` and therefore the page job's real average;
the section was quoted 25, which is `ceil(23 x 1.07603)` and therefore the two prior jobs
pooled by document. So `PLAYBOOK_COLD_START_ESTIMATE.onenote` decides exactly one job on any
deployment, the very first OneNote import, and every one after it is priced off real rows.

Total spend for this measurement: **107.3983 credits, EUR 1.07** at the 100-credits-per-euro
rate in `packages/ai/src/usage.ts`, over the three jobs above. No run was repeated for a
nicer number.

## What #606 measured: the other six playbooks, against our own corpus

The section above measured `onenote` and left the other six as that number times their own
playbook's `stepBudget` over onenote's 60. That formula is what this section refutes, so the
order matters: the numbers came first and the conclusion about the formula came out of them.

Twelve imports, 2026-08-23, driven through the product's own upload path (`POST` to
`/onboarding/import`'s `upload`, `confirm` and `start` actions, so detection, enumeration, the
estimate, admission and `startImportRun` all ran the way a GM's click runs them), one fresh
empty universe per job, `google/gemini-3.1-flash-lite` on `cheap` with
`pricePerCachedInputMTok` present, which is the same model and the same arithmetic #330 used.
Every figure is read off `import_job`:

```sql
SELECT playbook, count(*) AS jobs, sum(document_count) AS docs,
       round(sum(spent_credits), 4) AS credits,
       round(sum(spent_credits) / sum(document_count), 4) AS credits_per_doc,
       round(sum(extract(epoch FROM (finished_at - started_at))::numeric)
             / sum(document_count), 1) AS seconds_per_doc
FROM import_job GROUP BY playbook ORDER BY playbook;
```

| playbook    | jobs | docs | credits | per document | seconds per doc | was (inferred) |
| ----------- | ---- | ---- | ------- | ------------ | --------------- | -------------- |
| obsidian    | 1    | 35   | 30.3658 | **0.8676**   | 23.3            | 1.1492         |
| world-anvil | 1    | 32   | 23.8399 | **0.7450**   | 12.6            | 0.9577         |
| kanka       | 1    | 7    | 6.7393  | **0.9628**   | 17.6            | 0.9577         |
| docx        | 4    | 4    | 3.0197  | **0.7549**   | 12.5            | 0.7661         |
| pdf         | 2    | 2    | 1.9397  | **0.9699**   | 25.3            | 0.7661         |
| generic     | 3    | 12   | 9.6364  | **0.8030**   | 15.5            | 0.7661         |

**Every input is our own corpus, and that is the honest caveat on all six.** `pnpm --filter
@canonry/bench corpus` renders one sample world (`packages/bench/src/corpus/valdoria-reach.ts`,
`v1` = 32 entities and 28 relations) into each format, so these are six readings of one world rather than six
worlds, where onenote's row is 93 documents of somebody's real 70-page campaign notebook. A
real GM export with ten times the entries and a decade of cross-references may well cost more
per document, and none of these six should be read as saying it will not. What they do say is
that a measured figure from our own fixtures is much better evidence than a figure scaled off
a different playbook, which is what they replace.

Which archive is behind each row, since "the corpus" is not specific enough to re-run:

| playbook    | uploaded                                                                      |
| ----------- | ----------------------------------------------------------------------------- |
| obsidian    | `obsidian/v1.zip`, 42 files, 35 documents                                     |
| world-anvil | `world-anvil/v1.zip`, 70 files, 32 documents                                  |
| kanka       | `kanka/v1.zip`, 13 files, 7 documents                                         |
| docx        | `docx/v1/*.docx` and `docx/v2/*.docx`, four single-file uploads of 1 document |
| pdf         | `pdf/v1/players-handout.pdf` and `pdf/v2/...`, two single-file uploads        |
| generic     | `generic/v1.zip`, `generic/v2.zip` (5 documents each) and `docx/v1.zip`       |

Two of those rows need their shape explained rather than just named. **A `docx` job is one
Word file, by construction**: `detectSource` sniffs a _sole_ archive entry, so a zip holding
two `.docx` files falls through to `generic`, which is what the third generic job is, and the
only way to reach the `docx` playbook is to upload one document. Four uploads is therefore
what four `docx` documents costs, and the same is true of `pdf` with two. **And that third
generic job is pooled in rather than set aside**: it is a real `generic` job over two real
documents, the pooling is by document, and it is the same arithmetic
`estimateAveragesForPlaybook` performs on real rows. Its own figure was 0.9944 per document
against 0.7167 and 0.8129 for the two markdown-and-text exports, so a Word file read as
generic text costs more than a session note, which is worth knowing on its own.

**Scaling linearly in `stepBudget` does not survive the six.** Group the seven measured rows
by the step budget they share:

| stepBudget | playbooks                               | spread within the class |
| ---------- | --------------------------------------- | ----------------------- |
| 60         | onenote 1.1492, obsidian 0.8676         | 1.32x                   |
| 50         | world-anvil 0.7450, kanka 0.9628        | 1.29x                   |
| 40         | docx 0.7549, generic 0.8030, pdf 0.9699 | 1.29x                   |

The class means are 1.0084, 0.8539 and 0.8426, a 1.20x spread, against 1.29x to 1.32x _within_
each class. So the variable the old formula divided by explains less of the variation than it
leaves behind. Restrict to one corpus, which is the only comparison that is not confounded by
which world was imported, and it explains nothing at all: drop onenote and the three class
means are 0.8676, 0.8539 and 0.8426, flat to within **3 per cent** across step budgets 60, 50
and 40. The old formula would have predicted a 1.5x spread across those same three classes.

The mechanism is in the jobs rather than in the arithmetic. A step budget is a ceiling, and
**one job of the twelve reached one**: obsidian settled `stopped_at_ceiling` because 2 of its
35 documents ran out of steps, and the other 90 documents of this measurement finished with
steps to spare. For a document that never approaches its ceiling, the ceiling cannot be what
sets its price. What sets it is how much the document finds, which is #271's finding restated:
every step resends the accumulated transcript including every proposal already made, so cost
grows with what a document turns out to contain, and no playbook frontmatter knows that in
advance. `packages/import/src/estimate.ts` therefore carries seven measured constants and no
formula, and the fallback for an unknown playbook id is a constant too.

**No measured row carries a margin, and the unmeasured fallback takes the dearest measured
row.** #606 asked both questions on purpose, because #330 declined to add a margin and the
consequence was two rows sitting below a document this file had already measured. The answer
is still no margin, for three reasons that the measurement itself now supports. A per-document
average is what a consent screen is for, and padding it overstates what the GM will be
charged, which is its own harm under SPEC.md §15. What protects a job from a low estimate is
`IMPORT_BUDGET_HEADROOM_MULTIPLIER`, and it has now been watched working twice: #330's notebook
was quoted 37, budgeted 222 and spent 75.8718, and #606's obsidian vault was quoted 41,
budgeted 246 and spent 30.3658. And the row a playbook needs is a real job in that playbook,
which the historical-average path installs the first time one finishes. The one place a margin
does belong is the case with no measurement at all: `UNMEASURED_PLAYBOOK_ESTIMATE`, reached
only by a playbook id that has no row, used to fall back to the _cheapest_ inferred figure
(0.7661) and now takes the dearest measured one (1.1492), because for a playbook nobody has
ever run there is no evidence it is cheaper than the dearest thing we have run.

**Wall clock is raised where it was measured higher and never lowered.** These twelve jobs ran
20 documents wide on a box with other agents on it, which is why this document keeps wall clock
out of its own tables, so a reading is an upper bound rather than a figure. An upper bound is
evidence for raising a timeout constant and not for lowering one, and raising one is nearly
free: a slow job spends nothing extra by being slow, and `IMPORT_TIMEOUT_HEADROOM_MULTIPLIER`
triples it anyway. So obsidian takes 24 seconds (23.3 measured, was 20), pdf 26 (25.3, was
13.3), kanka 18 (17.6, was 16.7) and generic 16 (15.5, was 13.3), while onenote keeps #330's
20, world-anvil keeps 17 and docx 14, each of which measured lower than the number it kept.

**The seven-row table, before and after.**

| playbook    | stepBudget | before | after      | seconds        | measured?                  |
| ----------- | ---------- | ------ | ---------- | -------------- | -------------------------- |
| onenote     | 60         | 1.1492 | **1.1492** | 20 (unchanged) | yes, #330, a real notebook |
| obsidian    | 60         | 1.1492 | **0.8676** | 20 -> 24       | yes, #606, our corpus      |
| world-anvil | 50         | 0.9577 | **0.7450** | 16.7 -> 17     | yes, #606, our corpus      |
| kanka       | 50         | 0.9577 | **0.9628** | 16.7 -> 18     | yes, #606, our corpus      |
| docx        | 40         | 0.7661 | **0.7549** | 13.3 -> 14     | yes, #606, our corpus      |
| pdf         | 40         | 0.7661 | **0.9699** | 13.3 -> 26     | yes, #606, our corpus      |
| generic     | 40         | 0.7661 | **0.8030** | 13.3 -> 16     | yes, #606, our corpus      |

The two rows #330 flagged as being below a measured document are the interesting ones. `pdf`
moved up 27 per cent, which is the direction that flag pointed. `kanka` barely moved (0.9577
to 0.9628), so its flag turns out to have been about the wrong thing: the sweep at the top of
this document repriced `kanka/characters.json` at roughly 2.8 to 3.8 credits, and a whole
kanka job still averages 0.9628 per document, which is the distinction between the cost of a
job's most expensive document and the cost of its average one. `obsidian` and `world-anvil`
both moved _down_, by a quarter, which no amount of reasoning about link-following predicted.

**What the confirm screen now says, from a database with no import history.** The same
`upload` and `confirm` actions, against a freshly migrated database so the cold-start branch is
the one that answers, one upload per playbook:

| playbook    | docs | quoted before | quoted now | what those documents actually spent |
| ----------- | ---- | ------------- | ---------- | ----------------------------------- |
| obsidian    | 35   | 41            | **31**     | 30.3658                             |
| world-anvil | 32   | 31            | **24**     | 23.8399                             |
| kanka       | 7    | 7             | **7**      | 6.7393                              |
| docx        | 1    | 1             | **1**      | 0.4834                              |
| pdf         | 1    | 1             | **1**      | 0.9347                              |
| generic     | 5    | 4             | **5**      | 3.5833                              |

Every quote covers what the job then spent, which is the invariant `estimate.test.ts` now pins
for all seven rows rather than pinning the formula. The single-document rows quote 1 either
way, so `pdf`'s and `docx`'s new figures only change the arithmetic for a batch: twenty PDFs
used to quote 16 and now quote 20, against a measured 19.4.

**The historical-average path fires here too, and there is one case where it does not.** The
second generic upload was quoted 5 credits for five documents off the previous generic job's
real 0.9944 rather than off any cold-start row, so #330's finding repeats: a wrong constant
misprices exactly one job per playbook per deployment, which is the frame this whole table
should be read in and the reason not to buy another decimal place. The exception is the
obsidian job. `estimateAveragesForPlaybook` filters `status = 'finished'`, and that job settled
`stopped_at_ceiling` because two of its documents hit their step ceiling, so it installs no
history at all and the next obsidian import on that deployment would be quoted off the
constant again. A playbook whose jobs keep stopping at a step ceiling never leaves its
cold-start row, and the jobs being excluded are the expensive ones, so what history the
estimate does learn is biased cheap. Issue #610 carries that.

Total spend for this measurement: **75.5408 credits, EUR 0.76** at the 100-credits-per-euro
rate in `packages/ai/src/usage.ts`, over the twelve jobs above, 92 documents for a pooled
0.8211 per document. No run was repeated for a nicer number, and the obsidian run in
particular was left as the ceiling-stopped job it is.

## Re-running this

```bash
pnpm --filter @canonry/bench corpus            # once, and after any change to a renderer
pnpm --filter @canonry/bench loop-cost         # both documents of every source
pnpm --filter @canonry/bench loop-cost -- --source onenote
pnpm --filter @canonry/bench loop-cost -- --source kanka --documents all
```

Needs `AI_GATEWAY_API_KEY` and a `DATABASE_URL` whose name ends in `_bench` or `_e2e`, the
same refusal every runner in that package makes. Writes `.data/loop-cost.json`, which holds
every sample, so a different breakdown can be computed from a recorded run without spending
again, and `.data/loop-cost.md`, which holds the tables above.

**Neither the #330 nor the #606 table came from that harness**, and this is the part a
maintainer will otherwise reconstruct from scratch. A cold-start row has to be read off a real
`import_job`, so those runs went through the app: a scratch database, `pnpm --filter
@canonry/db migrate`, a dev server pointed at it, an account created through
`POST /api/auth/sign-up/email`, one `INSERT INTO universe`/`universe_member` per job so each
import lands in a fresh empty world, a wide `user_billing` balance, and then a `POST` to
`/onboarding/import?/upload`, `?/confirm` and `?/start` carrying the session cookie and an
`x-sveltekit-action` header, which is the only way to exercise detection, the estimate,
admission and `startImportRun` as one piece. `?/confirm` spends nothing, so the quote a table
gives can be re-read at any time without paying for it; `?/start` is the consent click and the
only thing that costs money.

The instrumentation is `profileStep` and `toolSchemaChars` in
`packages/import/src/transcript-profile.ts`, reached through an optional `profiler` on
`GatewayDriver`. Omitted, which is everywhere in the product, the driver does no profiling
work at all: it does not convert a schema, it does not walk a transcript, and
`gateway-driver.test.ts` pins that a profiled run and an unprofiled run of the same document
emit identical events.

