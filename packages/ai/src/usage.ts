/**
 * Cost accounting (SPEC.md §11.5, §15, issue #113): every model call is attributed -
 * user, universe, agent, operation, input/output/embedding tokens, credits, euro cost.
 * This is the only place `model_call` rows are written, and `withUsage` is the only
 * place a caller should reach for: it wraps the actual AI SDK call, measures latency,
 * extracts usage from the result, and records the row even when the call throws - the
 * provider already spent tokens processing the request before it failed.
 *
 * `credits` and `cost_eur` answer different questions and are priced two different ways.
 * `credits` is what the user's quota is charged, resolved through `chargeFor` from
 * `operation_price` - a flat, admin-editable price per operation, never derived from
 * token counts, so reading operations charge exactly zero and a price change takes
 * effect without a deploy. `cost_eur` is what the call actually cost us against the
 * resolved model's real per-token/per-image rates (`computeCost`) - the margin question
 * in SPEC.md §15 ("free to the user is not free to us") is answered by comparing the two
 * columns on the same row, which is why both are always recorded, even for a zero-credit
 * call.
 */
import type { Db } from '@canonry/db';
import { modelCall, type ModelCallAgent } from '@canonry/db/schema';
import type { ModelParams, ResolvedModel } from './models.js';
import { toEur } from './currency.js';
import { chargeFor } from './prices.js';
import { logger as defaultLogger, type Logger } from './logger.js';

export type { ModelCallAgent };

export interface ModelCallInput {
	// Nullable since migration 0014: system-attributed calls (nightly warming,
	// universe-scoped indexing) run for a universe rather than for somebody, and
	// model_call.user_id is `on delete set null` so a deleted account's own history
	// unlinks rather than vanishing (SPEC.md §11.5's margin question stays
	// answerable either way).
	userId: string | null;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
	provider: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	embeddingTokens: number;
	credits: number;
	costEur: number;
	latencyMs: number;
	requestId: string | null;
}

/** Returns the inserted row's id (issue #133) so a post-hoc caller - one whose call
 * already ran before it ever reaches this function, e.g. packages/import/src/job-runner.ts
 * turning a driver's already-finished `usage` event into a row - can attach a later,
 * differently-shaped charge (`@canonry/db`'s `spendCredits`) to the real model_call row
 * this wrote, instead of leaving that charge's own row pointing at nothing. `withUsage`
 * and `withQuota` below still call this the same way as before and simply ignore what it
 * returns. */
export async function recordCall(db: Db, input: ModelCallInput): Promise<string> {
	const [call] = await db
		.insert(modelCall)
		.values({
			userId: input.userId,
			universeId: input.universeId,
			agent: input.agent,
			operation: input.operation,
			provider: input.provider,
			modelId: input.modelId,
			inputTokens: input.inputTokens,
			outputTokens: input.outputTokens,
			embeddingTokens: input.embeddingTokens,
			credits: input.credits,
			costEur: input.costEur,
			latencyMs: input.latencyMs,
			requestId: input.requestId
		})
		.returning({ id: modelCall.id });
	if (!call) throw new Error('recordCall: model_call insert returned no row');
	return call.id;
}

/** Raw usage counts pulled out of an AI SDK result (or estimated on error). */
export interface UsageCounts {
	inputTokens: number;
	outputTokens: number;
	embeddingTokens: number;
	/** Non-token unit: one Replicate prediction, priced via `params.pricePerImage`. */
	images: number;
	/** Non-token, non-image unit: a provider's own metered credit for one call - issue
	 * #116, ElevenLabs' `character-cost` response header - priced via
	 * `params.pricePerProviderCredit`. Optional (unlike the fields above) so every
	 * existing literal `UsageCounts` object across the codebase stays valid - only the
	 * one caller that has a provider-credit figure to report needs to set it. */
	providerCredits?: number;
	/** How much of `inputTokens` the provider served from its own prompt cache, and how much
	 * of it went into writing a cache entry (issue #313). Both are **subsets** of
	 * `inputTokens`, never additions to it: every provider the gateway routes reports a total
	 * that already contains them, which the AI SDK's own usage type states
	 * (`inputTokens` is "the total number of input tokens used", `noCacheTokens` the
	 * non-cached part) and which two measured calls confirm - 684 + 6,111 = 6,795 on
	 * `google/gemini-3.1-flash-lite`, 3 + 83 + 4,291 = 4,377 on `anthropic/claude-haiku-4.5`.
	 * So `computeCost` splits `inputTokens` across three rates rather than adding a fourth
	 * term. Optional, like `providerCredits`, so every existing literal stays valid and a
	 * caller with nothing to report keeps today's arithmetic exactly. */
	cachedInputTokens?: number;
	cacheWriteInputTokens?: number;
}

export function normalizeUsage(partial: Partial<UsageCounts>): UsageCounts {
	return {
		inputTokens: partial.inputTokens ?? 0,
		outputTokens: partial.outputTokens ?? 0,
		embeddingTokens: partial.embeddingTokens ?? 0,
		images: partial.images ?? 0,
		providerCredits: partial.providerCredits ?? 0,
		cachedInputTokens: partial.cachedInputTokens ?? 0,
		cacheWriteInputTokens: partial.cacheWriteInputTokens ?? 0
	};
}

/** Default: 1 credit = EUR 0.01, overridable per model via `params.creditsPerEur`. */
const DEFAULT_CREDITS_PER_EUR = 100;

/** Splits `inputTokens` into the three buckets a provider can bill it in (issue #313):
 * fresh, served from cache, and written to cache. The two cache figures are subsets of the
 * total, so fresh is what is left over, clamped so a provider reporting a cache count larger
 * than its own total cannot produce a negative bill. */
function splitInput(usage: UsageCounts): { fresh: number; cacheRead: number; cacheWrite: number } {
	const cacheRead = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), usage.inputTokens);
	const cacheWrite = Math.min(
		Math.max(usage.cacheWriteInputTokens ?? 0, 0),
		usage.inputTokens - cacheRead
	);
	return { fresh: usage.inputTokens - cacheRead - cacheWrite, cacheRead, cacheWrite };
}

/** Turns raw usage plus one model's params into a euro cost and a credit charge - the
 * only place `model_call.cost_eur` is computed (issue #132), so a price crosses from
 * whatever currency the provider quotes it in into EUR here and nowhere else. */
export function computeCost(
	params: ModelParams,
	usage: UsageCounts
): { credits: number; costEur: number } {
	const currency = params.currency ?? 'EUR';
	const inputEur = toEur(params.pricePerInputMTok ?? 0, currency);
	// Both cache rates fall back to the plain input rate rather than to zero when a row does
	// not carry them: see `ModelParams.pricePerCachedInputMTok` for why that direction is the
	// only safe one.
	const cachedInputEur =
		params.pricePerCachedInputMTok !== undefined
			? toEur(params.pricePerCachedInputMTok, currency)
			: inputEur;
	const cacheWriteEur =
		params.pricePerCacheWriteMTok !== undefined
			? toEur(params.pricePerCacheWriteMTok, currency)
			: inputEur;
	const input = splitInput(usage);
	const costEur =
		(input.fresh / 1_000_000) * inputEur +
		(input.cacheRead / 1_000_000) * cachedInputEur +
		(input.cacheWrite / 1_000_000) * cacheWriteEur +
		(usage.outputTokens / 1_000_000) * toEur(params.pricePerOutputMTok ?? 0, currency) +
		(usage.embeddingTokens / 1_000_000) * toEur(params.pricePerEmbeddingMTok ?? 0, currency) +
		usage.images * toEur(params.pricePerImage ?? 0, currency) +
		(usage.providerCredits ?? 0) * toEur(params.pricePerProviderCredit ?? 0, currency);
	const credits = costEur * (params.creditsPerEur ?? DEFAULT_CREDITS_PER_EUR);
	return { credits, costEur };
}

export interface WithUsageMeta {
	userId: string | null;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
	requestId?: string;
}

export interface WithUsageOptions<T> {
	logger?: Logger;
	/**
	 * On success, pulls token/image counts out of the AI SDK result. Required:
	 * `generateText`'s `usage.inputTokens`/`usage.outputTokens`, `embed`'s
	 * `usage.tokens`, and a Replicate prediction (flat `{ images: 1 }`) all
	 * shape usage differently, so there is no single generic extractor.
	 */
	extractUsage: (result: T) => Partial<UsageCounts>;
	/**
	 * On failure, best-effort usage for the row this still records (the
	 * provider may have spent input tokens before failing). Providers rarely
	 * surface usage on a thrown error; omit this to record zero usage on
	 * failure while still capturing latency and the error name.
	 */
	extractUsageOnError?: (error: unknown) => Partial<UsageCounts>;
}

export function errorName(error: unknown): string {
	return error instanceof Error ? error.name : 'UnknownError';
}

export async function withUsage<T>(
	db: Db,
	model: ResolvedModel,
	meta: WithUsageMeta,
	fn: () => Promise<T>,
	options: WithUsageOptions<T>
): Promise<T> {
	const log = options.logger ?? defaultLogger;
	const requestId = meta.requestId ?? null;
	const startedAt = performance.now();
	// Resolved once, ahead of the call: the price is the same regardless of how fn()
	// turns out, and an unpriced operation should fail before we spend the model call at
	// all rather than after (SPEC.md §15 - nothing chargeable ships unpriced).
	const { credits } = await chargeFor(db, meta.operation);

	try {
		const result = await fn();
		const latencyMs = Math.round(performance.now() - startedAt);
		const usage = normalizeUsage(options.extractUsage(result));
		const { costEur } = computeCost(model.params, usage);

		await recordCall(db, {
			userId: meta.userId,
			universeId: meta.universeId,
			agent: meta.agent,
			operation: meta.operation,
			provider: model.provider,
			modelId: model.modelId,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			embeddingTokens: usage.embeddingTokens,
			credits,
			costEur,
			latencyMs,
			requestId
		});
		log.logCall({
			status: 'ok',
			provider: model.provider,
			modelId: model.modelId,
			purpose: model.purpose,
			agent: meta.agent,
			operation: meta.operation,
			latencyMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			embeddingTokens: usage.embeddingTokens,
			credits,
			costEur,
			requestId,
			errorName: null
		});
		return result;
	} catch (error) {
		const latencyMs = Math.round(performance.now() - startedAt);
		const usage = normalizeUsage(options.extractUsageOnError?.(error) ?? {});
		const { costEur } = computeCost(model.params, usage);

		await recordCall(db, {
			userId: meta.userId,
			universeId: meta.universeId,
			agent: meta.agent,
			operation: meta.operation,
			provider: model.provider,
			modelId: model.modelId,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			embeddingTokens: usage.embeddingTokens,
			credits,
			costEur,
			latencyMs,
			requestId
		});
		log.logCall({
			status: 'error',
			provider: model.provider,
			modelId: model.modelId,
			purpose: model.purpose,
			agent: meta.agent,
			operation: meta.operation,
			latencyMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			embeddingTokens: usage.embeddingTokens,
			credits,
			costEur,
			requestId,
			errorName: errorName(error)
		});
		throw error;
	}
}
