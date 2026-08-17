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
import { generateText, type ModelMessage, type LanguageModel, type ToolSet } from 'ai';
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
 * check below exists precisely because 8192 is a judgment call, not a guarantee. */
const STEP_MAX_OUTPUT_TOKENS = 8192;

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
 * one-time reserve `wouldExceedCeiling` grants a job that has not proposed anything yet. */
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

/** What one `generateText` step produced, narrowed to exactly what the loop needs -
 * named here so nothing downstream has to reach for `ai`'s generic result type. */
interface StepOutcome {
	responseMessages: ModelMessage[];
	inputTokens: number;
	outputTokens: number;
	toolCalls: Array<{ toolName: string; invalid: boolean }>;
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
		abortSignal
	});
	return {
		responseMessages: result.responseMessages,
		inputTokens: result.usage.inputTokens ?? 0,
		outputTokens: result.usage.outputTokens ?? 0,
		toolCalls: result.toolCalls.map((call) => ({
			toolName: call.toolName,
			invalid: 'invalid' in call && call.invalid === true
		}))
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
	const ctx = createDocumentRunContext(jobId, document.id, documentLanguage);
	const enabledTools = new Set<string>(playbook.tools);
	const tools = createImportTools(
		ctx,
		{ sources: params.sources, images: params.images },
		enabledTools
	);
	const toolCount = Object.keys(tools).length;

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

		const purpose: ImportModelPurpose = nextPurposeIsMultimodal
			? 'multimodal'
			: document.hard
				? 'premium'
				: playbook.modelPurpose;
		const resolved = await params.models.resolve(purpose);
		const languageModel = params.gateway(resolved.languageModel);

		// issue #134: price this step's worst case before calling the model at all - known
		// input (the system prompt, the conversation so far, the tools on offer) plus the
		// most output the call can produce (`STEP_MAX_OUTPUT_TOKENS`, enforced below by
		// `callStep`'s own `maxOutputTokens`). A step that cannot fit even in the worst case
		// is refused here, before it starts, rather than discovered afterwards.
		const worstCase = estimateWorstCaseCredits(
			playbook.systemPrompt,
			messages,
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

		const startedAt = Date.now();
		let outcome: StepOutcome;
		try {
			outcome = await callStep(
				languageModel,
				playbook.systemPrompt,
				messages,
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
			event: 'step',
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

		messages = [...messages, ...outcome.responseMessages];

		const { credits, costEur } = computeCost(resolved.params, {
			inputTokens: outcome.inputTokens,
			outputTokens: outcome.outputTokens,
			embeddingTokens: 0,
			images: 0
		});
		params.budget.spend(credits);
		// issue #134: once this job has proposed anything, `wouldExceedCeiling`'s reserve
		// grace is no longer needed - its whole purpose was making sure a job did not end at
		// zero proposals, and that has already happened.
		if (ctx.pending.some((event) => event.type === 'proposal')) {
			params.budget.markProposed();
		}

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
			costEur
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

		// issue #134: the AI SDK already skips executing an invalid tool call (a response
		// it could not parse against the tool's schema - most plausibly here, one truncated
		// mid-JSON by `STEP_MAX_OUTPUT_TOKENS`) without raising - `callStep` never throws
		// for it, and without this check the only trace would be the `tool_call` log lines
		// just above, never anything a GM sees. A step that attempted at least one tool
		// call and got nothing usable back from any of them ends the document loudly
		// instead of silently losing whatever it was trying to propose.
		if (outcome.toolCalls.length > 0 && outcome.toolCalls.every((call) => call.invalid)) {
			yield progressEvent(
				ctx,
				step,
				'failed',
				'every tool call in this step failed to parse, most likely truncated by the output limit'
			);
			return;
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
		private readonly deps: { gateway: GatewayWrapper; models: ModelSelector; logger?: LoopLogger }
	) {}

	startJob(job: ImportJob): JobStream {
		const controller = new AbortController();
		this.controllers.set(job.id, controller);
		const logger = this.deps.logger ?? loopLogger;
		const gateway = this.deps.gateway;
		const models = this.deps.models;
		const controllers = this.controllers;

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
						budget
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
