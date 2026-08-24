/**
 * `GatewayDriver` (issue #23, SPEC.md §11.2): "the AI SDK loop against Cloudflare AI
 * Gateway, model chosen per job from the database. No extra process, no container to
 * harden." It implements `ImportDriver` (driver.ts) and owns the bounded per-document
 * loop (issue #22, SPEC.md §6.1): one document is the unit of work, so context never
 * grows with the size of the export; each document gets a step ceiling from its
 * playbook; and progress is checkpointed per document via the `checkpoint`/`job_finish`
 * tools (tools.ts), which push straight onto the stream this class returns.
 *
 * Two dependencies are injected rather than constructed here, and both are named
 * seams, not oversights:
 *
 * - `models: ModelSelector` resolves which raw language model to use for a purpose
 *   (SPEC.md §6.7: "the model chosen per job from the database"). The database read
 *   that decision needs (`@canonry/ai`'s `resolveModel(db, purpose)`) lives outside
 *   this package on purpose - packages/import never depends on `@canonry/db`, so this
 *   driver stays usable without a database connection in tests, and the composition
 *   root that wires a real import job together (not one of this run's six issues) is
 *   the one place that needs both `@canonry/db` and `@canonry/import` in scope. The
 *   same composition root is responsible for mapping a resolved `provider` string
 *   (e.g. "openai") to the matching `ai-gateway-provider/providers/*` factory - that
 *   mapping does not exist anywhere in `@canonry/ai` yet either.
 * - `gateway: GatewayWrapper` is the structural shape of `@canonry/ai`'s `createGateway()`
 *   return value (`AiGateway` from `ai-gateway-provider`, itself not re-exported by
 *   `@canonry/ai`'s public surface - see the type below for why it is declared
 *   locally rather than imported). Every model call this driver makes is wrapped
 *   through it before use, which is what makes this "GatewayDriver over @canonry/ai's
 *   gateway" rather than a driver that merely happens to sit in the same monorepo.
 */
import {
	generateText,
	type ModelMessage,
	type LanguageModel,
	type ToolExecutionOptions,
	type ToolResultPart,
	type ToolSet
} from 'ai';
import { computeCost, type ModelParams } from '@canonry/ai';
import { detectLanguage, type Locale } from '@canonry/lang';
import type {
	DocumentStatus,
	ImportDriver,
	ImportJob,
	JobDocument,
	JobEvent,
	JobStream
} from './driver.js';
import type { LoadedPlaybook, ImportModelPurpose } from './playbook.js';
import type { SourceReader } from './sources.js';
import type { ImageStore } from './images.js';
import { createDocumentRunContext, createImportTools, type DocumentRunContext } from './tools.js';
import { loopLogger, type LoopLogger } from './logging.js';
import {
	profileStep,
	toolSchemaChars,
	type StepProfile,
	type StepProfiler
} from './transcript-profile.js';

/**
 * Structural shape of `@canonry/ai`'s `AiGateway` (from `ai-gateway-provider`): call it
 * with a provider-specific language model to route that model's calls through
 * Cloudflare AI Gateway, exactly as `packages/ai/src/gateway.test.ts` does
 * (`gateway(openai.chat('gpt-4o-mini'))`). Typed structurally here, not imported from
 * `ai-gateway-provider` directly, so packages/import does not need that package as a
 * dependency of its own - `@canonry/ai`'s `createGateway()` return value already
 * satisfies this shape.
 */
export type GatewayWrapper = (model: LanguageModel) => LanguageModel;

export interface ImportModel {
	/** Raw, provider-specific model, not yet routed through the gateway. */
	languageModel: LanguageModel;
	provider: string;
	modelId: string;
	params: ModelParams;
}

export interface ModelSelector {
	resolve(purpose: ImportModelPurpose): Promise<ImportModel>;
}

/** Tracks spend against a job-wide credit ceiling (SPEC.md §6.7, §15) across every
 * document and step the job runs.
 *
 * issue #134: the ceiling used to be checked only between steps, against *actual* spend
 * recorded after a step finished, so a single step's real cost was unbounded - nothing
 * stopped it from starting, however expensive it turned out to be, and a production job
 * overshot a 1.0000 ceiling by 46% and emitted zero proposals. `wouldExceedCeiling` prices
 * a step's *worst case* before it starts (known input, output capped by
 * `STEP_MAX_OUTPUT_TOKENS` below and enforced on the real call by `callStep`), so a step
 * that cannot fit even in the worst case is refused before the model is ever called - an
 * unbounded overshoot becomes bounded by one step's worst case. `markProposed` and the
 * `reserveCredits` grace inside `wouldExceedCeiling` cover the sharper failure: a job that
 * proposed nothing is worse than one that spent a little past its ceiling to produce
 * something (AGENTS.md: "time from import to first accepted proposal" outranks raw spend
 * as the metric that decides whether this product works), so a job that has not proposed
 * anything yet gets exactly one step's worth of grace past its plain ceiling. */
export interface BudgetTracker {
	spend(credits: number): void;
	exceeded(): boolean;
	/** True when starting a step priced at `worstCase` credits could not be afforded, even
	 * after covering the shortfall with this job's one-time `reserveCredits` grace toward a
	 * first proposal - spent only while none has been emitted yet, and at most once per
	 * job, whether or not the step it buys turns out to propose anything. */
	wouldExceedCeiling(worstCase: number, reserveCredits: number): boolean;
	/** Marks that this job has emitted at least one proposal: the reserve's guarantee is
	 * met, so `wouldExceedCeiling` stops granting grace for the rest of the run. */
	markProposed(): void;
}

function createBudgetTracker(maxCredits: number): BudgetTracker {
	let spent = 0;
	let proposed = false;
	let reserveUsed = false;
	return {
		spend(credits: number): void {
			spent += credits;
		},
		exceeded(): boolean {
			return spent >= maxCredits;
		},
		markProposed(): void {
			proposed = true;
		},
		wouldExceedCeiling(worstCase: number, reserveCredits: number): boolean {
			if (spent + worstCase <= maxCredits) return false;
			if (proposed || reserveUsed) return true;
			if (spent + worstCase <= maxCredits + reserveCredits) {
				reserveUsed = true;
				return false;
			}
			return true;
		}
	};
}

/** No tokenizer dependency in this monorepo - `packages/indexing/src/chunking.ts` uses the
 * same convention for the same reason: ~4 characters per token, OpenAI's own rule of thumb
 * for English prose. Not exact, and a worst-case price does not need it to be; it needs to
 * not be optimistic, and `JSON.stringify`'s braces/quotes/escaping push a message array's
 * estimate up rather than down, which is the direction that keeps this a real ceiling. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/** issue #134: caps every step's real output, not just its estimate - `callStep` passes
 * this to `generateText` as `maxOutputTokens`, so a step cannot cost more than this many
 * output tokens because the call is not allowed to produce more.
 *
 * Sized for a step that batches several `entity_propose` calls into one response, not
 * just one: `ENTITY_PROPOSE_INPUT`'s `summary` alone maxes at 4000 characters (~1000
 * tokens; tools.ts), and name/aliases/sourceRef/evidenceSpan plus the tool-call envelope
 * add roughly another 150-200, so one call at its schema ceiling costs ~1150-1200 tokens.
 * Nothing in the playbooks or the tool surface stops a model from proposing several
 * entities in a single turn - the loop guard (tools.ts's `registerToolCall`) only catches
 * *identical* repeated calls, never a burst of different ones - so 8192 buys headroom for
 * roughly six or seven such calls before truncation risk returns, well above what a normal
 * paragraph-dense passage should produce. This did not exist as an enforced cap before
 * issue #134 (the call went out with no `maxOutputTokens` at all, bounded only by
 * whatever the provider defaults to), so this number is a considered ceiling, not a
 * measurement of one - `runDocument`'s "every tool call in this step failed to parse"
 * check below exists precisely because 8192 is a judgment call, not a guarantee.
 *
 * Raised from 8192 to 24576 on 2026-08-19, on measurement rather than on a second guess.
 * The prediction above, that six or seven proposals in one turn is "well above what a
 * normal paragraph-dense passage should produce", is wrong for real worldbuilding prose: a
 * three-note Obsidian vault taken from a real community world produced 24 to 29 proposals
 * across its documents, and both the OneNote and the Obsidian runs died on their densest
 * page with exactly the failure this comment anticipated, "every tool call in this step
 * failed to parse". A region page that names a dozen settlements, ruins and factions is
 * not an edge case, it is the normal shape of the thing we import.
 *
 * Raising it is close to free, which is the other half of why. The same Obsidian job spent
 * 747,111 input tokens against 5,587 output tokens, a ratio of 134 to 1, because every step
 * resends the accumulated transcript (#271). An output cap is therefore not where a job's
 * money goes, and trading a little worst-case output for a document that finishes at all is
 * plainly worth it. What this alone does not fix is the underlying fragility: a step
 * whose calls all truncate here still fails its document, on the first try, with no
 * attempt at a smaller ask - #273 covers that seam; see `STEP_PARSE_RETRY_LIMIT` and
 * the retry loop in `runDocument` below for the rest of the fix. This raise buys room
 * on its own; it does not by itself make the loop robust to a step too big for any
 * fixed ceiling. */
const STEP_MAX_OUTPUT_TOKENS = 24576;

/** Rough, constant-per-tool overhead for the JSON-schema encoding every enabled tool's
 * definition costs on top of the conversation itself. The tool set never changes mid-run,
 * so a flat per-tool estimate is enough to keep the worst case from undercounting input
 * tokens, without reaching for a zod-to-JSON-schema conversion just to price a step that
 * has not been sent yet. */
const TOOL_DEFINITION_TOKEN_ESTIMATE = 150;

/** Prices the worst case of a step built from `system` + `messages` + `toolCount` enabled
 * tools: known input (chars/4, rounded up) plus the most output the call can produce
 * (`STEP_MAX_OUTPUT_TOKENS`). Called both to price the step about to run (with the current,
 * possibly-grown `messages`) and, with a document's *initial* messages, to size the
 * one-time reserve `wouldExceedCeiling` grants a job that has not proposed anything yet.
 *
 * Deliberately prices every input token as fresh even though `callStep` now asks for a prompt
 * cache (issue #313): a cache hit is the provider's to grant, not ours to promise, and a step
 * whose prefix has expired or whose request lands on a cold backend really does pay the full
 * rate. The worst case has to stay the worst case. What #313 does change is what happens
 * after the call: `spend` below is charged the discount the provider actually gave, so the
 * gap between this ceiling and real spend closes from the measured side rather than the
 * predicted one. */
function estimateWorstCaseCredits(
	system: string,
	messages: ModelMessage[],
	toolCount: number,
	params: ModelParams
): number {
	const inputTokens =
		Math.ceil(system.length / CHARS_PER_TOKEN_ESTIMATE) +
		Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN_ESTIMATE) +
		toolCount * TOOL_DEFINITION_TOKEN_ESTIMATE;
	return computeCost(params, {
		inputTokens,
		outputTokens: STEP_MAX_OUTPUT_TOKENS,
		embeddingTokens: 0,
		images: 0
	}).credits;
}

/** issue #313: the loop's stable-prefix cache control, set on every step.
 *
 * `runDocument` only ever appends (`messages = [...messages, ...outcome.responseMessages]`),
 * the system prompt is a constant for a document's whole run, and the tool set never changes
 * mid-run, so step N's request is step N-1's request with messages added: byte-identical
 * prefix, never edited, never re-ordered. That is the exact shape a provider prompt cache
 * wants, and #271 measured what it is worth - 53.5% of a sweep's 1,363,296 input tokens is
 * the fixed block being re-sent, and no amount of transcript pruning can reach it.
 *
 * `caching: 'auto'` is the gateway's own provider-agnostic ask (`GatewayProviderOptions`,
 * documented at vercel.com/docs/ai-gateway/models-and-providers/automatic-caching). It is the
 * right shape for this loop rather than a hand-placed marker for two reasons. It writes an
 * entry covering the whole prompt and reads it back on the next step, so it discounts the
 * accumulated transcript as well as the fixed block, where a static marker on the system
 * prompt would only ever reach the fixed part. And it is keyed on nothing this file knows: an
 * admin can switch `model_config` from `/admin/models` without a deploy, so a marker written
 * for one provider's dialect would silently stop meaning anything the moment the row changed.
 *
 * What it buys is provider-dependent, and measured rather than assumed (docs/loop-cost.md):
 * on an explicit-caching provider it is the whole difference between no caching and all of it
 * (`anthropic/claude-haiku-4.5`, six-step probe: 0 of 5 calls after the first cached without
 * it, 5 of 5 and 97.2% of input tokens with it). On Google, OpenAI and DeepSeek the gateway
 * documents it as a no-op, because those providers cache implicitly whether or not anyone
 * asks, and today's `cheap` row is one of them. It is set unconditionally anyway: it costs
 * one field on a request that already exists, and the loop must not depend on which row is
 * active for its prefix to be cacheable. */
const STABLE_PREFIX_CACHE_CONTROL = { gateway: { caching: 'auto' } } as const;

/** What one `generateText` step produced, narrowed to exactly what the loop needs -
 * named here so nothing downstream has to reach for `ai`'s generic result type. */
interface StepOutcome {
	responseMessages: ModelMessage[];
	inputTokens: number;
	outputTokens: number;
	/** issue #271/#313: how much of `inputTokens` the provider served from its own prompt
	 * cache, and how much of it wrote a cache entry. Subsets of `inputTokens` rather than
	 * additions to it. #271 recorded the read figure for the profiler only, because
	 * `computeCost` had no cached rate and pricing it would have been a guess; it has one now
	 * (`ModelParams.pricePerCachedInputMTok`), so both figures reach the billing path below
	 * and a job is charged what the provider charged rather than 53% more. */
	cachedInputTokens: number;
	cacheWriteInputTokens: number;
	toolCalls: Array<{ toolName: string; invalid: boolean }>;
}

/** One tool call as this step's settlement needs to see it: the SDK's own per-call
 * `invalid` flag (which is the only thing in `generateText`'s result that says whether a
 * call could be parsed at all), plus the parsed input a valid call has to be executed
 * with. */
interface StepToolCall {
	toolCallId: string;
	toolName: string;
	input: unknown;
	invalid: boolean;
}

/** issue #673: the tool calls in `messages` that no tool result answers, in the order the
 * model emitted them.
 *
 * `ai@7.0.70` added `isToolExecutionAllowedFinishReason`
 * (`src/generate-text/is-tool-execution-allowed-finish-reason.ts`), and gated
 * `generate-text.ts`'s `executeTools` call behind it: a step whose `finishReason` is
 * anything other than `stop` or `tool-calls` now has *none* of its client tools executed.
 * `length` is one of those, and `length` is exactly what `STEP_MAX_OUTPUT_TOKENS` produces,
 * so from 7.0.70 a step that batches four well-formed `entity_propose` calls and gets cut
 * off inside the fifth proposes nothing at all. Worse, the `responseMessages` it hands back
 * still carry the assistant's `tool-call` parts for the four with no matching result, and
 * the SDK's own prompt validation rejects that, so the *next* step throws
 * `MissingToolResultsError` and the document fails.
 *
 * Issue #212's guarantee is that a model which truncates its fifth proposal costs the GM
 * the fifth and not the document, and a guarantee a minor version bump can remove is not
 * one. So this and `settleUnansweredToolCalls` below make it ours. What they act on is a
 * property of the transcript - a call nothing answers - never a version number or a
 * finish reason, which is what makes the same code correct whether the SDK executed the
 * step's tools or declined to. On a version or a step where it did, this finds nothing and
 * costs one pass over two short arrays.
 *
 * A `providerExecuted` call is answered by the provider rather than by us, and is left
 * alone for the same reason the SDK leaves it alone. */
function unansweredToolCallIds(messages: ModelMessage[]): string[] {
	const emitted: string[] = [];
	const answered = new Set<string>();
	for (const message of messages) {
		if (message.role === 'assistant' && Array.isArray(message.content)) {
			for (const part of message.content) {
				if (part.type === 'tool-call' && part.providerExecuted !== true) {
					emitted.push(part.toolCallId);
				}
			}
		} else if (message.role === 'tool') {
			for (const part of message.content) {
				if (part.type === 'tool-result') answered.add(part.toolCallId);
			}
		}
	}
	return emitted.filter((id) => !answered.has(id));
}

function toolErrorResult(toolCallId: string, toolName: string, message: string): ToolResultPart {
	return {
		type: 'tool-result',
		toolCallId,
		toolName,
		output: { type: 'error-text', value: message }
	};
}

/** issue #673: runs the tool calls the SDK left unanswered and appends their results, so a
 * step the SDK declined to execute settles exactly as it did before `ai@7.0.70` - every
 * valid call executed, every invalid one answered with an error the model can read on its
 * next turn, and a transcript the next step can actually be built from.
 *
 * Executing a complete tool call out of a truncated response is a product decision rather
 * than a workaround, and it is #212's: a call the SDK marked valid parsed as whole JSON
 * against its own schema, and `entity_propose` proposes rather than writes, so nothing
 * reaches canon without the accept guardrail 1 requires either way. Nothing here touches
 * `invalid`, so #134's all-invalid failure and #212's `partial_loss` count still read the
 * SDK's own per-call verdict rather than ours. */
async function settleUnansweredToolCalls(
	responseMessages: ModelMessage[],
	calls: StepToolCall[],
	tools: ToolSet,
	promptMessages: ModelMessage[],
	abortSignal: AbortSignal
): Promise<ModelMessage[]> {
	const unanswered = unansweredToolCallIds(responseMessages);
	if (unanswered.length === 0) return responseMessages;

	const byId = new Map(calls.map((call) => [call.toolCallId, call]));
	const results: ToolResultPart[] = [];
	for (const toolCallId of unanswered) {
		const call = byId.get(toolCallId);
		// A call the step's own result never listed cannot be executed, and is still
		// answered: an unanswered id is what makes the next step's prompt invalid, so
		// leaving one behind would trade a lost proposal for a dead document.
		if (!call) {
			results.push(toolErrorResult(toolCallId, 'unknown', 'this tool call could not be read back'));
			continue;
		}
		if (call.invalid) {
			results.push(
				toolErrorResult(
					toolCallId,
					call.toolName,
					'this tool call could not be parsed, most likely truncated by the output limit'
				)
			);
			continue;
		}
		const execute = tools[call.toolName]?.execute as
			| ((input: unknown, options: ToolExecutionOptions<unknown>) => PromiseLike<unknown>)
			| undefined;
		if (!execute) {
			results.push(
				toolErrorResult(toolCallId, call.toolName, 'this tool is not available in this run')
			);
			continue;
		}
		try {
			const output = await execute(call.input, {
				toolCallId,
				messages: promptMessages,
				abortSignal,
				context: undefined
			});
			results.push({
				type: 'tool-result',
				toolCallId,
				toolName: call.toolName,
				output: {
					type: 'json',
					value: (output ?? null) as Extract<ToolResultPart['output'], { type: 'json' }>['value']
				}
			});
		} catch (error) {
			const errorName = error instanceof Error ? error.name : 'UnknownError';
			results.push(
				toolErrorResult(toolCallId, call.toolName, `this tool call failed: ${errorName}`)
			);
		}
	}
	// Appended as its own `tool` message rather than merged into the one the SDK returned:
	// `ai`'s `convertToLanguageModelPrompt` combines consecutive `tool` messages before any
	// provider sees them, so this is one extra message to this loop and none on the wire,
	// and nothing the SDK handed back is mutated.
	return [...responseMessages, { role: 'tool', content: results }];
}

async function callStep(
	model: LanguageModel,
	system: string,
	messages: ModelMessage[],
	tools: ToolSet,
	maxOutputTokens: number,
	abortSignal: AbortSignal
): Promise<StepOutcome> {
	const result = await generateText({
		model,
		system,
		messages,
		tools,
		maxOutputTokens,
		abortSignal,
		providerOptions: STABLE_PREFIX_CACHE_CONTROL
	});
	const calls: StepToolCall[] = result.toolCalls.map((call) => ({
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		input: call.input,
		invalid: 'invalid' in call && call.invalid === true
	}));
	return {
		responseMessages: await settleUnansweredToolCalls(
			result.responseMessages,
			calls,
			tools,
			messages,
			abortSignal
		),
		inputTokens: result.usage.inputTokens ?? 0,
		outputTokens: result.usage.outputTokens ?? 0,
		cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
		cacheWriteInputTokens: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
		toolCalls: calls.map((call) => ({ toolName: call.toolName, invalid: call.invalid }))
	};
}

function progressEvent(
	ctx: DocumentRunContext,
	step: number,
	status: DocumentStatus,
	detail: string
): JobEvent {
	return {
		type: 'progress',
		jobId: ctx.jobId,
		documentId: ctx.documentId,
		step,
		status,
		entityCount: ctx.entityCount,
		relationCount: ctx.relationCount,
		detail
	};
}

interface RunDocumentParams {
	jobId: string;
	playbook: LoadedPlaybook;
	document: JobDocument;
	sources: SourceReader;
	images: ImageStore;
	models: ModelSelector;
	gateway: GatewayWrapper;
	logger: LoopLogger;
	abortSignal: AbortSignal;
	budget: BudgetTracker;
	/** issue #271: absent in production and in every existing test, in which case nothing
	 * in this file profiles anything. Attached by `packages/bench`'s `loop-cost` runner to
	 * record what each step's input was built from. */
	profiler?: StepProfiler;
}

/** issue #273: how many extra attempts one step gets, each asking for less, after every
 * tool call in it comes back invalid, before the document fails exactly as it did before
 * this existed. A retry is a real model call - priced against the budget and charged and
 * logged the same as any other (see the retry loop in `runDocument`) - so this cannot be
 * unbounded, or a document that keeps overflowing `STEP_MAX_OUTPUT_TOKENS` no matter how
 * small the ask would spend the job's budget one retry at a time and never finish either
 * way. Three retries (four attempts total for the one step) gives the smaller-ask
 * instruction below room to actually work rather than judging it on a single reroll, and
 * keeps the worst case this adds small next to a document's real `stepBudget` (tens of
 * steps for a healthy run) - a step that still cannot produce one valid tool call after
 * being told four times to propose less is not a truncation the model can be argued out
 * of, and failing loudly, as today, is the right call at that point. */
const STEP_PARSE_RETRY_LIMIT = 3;

/** issue #273: appended as a fresh user turn ahead of a retry - never the previous
 * (invalid) attempt's own output, which `runDocument`'s retry loop drops rather than
 * resends (see the loop's own comment for why re-sending it would be worse than useless).
 * This is deliberately an instruction, not a context trim: `STEP_MAX_OUTPUT_TOKENS` caps
 * this step's *output*, and shrinking the *input* transcript does not mechanically shrink
 * the next response - the two root causes issue #273 itself lists (a document's transcript
 * growing step over step, and a playbook's own "catch up, propose everything left" framing
 * near a step ceiling) are both about what the model decides to attempt in one turn, which
 * a direct instruction addresses without the risk of the other lever: slicing arbitrary
 * messages out of a tool-calling transcript can orphan a tool result whose matching call
 * got cut, and a real provider rejects that outright - trading a soft, recoverable
 * truncation for a hard, unrecoverable request error is a worse trade than the one this
 * retry exists to avoid. */
function retryWithSmallerAskMessage(): ModelMessage {
	return {
		role: 'user',
		content:
			"Your last response's tool calls could not be read back, most likely because " +
			'the response was cut off before it finished. Propose fewer things this turn - ' +
			"a handful, not everything that's left - call checkpoint, and continue with the " +
			'rest on your next turn.'
	};
}

/** Runs the bounded tool-calling loop for exactly one document, yielding events as
 * each step resolves. Returns (without throwing) on completion, on hitting the
 * playbook's step ceiling, on cancellation, or on hitting the job's credit ceiling -
 * every one of those is a reported outcome on the stream, never an unhandled loop. */
async function* runDocument(params: RunDocumentParams): AsyncGenerator<JobEvent> {
	const { playbook, document, jobId } = params;
	// issue #126, SPEC.md §17: the document's own language, read once before the loop
	// starts rather than left to the model to self-report - the same "detected, never
	// asserted" rule §17 puts on `entity.language` applies here, and a model asked to
	// name its own output language is exactly the kind of self-grading a heuristic
	// exists to avoid. Runs over the *whole* document text, which carries far more
	// signal than any one entity's short `summary` - a summary alone can legitimately
	// fall under `detectLanguage`'s minimum-word floor even when the source document
	// plainly is not mixed. A document a real `SourceReader` cannot produce text for (a
	// source path that does not resolve, or genuinely binary content) yields `null`,
	// the same honest "unknown" answer as a body too short to call - the model still
	// gets its own chance to `source_read` the path and see the real error.
	let documentLanguage: Locale | null = null;
	try {
		const { content } = await params.sources.read(document.sourcePath);
		documentLanguage = detectLanguage(content);
	} catch {
		documentLanguage = null;
	}
	const ctx = createDocumentRunContext(jobId, document.id, document.sourcePath, documentLanguage);
	const enabledTools = new Set<string>(playbook.tools);
	const tools = createImportTools(
		ctx,
		{ sources: params.sources, images: params.images },
		enabledTools
	);
	const toolCount = Object.keys(tools).length;
	// issue #271: the real serialized size of the tool surface, computed once because the
	// tool set never changes mid-run, and only when someone is listening - an unprofiled
	// run does not pay for a zod-to-JSON-Schema conversion it will not read.
	const schemaChars = params.profiler ? toolSchemaChars(tools) : 0;

	let messages: ModelMessage[] = [
		{
			role: 'user',
			content:
				`Process the document with id "${document.id}" at path "${document.sourcePath}" ` +
				`in this job's unpacked export. Call source_read on that path first.`
		}
	];
	// issue #134: the *initial* prompt, before the loop grows `messages` - reused every
	// step to size the one-time reserve `wouldExceedCeiling` grants this job toward its
	// first proposal, so the reserve stays a fixed, bounded quantity rather than growing
	// with however deep into the conversation the job happens to be when it needs it.
	const initialMessages = messages;
	let nextPurposeIsMultimodal = false;

	for (let step = 1; step <= playbook.stepBudget; step++) {
		ctx.step = step;

		if (params.abortSignal.aborted) {
			params.logger.log({
				event: 'job_cancelled',
				status: 'ok',
				jobId,
				documentId: document.id,
				playbookId: playbook.id,
				playbookVersion: playbook.version,
				step,
				toolName: null,
				latencyMs: 0,
				errorName: null
			});
			yield progressEvent(ctx, step, 'cancelled', 'cancelled before this step started');
			return;
		}

		// issue #273: a step whose every tool call fails to parse gets up to
		// STEP_PARSE_RETRY_LIMIT extra attempts, each asking for less, before this step is
		// allowed to fail the document below. `outcome` is always assigned by the time it
		// is read after this loop: every exit (`break`) is reached only once a `callStep`
		// call has actually returned, either in this iteration or - for the ceiling-can't-
		// afford-a-retry exit - an earlier one of the same step.
		let outcome!: StepOutcome;
		let retryCount = 0;

		for (;;) {
			const purpose: ImportModelPurpose = nextPurposeIsMultimodal
				? 'multimodal'
				: document.hard
					? 'premium'
					: playbook.modelPurpose;
			const resolved = await params.models.resolve(purpose);
			const languageModel = params.gateway(resolved.languageModel);

			// issue #273: a retry sends the real transcript plus one "ask for less"
			// instruction - never a previous (failed) attempt's own output, which
			// `retryWithSmallerAskMessage`'s own comment explains is dropped rather than
			// resent.
			const stepMessages =
				retryCount === 0 ? messages : [...messages, retryWithSmallerAskMessage()];

			// issue #271: what this exact request is built from, split into the buckets the
			// issue names, captured before the call so the sample can be paired with the
			// provider's own reported token count below.
			const profile: StepProfile | null = params.profiler
				? profileStep({
						step,
						attempt: retryCount,
						systemPrompt: playbook.systemPrompt,
						messages: stepMessages,
						toolSchemaChars: schemaChars
					})
				: null;

			// issue #134: price this step's worst case before calling the model at all - known
			// input (the system prompt, the conversation so far, the tools on offer) plus the
			// most output the call can produce (`STEP_MAX_OUTPUT_TOKENS`, enforced below by
			// `callStep`'s own `maxOutputTokens`). A step that cannot fit even in the worst case
			// is refused here, before it starts, rather than discovered afterwards.
			const worstCase = estimateWorstCaseCredits(
				playbook.systemPrompt,
				stepMessages,
				toolCount,
				resolved.params
			);
			const reserveCredits = estimateWorstCaseCredits(
				playbook.systemPrompt,
				initialMessages,
				toolCount,
				resolved.params
			);
			if (params.budget.wouldExceedCeiling(worstCase, reserveCredits)) {
				if (retryCount === 0) {
					params.logger.log({
						event: 'budget_ceiling',
						status: 'ok',
						jobId,
						documentId: document.id,
						playbookId: playbook.id,
						playbookVersion: playbook.version,
						step,
						toolName: null,
						latencyMs: 0,
						errorName: null
					});
					yield progressEvent(
						ctx,
						step,
						'stopped_at_ceiling',
						"this step's worst case would not fit this job's remaining credit budget"
					);
					return;
				}
				// issue #273: a retry is another real model call, priced and gated exactly like
				// the first attempt - one this job's budget cannot afford does not get to run
				// quietly. Stop retrying and let this step's last (still all-invalid) outcome
				// fall through to the same failure below, rather than spend outside what the
				// job was admitted with.
				break;
			}

			const startedAt = Date.now();
			try {
				outcome = await callStep(
					languageModel,
					playbook.systemPrompt,
					stepMessages,
					tools,
					STEP_MAX_OUTPUT_TOKENS,
					params.abortSignal
				);
			} catch (error) {
				if (params.abortSignal.aborted) {
					params.logger.log({
						event: 'job_cancelled',
						status: 'ok',
						jobId,
						documentId: document.id,
						playbookId: playbook.id,
						playbookVersion: playbook.version,
						step,
						toolName: null,
						latencyMs: Date.now() - startedAt,
						errorName: null
					});
					yield progressEvent(ctx, step, 'cancelled', 'cancelled mid-step');
					return;
				}
				const errorName = error instanceof Error ? error.name : 'UnknownError';
				params.logger.log({
					event: 'step',
					status: 'error',
					jobId,
					documentId: document.id,
					playbookId: playbook.id,
					playbookVersion: playbook.version,
					step,
					toolName: null,
					latencyMs: Date.now() - startedAt,
					errorName
				});
				yield progressEvent(ctx, step, 'failed', `model call failed: ${errorName}`);
				return;
			}
			const latencyMs = Date.now() - startedAt;
			params.logger.log({
				event: retryCount === 0 ? 'step' : 'step_retry',
				status: 'ok',
				jobId,
				documentId: document.id,
				playbookId: playbook.id,
				playbookVersion: playbook.version,
				step,
				toolName: null,
				latencyMs,
				errorName: null
			});

			// issue #313: what the provider actually charged, cache buckets included. Every step
			// after the first re-sends a prefix it has already sent, so on a provider that caches
			// this is most of the step, and pricing it as fresh input overstated a job's bill by
			// 53% across #271's own sweep.
			const { credits, costEur } = computeCost(resolved.params, {
				inputTokens: outcome.inputTokens,
				outputTokens: outcome.outputTokens,
				embeddingTokens: 0,
				images: 0,
				cachedInputTokens: outcome.cachedInputTokens,
				cacheWriteInputTokens: outcome.cacheWriteInputTokens
			});
			params.budget.spend(credits);
			if (params.profiler && profile) {
				params.profiler({
					...profile,
					jobId,
					documentId: document.id,
					playbookId: playbook.id,
					playbookVersion: playbook.version,
					purpose,
					provider: resolved.provider,
					modelId: resolved.modelId,
					reportedInputTokens: outcome.inputTokens,
					cachedInputTokens: outcome.cachedInputTokens,
					reportedOutputTokens: outcome.outputTokens,
					credits
				});
			}
			// issue #134: once this job has proposed anything, `wouldExceedCeiling`'s reserve
			// grace is no longer needed - its whole purpose was making sure a job did not end at
			// zero proposals, and that has already happened.
			if (ctx.pending.some((event) => event.type === 'proposal')) {
				params.budget.markProposed();
			}

			// issue #273: charged and logged like any other model call, whether this is the
			// step's first attempt or one of its retries - nothing here spends quietly.
			yield {
				type: 'usage',
				jobId,
				documentId: document.id,
				step,
				purpose,
				provider: resolved.provider,
				modelId: resolved.modelId,
				inputTokens: outcome.inputTokens,
				outputTokens: outcome.outputTokens,
				credits,
				costEur,
				latencyMs
			};

			for (const event of ctx.pending.splice(0)) yield event;

			for (const call of outcome.toolCalls) {
				params.logger.log({
					event: 'tool_call',
					status: call.invalid ? 'error' : 'ok',
					jobId,
					documentId: document.id,
					playbookId: playbook.id,
					playbookVersion: playbook.version,
					step,
					toolName: call.toolName,
					latencyMs: 0,
					errorName: null
				});
			}

			// issue #134/#273: every tool call this attempt made came back invalid - retry
			// with a smaller ask, up to STEP_PARSE_RETRY_LIMIT times, before letting the step
			// settle as a failure below. Anything else (some or all calls valid, or none
			// attempted at all) settles this step now.
			const attemptInvalid = outcome.toolCalls.filter((call) => call.invalid);
			const attemptAllInvalid =
				outcome.toolCalls.length > 0 && attemptInvalid.length === outcome.toolCalls.length;
			if (!attemptAllInvalid || retryCount >= STEP_PARSE_RETRY_LIMIT) break;
			retryCount += 1;
		}

		// issue #273: only the settled attempt's response joins the real transcript -
		// a step rescued by a retry carries forward exactly as if it had succeeded on the
		// first try, never the "ask for less" instruction or the failed attempt(s) that
		// came before it. That is the point: a document that needed one retry on step 4
		// should not read any different to a later step than a document that never did.
		messages = [...messages, ...outcome.responseMessages];

		// issue #134: the AI SDK already skips executing an invalid tool call (a response
		// it could not parse against the tool's schema - most plausibly here, one truncated
		// mid-JSON by `STEP_MAX_OUTPUT_TOKENS`) without raising - `callStep` never throws
		// for it, and without this check the only trace would be the `tool_call` log lines
		// just above, never anything a GM sees. A step that attempted at least one tool
		// call and got nothing usable back from any of them ends the document loudly
		// instead of silently losing whatever it was trying to propose - issue #273's retry
		// loop above already gave this step every chance a smaller ask could buy it.
		const invalidToolCalls = outcome.toolCalls.filter((call) => call.invalid);
		if (outcome.toolCalls.length > 0 && invalidToolCalls.length === outcome.toolCalls.length) {
			yield progressEvent(
				ctx,
				step,
				'failed',
				'every tool call in this step failed to parse, most likely truncated by the output limit'
			);
			return;
		}
		// issue #212: some, but not all, of this step's tool calls came back invalid. The
		// step's valid calls already landed as their own `proposal` events above, and the
		// model gets the SDK's synthetic tool-error result for the invalid ones on its next
		// step so it can retry narrower - the document keeps running. What was silent before
		// is that a GM had no way to know this step proposed less than the model attempted.
		if (invalidToolCalls.length > 0) {
			yield {
				type: 'partial_loss',
				jobId,
				documentId: document.id,
				step,
				lostToolCallCount: invalidToolCalls.length,
				detail: `${invalidToolCalls.length} of ${outcome.toolCalls.length} tool call(s) in this step failed to parse, most likely truncated by the output limit`
			};
		}
		nextPurposeIsMultimodal = outcome.toolCalls.some((call) => call.toolName === 'page_image');

		if (ctx.finished) return;

		if (params.budget.exceeded()) {
			params.logger.log({
				event: 'budget_ceiling',
				status: 'ok',
				jobId,
				documentId: document.id,
				playbookId: playbook.id,
				playbookVersion: playbook.version,
				step,
				toolName: null,
				latencyMs: 0,
				errorName: null
			});
			yield progressEvent(ctx, step, 'stopped_at_ceiling', "this job's credit budget is exhausted");
			return;
		}
	}

	params.logger.log({
		event: 'document_step_ceiling',
		status: 'ok',
		jobId,
		documentId: document.id,
		playbookId: playbook.id,
		playbookVersion: playbook.version,
		step: playbook.stepBudget,
		toolName: null,
		latencyMs: 0,
		errorName: null
	});
	yield progressEvent(
		ctx,
		playbook.stepBudget,
		'stopped_at_ceiling',
		"this document's step ceiling was reached"
	);
}

export class GatewayDriver implements ImportDriver {
	private readonly controllers = new Map<string, AbortController>();

	constructor(
		private readonly deps: {
			gateway: GatewayWrapper;
			models: ModelSelector;
			logger?: LoopLogger;
			/** issue #271: opt-in per-step transcript profiling. Omitted everywhere in the
			 * product; `packages/bench`'s `loop-cost` runner is the one caller that passes
			 * one, and with it omitted this driver does no profiling work at all. */
			profiler?: StepProfiler;
		}
	) {}

	startJob(job: ImportJob): JobStream {
		const controller = new AbortController();
		this.controllers.set(job.id, controller);
		const logger = this.deps.logger ?? loopLogger;
		const gateway = this.deps.gateway;
		const models = this.deps.models;
		const controllers = this.controllers;
		const profiler = this.deps.profiler;

		async function* run(): AsyncGenerator<JobEvent> {
			const budget = createBudgetTracker(job.budget.maxCredits);
			try {
				for (const document of job.documents) {
					if (controller.signal.aborted || budget.exceeded()) return;
					yield* runDocument({
						jobId: job.id,
						playbook: job.playbook,
						document,
						sources: job.sources,
						images: job.images,
						models,
						gateway,
						logger,
						abortSignal: controller.signal,
						budget,
						...(profiler !== undefined ? { profiler } : {})
					});
				}
			} finally {
				controllers.delete(job.id);
			}
		}

		const iterator = run();
		return {
			jobId: job.id,
			[Symbol.asyncIterator]: () => iterator
		};
	}

	cancel(jobId: string): void {
		this.controllers.get(jobId)?.abort();
	}
}
