/**
 * Propagation, end to end (SPEC.md §5.1): "on save, debounced, in the background" through
 * a semantic diff, a candidate set, a readable plan, and per-entry diffs. This file
 * orchestrates issues #48, #49, #50, #52 and #56's pieces; it writes nothing to canon
 * itself - `@canonry/db`'s `proposals.ts` is still the only place that happens, at accept.
 *
 * Two entry points, matching decision C3's split: `planPropagation` runs steps 1-3 (diff,
 * candidates, the readable plan a GM can edit before anything else is spent), and
 * `generatePlanDiffs` runs step 4 (the premium per-entry diffs) once the GM is done
 * dropping entries. Nothing calls `generatePlanDiffs` automatically - decision C3 exists
 * precisely so a GM can drop candidates for free between the two.
 */
import { chargeFor, resolveModel } from '@canonry/ai';
import { eq, type Db } from '@canonry/db';
import { entity, universe } from '@canonry/db/schema';
import { canonLanguageFor, type Locale } from '@canonry/lang';
import {
	createProposalPlan,
	listProposalsForPlan,
	recordProposalDiff,
	rejectedProposalsFor,
	setProposalPlanStatus,
	type ProposalPlanRow,
	type ProposalRow
} from '@canonry/db';
import type { CandidateEvidence, EmbeddingMatch } from './candidates.js';
import { buildCandidatePool } from './candidates.js';
import { loadCandidateGraph } from './db-graph.js';
import type { FactChange } from './diff.js';
import { semanticDiff } from './diff.js';
import { writeEntityDiff } from './diffs.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { routeModel } from './models.js';
import { writePlanRationale } from './ranking.js';
import { effectiveCap, scoreCandidates, type RejectionRecord } from './reject-signal.js';

/** One switch, shared by every Loremaster mode that generates - propagate, ask, complete,
 * audit - not a separate error per mode (mirrors `packages/media`'s own `AiDisabledError`,
 * which every media kind in that package reuses the same way). */
export class AiDisabledError extends Error {
	constructor(universeId: string) {
		super(`universe "${universeId}" has generation switched off (guardrail 4)`);
		this.name = 'AiDisabledError';
	}
}

/** Guardrail 4: the switch stops generation completely. Checked first, before any model
 * resolution or spend, by every function in this package that generates - reading
 * (retrieval, search, mention suggestions) never calls this, since guardrail 4 keeps
 * those alive on purpose (docs/ux/DECISIONS.md, H1). */
export async function requireAiEnabled(db: Db, universeId: string): Promise<void> {
	const [row] = await db
		.select({ aiEnabled: universe.aiEnabled })
		.from(universe)
		.where(eq(universe.id, universeId))
		.limit(1);
	if (!row) throw new Error(`no universe row for id "${universeId}"`);
	if (!row.aiEnabled) throw new AiDisabledError(universeId);
}

function extractRelationLabels(evidence: unknown): string[] {
	if (!Array.isArray(evidence)) return [];
	const labels: string[] = [];
	for (const item of evidence) {
		if (
			item &&
			typeof item === 'object' &&
			(item as { kind?: unknown }).kind === 'relation' &&
			Array.isArray((item as { path?: unknown }).path)
		) {
			labels.push(...((item as { path: unknown[] }).path as string[]));
		}
	}
	return labels;
}

export interface PlanPropagationInput {
	db: Db;
	userId: string;
	universeId: string;
	editedEntityId: string;
	editedEntityName: string;
	oldBody: string;
	newBody: string;
	triggerRevisionId?: string | null;
	/** Base cap before issue #56's "too much" adjustment (SPEC.md §5.1: "~10"). */
	cap?: number;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	embeddingMatches?: EmbeddingMatch[];
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever made this edit -
	 * the plan's summary and every per-candidate rationale are written in this, recorded
	 * onto every proposal in the plan (`proposal.locale`) so accept rate can be read per
	 * locale (issue #128). Never the language of the edit itself, which stays on
	 * `entity.language` and drives rule three instead (`generatePlanDiffs`). */
	locale: Locale;
	requestId?: string;
}

export interface PlanPropagationResult {
	plan: ProposalPlanRow;
	proposals: ProposalRow[];
	diff: FactChange[];
}

const DEFAULT_CAP = 10;

/** SPEC.md §5.1 steps 1-3: semantic diff, candidate set, readable plan. Charges
 * `propagate.plan` once (issue #52's cheap model) and nothing else - the per-entry
 * `propagate.diff` charge only happens once the GM asks for diffs via
 * `generatePlanDiffs`. Returns `null` when the edit produced no semantic change at all
 * (e.g. a whitespace-only save): there is nothing to plan, and nothing is charged. */
export async function planPropagation(
	input: PlanPropagationInput
): Promise<PlanPropagationResult | null> {
	await requireAiEnabled(input.db, input.universeId);

	const diff = semanticDiff(input.oldBody, input.newBody);
	if (diff.length === 0) return null;

	const graph = await loadCandidateGraph(input.db, input.universeId);
	const pool = buildCandidatePool(graph, input.editedEntityId, diff, {
		...(input.embeddingMatches !== undefined ? { embeddingMatches: input.embeddingMatches } : {})
	});

	const rejectedRows = await rejectedProposalsFor(input.db, input.universeId);
	const history: RejectionRecord[] = rejectedRows
		.filter((row): row is typeof row & { targetEntityId: string } => row.targetEntityId !== null)
		.map((row) => ({
			targetEntityId: row.targetEntityId,
			relationLabels: extractRelationLabels(row.evidence),
			reason: row.reason
		}));

	const ranked = scoreCandidates(pool, history);
	const baseCap = input.cap ?? DEFAULT_CAP;
	const cap = effectiveCap(
		baseCap,
		rejectedRows.slice(0, 20).map((row) => row.reason)
	);
	const capped = ranked.slice(0, cap);

	const entityById = new Map(graph.entities.map((e) => [e.id, e]));
	const cheapModel = routeModel(
		await resolveModel(input.db, 'cheap'),
		input.modelFactory,
		input.gateway
	);

	const planRationale = await writePlanRationale({
		db: input.db,
		userId: input.userId,
		universeId: input.universeId,
		editedEntityName: input.editedEntityName,
		diff,
		candidates: capped.map((c) => ({
			entityId: c.entityId,
			name: entityById.get(c.entityId)?.name ?? c.entityId
		})),
		model: cheapModel,
		locale: input.locale,
		...(input.requestId !== undefined ? { requestId: input.requestId } : {})
	});

	const rationaleById = new Map(planRationale.candidates.map((c) => [c.entityId, c.rationale]));
	// The model may have dropped a candidate (ranking.ts's doc comment) by leaving it out
	// of its response; only what it kept a rationale for reaches the plan.
	const survivors = capped.filter((c) => rationaleById.has(c.entityId));

	const diffPrice = await chargeFor(input.db, 'propagate.diff');
	const estimatedCredits = planRationale.credits + survivors.length * diffPrice.credits;

	const { plan, proposals } = await createProposalPlan(input.db, {
		universeId: input.universeId,
		trigger: 'save',
		triggerEntityId: input.editedEntityId,
		triggerRevisionId: input.triggerRevisionId ?? null,
		summary: planRationale.summary,
		candidateCap: baseCap,
		estimatedCredits,
		locale: input.locale,
		candidates: survivors.map((c, index) => ({
			kind: 'update' as const,
			targetEntityId: c.entityId,
			rationale: rationaleById.get(c.entityId) ?? '',
			evidence: c.evidence,
			rank: index
		}))
	});

	return { plan, proposals, diff };
}

function hasNoDiffYet(patch: unknown): boolean {
	return (
		typeof patch === 'object' &&
		patch !== null &&
		!Array.isArray(patch) &&
		Object.keys(patch).length === 0
	);
}

export interface GeneratePlanDiffsInput {
	db: Db;
	userId: string;
	universeId: string;
	planId: string;
	editedEntityId: string;
	editedEntityName: string;
	/** The same edit that produced the plan - every per-entry diff explains itself against
	 * the same "what changed" text (SPEC.md §5.1 step 4). */
	diff: FactChange[];
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever made the
	 * original edit - each diff's `patch.summary` is written in this. */
	locale: Locale;
	requestId?: string;
}

export interface GeneratePlanDiffsResult {
	plan: ProposalPlanRow;
	written: ProposalRow[];
}

/** SPEC.md §5.1 step 4: one diff per surviving entry, from the premium model (issue #52).
 * Only touches proposals still pending with no diff yet - re-running after a partial
 * failure never re-charges an entry that already has one. Marks the plan `spent` once
 * every surviving candidate has a diff. */
export async function generatePlanDiffs(
	input: GeneratePlanDiffsInput
): Promise<GeneratePlanDiffsResult> {
	await requireAiEnabled(input.db, input.universeId);

	const all = await listProposalsForPlan(input.db, input.planId);
	const undiffed = all.filter((p) => p.outcome === 'pending' && hasNoDiffYet(p.patch));

	const premiumModel = routeModel(
		await resolveModel(input.db, 'premium'),
		input.modelFactory,
		input.gateway
	);

	// SPEC.md §17 rule three: the edited/triggering entity's own recorded language and
	// current body, fetched once - `canonLanguageFor`'s last fallback before English, for
	// a target entity whose own language and body are both unknown.
	const [editedEntityRow] = await input.db
		.select()
		.from(entity)
		.where(eq(entity.id, input.editedEntityId))
		.limit(1);

	const written: ProposalRow[] = [];
	for (const candidate of undiffed) {
		if (candidate.kind !== 'update' || !candidate.targetEntityId) continue;

		const [entityRow] = await input.db
			.select()
			.from(entity)
			.where(eq(entity.id, candidate.targetEntityId))
			.limit(1);
		if (!entityRow) continue;

		const contentLanguage = canonLanguageFor({
			targetLanguage: entityRow.language,
			targetBody: entityRow.body,
			triggerLanguage: editedEntityRow?.language ?? null,
			triggerBody: editedEntityRow?.body ?? null
		});

		const evidence = Array.isArray(candidate.evidence)
			? (candidate.evidence as CandidateEvidence[])
			: [];
		const result = await writeEntityDiff({
			db: input.db,
			userId: input.userId,
			universeId: input.universeId,
			targetEntityName: entityRow.name,
			targetEntityBody: entityRow.body,
			planRationale: candidate.rationale,
			evidence,
			editedEntityName: input.editedEntityName,
			diff: input.diff,
			model: premiumModel,
			locale: input.locale,
			contentLanguage,
			...(input.requestId !== undefined ? { requestId: input.requestId } : {})
		});

		const updated = await recordProposalDiff(input.db, {
			proposalId: candidate.id,
			patch: result.patch,
			provider: result.provider,
			modelId: result.modelId,
			credits: result.credits
		});
		written.push(updated);
	}

	const plan = await setProposalPlanStatus(input.db, input.planId, 'spent');
	return { plan, written };
}
