/**
 * SPEC.md §4.5: `warm_artifact.fingerprint` is "the fingerprint of its sources (entity
 * revision ids + prompt version + model id)". Pure, deterministic, and DB-free on purpose
 * - the caller resolves the current revision ids (packages/db/src/queries/warm.ts's
 * `latestRevisionIds`), this module only hashes them, which is what makes it independently
 * testable without a database.
 */
import { createHash } from 'node:crypto';

export interface FingerprintInput {
	/** One entry per source entity, in any order - `null` for an entity with no revision
	 * yet. Order does not affect the result: the set of sources is what matters, not the
	 * sequence a caller happened to list them in. */
	sourceRevisionIds: Array<string | null>;
	promptVersion: string;
	modelId: string;
}

/** SHA-256 over the sorted source revision ids plus prompt version and model id. Sorting
 * first means two callers who assembled the same source set in a different order still
 * land on the same fingerprint, and a missing revision (`null`) hashes to a fixed token
 * rather than being dropped, so "this entity has no revision yet" is itself part of the
 * fingerprint rather than invisible. */
export function computeFingerprint(input: FingerprintInput): string {
	const sortedRevisions = input.sourceRevisionIds.map((id) => id ?? '\u0000none').sort();
	const material = [...sortedRevisions, input.promptVersion, input.modelId].join('\u0001');
	return createHash('sha256').update(material).digest('hex');
}
