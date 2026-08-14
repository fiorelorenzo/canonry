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

export async function recordCall(db: Db, input: ModelCallInput): Promise<void> {
	await db.insert(modelCall).values({
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
	});
}

/** Raw usage counts pulled out of an AI SDK result (or estimated on error). */
export interface UsageCounts {
	inputTokens: number;
	outputTokens: number;
	embeddingTokens: number;
	/** Non-token unit: one Replicate prediction, priced via `eurPerImage`. */
	images: number;
}

export function normalizeUsage(partial: Partial<UsageCounts>): UsageCounts {
	return {
		inputTokens: partial.inputTokens ?? 0,
		outputTokens: partial.outputTokens ?? 0,
		embeddingTokens: partial.embeddingTokens ?? 0,
		images: partial.images ?? 0
	};
}

/** Default: 1 credit = EUR 0.01, overridable per model via `params.creditsPerEur`. */
const DEFAULT_CREDITS_PER_EUR = 100;

export function computeCost(
	params: ModelParams,
	usage: UsageCounts
): { credits: number; costEur: number } {
	const costEur =
		(usage.inputTokens / 1_000_000) * (params.eurPerInputMTok ?? 0) +
		(usage.outputTokens / 1_000_000) * (params.eurPerOutputMTok ?? 0) +
		(usage.embeddingTokens / 1_000_000) * (params.eurPerEmbeddingMTok ?? 0) +
		usage.images * (params.eurPerImage ?? 0);
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
