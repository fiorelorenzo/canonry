/**
 * The propagation eval harness (SPEC.md §14, issue #99). A corpus of small worlds, each
 * with entries, relations, one edit and the propagations a competent GM would expect from
 * it - including the ones that must NOT be proposed, since precision is what decides
 * whether the copilot is noise (SPEC.md §5.1: "the copilot becomes noise" without a cap,
 * and issue #99's whole point is measuring that before it ships).
 *
 * The runner never touches a model. It scores a `CandidateSelector` you hand it, so it can
 * be pointed at a trivial stub today and at the real candidate-set builder (issue #49, a
 * later wave) without this package changing at all.
 */

export type EntitySlug = string;

/** Matches @canonry/db's entity_type enum (SPEC.md §4.2). Duplicated here rather than
 * imported: this package has no runtime dependency on @canonry/db on purpose (the scorer
 * has to run with no model and no database), and the six values are part of the spec, not
 * an implementation detail likely to drift. */
export type PropagationEntityType =
	'character' | 'place' | 'faction' | 'item' | 'event' | 'session';

export interface PropagationEntity {
	slug: EntitySlug;
	type: PropagationEntityType;
	name: string;
	aliases?: string[];
	/** Markdown body, `[[wikilink]]` style mentions included, same shape as
	 * `packages/db/src/seed-fixture.ts`. */
	body: string;
}

export interface PropagationRelation {
	from: EntitySlug;
	/** `relation_type.label`, e.g. `'employs'`, `'located in'`. */
	label: string;
	to: EntitySlug;
}

/**
 * One edit, and the ground truth a competent GM would write down for it. `expected` is
 * ordered best-first: it is what the runner scores ordering against, because SPEC.md §5.1
 * caps a plan at about ten entries and order is what survives that cap.
 * `mustNotPropose` is not "everything else" - it is deliberately called out for entries
 * that a naive selector (embeddings alone, or the whole graph) would plausibly surface but
 * a competent GM would not, which is what makes it a precision test rather than a recall
 * test in disguise.
 */
export interface PropagationCase {
	id: string;
	/** What changed, for a human reading the report. */
	editSummary: string;
	editedEntitySlug: EntitySlug;
	/** The entity's body after the edit. Handed to the selector so it has something to
	 * diff against, exactly as the real pipeline would (SPEC.md §5.1 step 1). */
	editedBody: string;
	expected: EntitySlug[];
	mustNotPropose: EntitySlug[];
	/** Why a GM would expect (or refuse) each of the above. Read by the report, not scored. */
	rationale: string;
}

export interface PropagationWorld {
	id: string;
	name: string;
	entities: PropagationEntity[];
	relations: PropagationRelation[];
	cases: PropagationCase[];
}

export interface CandidateSelectorContext {
	world: PropagationWorld;
	propagationCase: PropagationCase;
}

/** The seam: issue #49 implements this signature for real (graph neighbours within 2 hops
 * plus mention/embedding retrieval, SPEC.md §5.1 step 2). Everything in this file is
 * written against the signature, never against that implementation. */
export type CandidateSelector = (
	ctx: CandidateSelectorContext
) => EntitySlug[] | Promise<EntitySlug[]>;

export interface PropagationCaseScore {
	worldId: string;
	caseId: string;
	/** What the selector actually returned, in the order it returned it. */
	selected: EntitySlug[];
	/** Fraction of `expected` present anywhere in `selected`. */
	recall: number;
	/** Fraction of `expected` present within the first `cap` entries of `selected` - the
	 * ones a GM would actually see, since the plan is capped (SPEC.md §5.1). */
	recallAtCap: number;
	/** Entries from `mustNotPropose` that the selector proposed, uncapped. */
	falsePositives: EntitySlug[];
	/** Same, but only counting the ones that survived the cap and would have reached the
	 * GM as noise. */
	falsePositivesAtCap: EntitySlug[];
	falsePositiveRate: number;
	/** Mean reciprocal rank of each `expected` entry within `selected` (0 when absent).
	 * Rewards both finding an entry and finding it early, which is the "order is what
	 * survives the cap" requirement made measurable. */
	orderingScore: number;
}

export interface PropagationReport {
	cap: number;
	cases: PropagationCaseScore[];
	meanRecall: number;
	meanRecallAtCap: number;
	meanFalsePositiveRate: number;
	meanOrderingScore: number;
	totalFalsePositives: number;
}

export interface PropagationEvalOptions {
	/** SPEC.md §5.1: "Cap: ~10 entries per plan". */
	cap?: number;
}
