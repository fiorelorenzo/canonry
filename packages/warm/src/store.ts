/**
 * SPEC.md §4.5 and §8.1: the store built around `warm_artifact`. Two things live here that
 * the raw queries in packages/db/src/queries/warm.ts deliberately do not decide:
 *
 * - **Lazy invalidation.** A fingerprint mismatch marks an artifact stale; it never
 *   regenerates on the spot. "An hour of editing a faction would otherwise cascade into
 *   forty regenerations."
 * - **What a regeneration produces.** For `npc_draft`, the generated content is also a
 *   `proposal` (kind `draft_entity`, trigger `table`), because a pre-generated draft is
 *   canon-shaped content and guardrail 1 applies to it exactly as it does to anything else
 *   a model writes: it lands in `proposal`, never in `entity`, until a human accepts it.
 *
 * `regenerate` never calls a model itself - `WarmGenerator` is the seam, the same
 * discipline packages/import's driver and packages/eval's injected selectors already use,
 * so this package is testable without a gateway credential and without spending real
 * money.
 */
import {
	findByFingerprint,
	latestArtifact,
	latestRevisionIds,
	markStale,
	putArtifact,
	recordConsumption,
	type Db,
	type WarmArtifactRow
} from '@canonry/db';
import { proposal, type EntityType, type WarmArtifactKind } from '@canonry/db/schema';
import { DEFAULT_LOCALE, type Locale } from '@canonry/lang';
import type { WarmBudgetPort } from './budget.js';
import { computeFingerprint } from './fingerprint.js';
import { assertWarmable } from './kinds.js';

export type ProposalRow = typeof proposal.$inferSelect;

/** One thing that could be warmed: what kind, whose subject (null for a ring-spanning
 * context pack with no single anchor entity), which entities' latest revisions feed its
 * fingerprint, and the flat credit price a trigger has already resolved for it (the same
 * "priced operation, not derived from token counts" shape `operation_price` uses
 * everywhere else in this codebase - packages/warm never prices anything itself). */
export interface WarmCandidate {
	universeId: string;
	kind: WarmArtifactKind;
	subjectEntityId: string | null;
	sourceEntityIds: string[];
	promptVersion: string;
	modelId: string;
	credits: number;
	provider?: string;
	/** Free-text reason this candidate exists, carried onto a draft_entity proposal's
	 * rationale. Ignored for kinds that never produce a proposal. */
	rationale?: string;
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever (or whatever
	 * schedule) triggered this candidate - `rationale`, and any other speech a generator
	 * writes about the candidate rather than into it, follows this. Threaded from the
	 * trigger that built the candidate (triggers.ts, which always sets it), never read
	 * from a global. Optional only so an external constructor (a hand-built candidate, an
	 * old fixture) does not fail to compile over it - `createDraftEntityProposal` below
	 * falls back to `DEFAULT_LOCALE` when it is missing, never to a guess. */
	locale?: Locale;
	/** SPEC.md §17 rule three (issue #124), via `@canonry/lang`'s `canonLanguageFor`: the
	 * language a generator must draft canon-bound prose in for this candidate. Only
	 * meaningful for a kind whose generator writes something that can become an entry
	 * (currently `npc_draft`'s `DraftEntityPayload.body`) - absent for every other kind.
	 * A generator that receives an `npc_draft` candidate with this unset must not fall
	 * back to `locale` (that is exactly the vandalism rule three exists to prevent); use
	 * `contentLanguageForSubject` (language.ts) against the subject entity instead. */
	contentLanguage?: Locale;
}

/** Only meaningful for `kind === 'npc_draft'`: the fields a `draft_entity` proposal needs.
 * `evidence` follows guardrail 3 (proposal.ts's own comment): which entry, which sentence,
 * never a bare score - shape is app-defined jsonb, same as every other proposal's evidence
 * column. */
export interface DraftEntityPayload {
	name: string;
	type: EntityType;
	body: string;
	aliases: string[];
	evidence: unknown;
}

export interface WarmGenerationResult {
	/** Stored verbatim in `warm_artifact.payload`. */
	payload: unknown;
	draftEntity?: DraftEntityPayload;
}

export type WarmGenerator = (candidate: WarmCandidate) => Promise<WarmGenerationResult>;

export interface FreshnessResult {
	fresh: boolean;
	fingerprint: string;
	/** Whatever is currently stored for this (kind, subject), fresh or stale, or null if
	 * nothing has ever been generated. Still servable to a GM who would rather see slightly
	 * stale material than nothing while a trigger catches up. */
	artifact: WarmArtifactRow | null;
}

/** Computes the current fingerprint from `candidate.sourceEntityIds`' latest revisions and
 * compares it against whatever is stored. A mismatch marks the stored row stale (lazy
 * invalidation's write half) and returns `fresh: false` - it never regenerates. */
export async function checkFreshness(
	db: Db,
	candidate: Pick<
		WarmCandidate,
		'universeId' | 'kind' | 'subjectEntityId' | 'sourceEntityIds' | 'promptVersion' | 'modelId'
	>
): Promise<FreshnessResult> {
	assertWarmable(candidate.kind);
	const revisionIds = await latestRevisionIds(db, candidate.sourceEntityIds);
	const fingerprint = computeFingerprint({
		sourceRevisionIds: candidate.sourceEntityIds.map((id) => revisionIds.get(id) ?? null),
		promptVersion: candidate.promptVersion,
		modelId: candidate.modelId
	});

	const existing = await latestArtifact(db, {
		universeId: candidate.universeId,
		kind: candidate.kind,
		subjectEntityId: candidate.subjectEntityId
	});
	if (!existing) return { fresh: false, fingerprint, artifact: null };
	if (existing.fingerprint === fingerprint) return { fresh: true, fingerprint, artifact: existing };

	await markStale(db, existing.id);
	return { fresh: false, fingerprint, artifact: { ...existing, stale: true } };
}

export type RegenerateStatus = 'fresh' | 'reused' | 'generated' | 'degraded';

export interface RegenerateResult {
	status: RegenerateStatus;
	/** The artifact now in the (kind, subject) slot: the existing fresh row, the row
	 * matching the recomputed fingerprint exactly, the newly generated row, or (for
	 * `degraded`) whatever stale/absent row was there before the budget refused this
	 * candidate. */
	artifact: WarmArtifactRow | null;
	proposal?: ProposalRow;
}

async function createDraftEntityProposal(
	db: Db,
	candidate: WarmCandidate,
	draft: DraftEntityPayload
): Promise<ProposalRow> {
	const [row] = await db
		.insert(proposal)
		.values({
			universeId: candidate.universeId,
			trigger: 'table',
			kind: 'draft_entity',
			patch: { name: draft.name, type: draft.type, body: draft.body, aliases: draft.aliases },
			rationale: candidate.rationale ?? '',
			locale: candidate.locale ?? DEFAULT_LOCALE,
			evidence: draft.evidence ?? {},
			provider: candidate.provider ?? null,
			modelId: candidate.modelId,
			credits: candidate.credits
		})
		.returning();
	if (!row) throw new Error('createDraftEntityProposal: insert returned no row');
	return row;
}

/**
 * Ensures a candidate's slot holds current material, subject to the warm budget.
 *
 * 1. Already fresh -> nothing to do.
 * 2. Stale/missing, but a row with the exact recomputed fingerprint already exists (an
 *    earlier regeneration landed the same content, or an edit reverted back to a fingerprint
 *    already warmed) -> reuse it, no spend.
 * 3. `budget.allow` gates whether `generator` runs at all, so an already-certain refusal
 *    never pays for a generation it would only discard.
 * 4. `generator` runs, then `budget.spend` attempts the authoritative charge. Only on
 *    success is the result persisted (`putArtifact`) and, for `npc_draft`, a pending
 *    `draft_entity` proposal created alongside it - never an `entity`. A spend that fails
 *    despite `allow` having passed (the balance moved in between) discards the generated
 *    material rather than store something nobody paid for.
 */
export async function regenerate(
	db: Db,
	candidate: WarmCandidate,
	generator: WarmGenerator,
	budget: WarmBudgetPort
): Promise<RegenerateResult> {
	assertWarmable(candidate.kind);
	const { fresh, fingerprint, artifact } = await checkFreshness(db, candidate);
	if (fresh) return { status: 'fresh', artifact };

	const exact = await findByFingerprint(db, {
		kind: candidate.kind,
		subjectEntityId: candidate.subjectEntityId,
		fingerprint
	});
	if (exact) return { status: 'reused', artifact: exact };

	const allowed = await budget.allow({
		universeId: candidate.universeId,
		kind: candidate.kind,
		credits: candidate.credits
	});
	if (!allowed) return { status: 'degraded', artifact };

	const generated = await generator(candidate);
	const spent = await budget.spend({
		universeId: candidate.universeId,
		kind: candidate.kind,
		subjectEntityId: candidate.subjectEntityId,
		credits: candidate.credits
	});
	// The authoritative check lives in `spend`, not `allow` (which is only an optimization
	// to skip calling `generator` at all when refusal is already certain). A `false` here
	// means the balance moved between `allow` and now - discard what was just generated
	// rather than store material nobody actually paid for.
	if (!spent) return { status: 'degraded', artifact };

	const saved = await putArtifact(db, {
		universeId: candidate.universeId,
		kind: candidate.kind,
		subjectEntityId: candidate.subjectEntityId,
		payload: generated.payload,
		fingerprint,
		credits: candidate.credits
	});

	if (candidate.kind !== 'npc_draft' || !generated.draftEntity) {
		return { status: 'generated', artifact: saved };
	}
	const proposalRow = await createDraftEntityProposal(db, candidate, generated.draftEntity);
	return { status: 'generated', artifact: saved, proposal: proposalRow };
}

/** A GM actually used a warm artifact at the table - SPEC §14's warm hit rate
 * (consumed over generated) is a query over this counter. */
export async function consumeArtifact(db: Db, artifactId: string): Promise<void> {
	await recordConsumption(db, artifactId);
}
