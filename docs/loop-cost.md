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
| Is anything already discounting the resend? | Yes, by accident. Gemini's implicit prompt cache served **53.6 per cent of every input token this sweep spent**, on 49 per cent of calls, covering 83.5 per cent of a call when it fired. `ModelParams` has no cached-input price, so `computeCost` bills all of it at the full input rate |

**The fix the numbers point at is deterministic prompt caching of the loop's stable
prefix, plus a cached-input rate in `computeCost`.** Not transcript pruning, which the
next section explains cannot reach most of the money. Filed as its own issue.

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
does, so it costs none of the guardrails.

Sizing it, as a band rather than a number, because the cached-read rate has to come from the
gateway's own price list and not from me: at 25 per cent of the input rate the sweep gets 37
per cent cheaper on today's incidental hit rate and 57 per cent cheaper if every call hits at
the coverage already observed; at 10 per cent, 44 and 69 per cent. Either end is a bigger
lever than anything else on this list.

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

The instrumentation is `profileStep` and `toolSchemaChars` in
`packages/import/src/transcript-profile.ts`, reached through an optional `profiler` on
`GatewayDriver`. Omitted, which is everywhere in the product, the driver does no profiling
work at all: it does not convert a schema, it does not walk a transcript, and
`gateway-driver.test.ts` pins that a profiled run and an unprofiled run of the same document
emit identical events.
