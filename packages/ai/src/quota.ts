/**
 * Quota enforcement (SPEC.md §15, §8.1, issues #88 and #89): the ceiling every
 * generation call is checked against before it does anything expensive, plus the warm
 * cache's own line so it can never starve interactive use.
 *
 * `withQuota` mirrors `withUsage` (usage.ts) closely on purpose - same call shape, same
 * measure/run/record structure - but persists through `@canonry/db`'s `recordAndCharge`
 * instead of the plain `recordCall`, so the model_call row and the balance movement land
 * in one transaction. `withUsage` stays exactly as it is: unpriced/read-only callers that
 * have no balance to check keep using it, and every existing caller is unaffected by this
 * file's existence. A caller whose operation is genuinely chargeable (a draft, a
 * propagation diff, an Ask answer, an image, an import extraction) should use `withQuota`
 * instead so the ceiling is real rather than theoretical.
 */
import type { Db } from '@canonry/db';
import {
	type Balance,
	getBalance,
	InsufficientCreditsError,
	previewCharge,
	recordAndCharge,
	WarmBudgetExhaustedError
} from '@canonry/db';
import type { WarmArtifactKind } from '@canonry/db/schema';
import { logger as defaultLogger } from './logger.js';
import type { ResolvedModel } from './models.js';
import { chargeFor } from './prices.js';
import {
	computeCost,
	errorName,
	normalizeUsage,
	type WithUsageMeta,
	type WithUsageOptions
} from './usage.js';

export { getBalance, InsufficientCreditsError, WarmBudgetExhaustedError, type Balance };

export type WarmTier = 'media' | 'draft' | 'text';

// SPEC.md §4.5: "warm_artifact holds pre-computed material: brief, npc_draft,
// ambient_pack, portrait, context_pack". Media (audio/image) is the expensive, unbounded
// line item SPEC.md §8.1 calls out by name (ambient packs at 3 credits per layer); drafts
// are the proposals table mode pre-generates; the two text kinds are the cheap two-line
// briefs and context packs that should be the last thing to stop.
const WARM_TIER_BY_KIND: Record<WarmArtifactKind, WarmTier> = {
	ambient_pack: 'media',
	portrait: 'media',
	npc_draft: 'draft',
	brief: 'text',
	context_pack: 'text'
};

export function warmTierOf(kind: WarmArtifactKind): WarmTier {
	return WARM_TIER_BY_KIND[kind];
}

// SPEC.md §8.1: "declared degradation... media first, then drafts, text last." Modeled as
// a reserve fraction of the total warm budget each tier refuses to spend into: media may
// not spend the last 30% of the budget, drafts may not spend the last 10%, text has no
// reserve and can spend to zero. As the budget drains this blocks media well before it
// hits zero, then drafts, and leaves text running longest - which is what makes the fixed
// order an observable property of the numbers rather than only a comment.
export const WARM_TIER_RESERVE_FRACTION: Record<WarmTier, number> = {
	media: 0.3,
	draft: 0.1,
	text: 0
};

export interface WarmSpendCheck {
	/** `Balance.warmBudgetCredits` - the total line, not what's left. */
	budgetTotal: number;
	/** `Balance.warmBudgetRemaining` before this spend. */
	remaining: number;
	/** The price of the artifact being considered, in credits. */
	cost: number;
	tier: WarmTier;
}

/** Decides whether a warm trigger may spend right now, before it generates anything -
 * the warm equivalent of `previewCharge`. Pure and DB-free so the degradation order is
 * unit-testable without a database; the actual spend, once a trigger decides to proceed,
 * goes through `@canonry/db`'s `spendWarmBudget`. */
export function warmSpendAllowed(check: WarmSpendCheck): boolean {
	const reserve = WARM_TIER_RESERVE_FRACTION[check.tier] * check.budgetTotal;
	return check.remaining - check.cost >= reserve;
}

export interface WithQuotaMeta extends WithUsageMeta {
	// Narrows WithUsageMeta.userId back to non-null: quota enforcement is meaningless
	// without a real account to check a balance against. A system-attributed call
	// (migration 0014's nullable model_call.user_id) has no quota to enforce and
	// should go through withUsage instead, not here.
	userId: string;
	/** Retry safety (issue #88): a request retried with the same key spends the balance
	 * once. Threaded straight through to `recordAndCharge` - see its doc comment for
	 * what happens on a retry and on a race with a concurrent call. */
	idempotencyKey?: string;
}

/** The quota-enforced counterpart to `withUsage`: resolves the operation's price, refuses
 * the call before it runs when the balance cannot cover it (issue #88 - "quota is checked
 * before expensive work"), then runs `fn()` and records the model_call row together with
 * the balance movement in one atomic write. A call that throws is still recorded in full
 * (real tokens, real euro cost - SPEC.md §15's margin question) but is never charged: the
 * user is not billed for a generation that failed to produce anything. */
export async function withQuota<T>(
	db: Db,
	model: ResolvedModel,
	meta: WithQuotaMeta,
	fn: () => Promise<T>,
	options: WithUsageOptions<T>
): Promise<T> {
	const log = options.logger ?? defaultLogger;
	const requestId = meta.requestId ?? null;
	const { credits } = await chargeFor(db, meta.operation);
	await previewCharge(db, meta.userId, credits);

	const startedAt = performance.now();
	try {
		const result = await fn();
		const latencyMs = Math.round(performance.now() - startedAt);
		const usage = normalizeUsage(options.extractUsage(result));
		const { costEur } = computeCost(model.params, usage);

		await recordAndCharge(db, {
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
			requestId,
			idempotencyKey: meta.idempotencyKey ?? null
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

		// credits: 0 - a failed call is recorded for the margin question but never
		// billed to the user; see the function doc.
		await recordAndCharge(db, {
			userId: meta.userId,
			universeId: meta.universeId,
			agent: meta.agent,
			operation: meta.operation,
			provider: model.provider,
			modelId: model.modelId,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			embeddingTokens: usage.embeddingTokens,
			credits: 0,
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
			credits: 0,
			costEur,
			requestId,
			errorName: errorName(error)
		});
		throw error;
	}
}
