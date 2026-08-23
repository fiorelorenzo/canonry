/**
 * D4 = B (docs/ux/DECISIONS.md): "one queue in C6's vocabulary, with type filters". The
 * bucket shape `TypeFilterChips.svelte` renders and `import/[job]/review`'s bulk-reject
 * action reads back - kept as a pure function so the "which chips does this job get" and
 * "how many would a bulk reject touch" logic is one thing to test, not embedded in either
 * the server load or the component.
 *
 * `filterType` is never re-derived here from a candidate's own fields: `$lib/server/proposals.ts`'s
 * `resolveCandidates` already computes it correctly per proposal kind (a `create`'s target
 * type comes from its patch, since it has no target entity yet), and that is the only
 * place worth trusting it.
 */
import { messages, type Locale } from '$lib/i18n';

export interface FilterCandidate {
	id: string;
	/** An entity type (`character`, `place`, ...) or `'relation'` - `ProposalCandidate.filterType`. */
	filterType: string;
	outcome: string;
}

export interface FilterBucket {
	/** `null` is the "All" chip - every candidate, regardless of type. */
	type: string | null;
	label: string;
	/** Total candidates in this bucket, any outcome - the mock's "Characters 38". */
	total: number;
	/** Still-pending candidates in this bucket - what a "Reject N shown" bulk action,
	 * only ever offered for a non-"All" bucket, would actually touch. */
	pending: number;
}

/** SPEC.md §4.2's own order ("character, place, faction, item, event, session"), relations
 * last - matches the D4 mock's own chip order (docs/ux/DECISIONS.md; the drawn mock is in git history at c84c8f8). */
const BUCKET_ORDER = ['character', 'place', 'faction', 'item', 'event', 'session', 'relation'];

/** "All" first, then one chip per type actually present in this job - a type nobody
 * proposed gets no chip, exactly like the mock's own five (never six) chips for a vault
 * that produced no items or sessions. A `filterType` outside the known six-plus-relation
 * set (should never happen - `resolveCandidates` only ever writes those seven - but
 * `filterType` is a plain string here, not the enum, so this stays defensive) still gets
 * a chip, appended after the known ones, labelled with the raw string rather than
 * silently dropping a proposal nobody could otherwise reach. `locale` picks which
 * language `proposals.filterBuckets` labels every chip in (issue #121). */
export function computeFilterBuckets(
	candidates: FilterCandidate[],
	locale: Locale
): FilterBucket[] {
	const bucketLabels: Record<string, string> = messages(locale).proposals.filterBuckets;
	const buckets: FilterBucket[] = [
		{
			type: null,
			label: bucketLabels.all,
			total: candidates.length,
			pending: candidates.filter((c) => c.outcome === 'pending').length
		}
	];
	const present = new Set(candidates.map((c) => c.filterType));
	const unknown = [...present].filter((type) => !BUCKET_ORDER.includes(type)).sort();
	for (const type of [...BUCKET_ORDER, ...unknown]) {
		const matching = candidates.filter((c) => c.filterType === type);
		if (matching.length === 0) continue;
		buckets.push({
			type,
			label: bucketLabels[type] ?? type,
			total: matching.length,
			pending: matching.filter((c) => c.outcome === 'pending').length
		});
	}
	return buckets;
}
