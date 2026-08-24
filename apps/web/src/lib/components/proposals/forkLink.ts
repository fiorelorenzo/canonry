/**
 * Issue #648: the query string the review card's shipped-refusal notice links with.
 *
 * A plain module rather than a function inside `ProposalDiffCard.svelte`, for the same
 * reason `browseQuery` in `components/entries/browse-params.ts` is one: building a query
 * string means setting keys on a `URLSearchParams`, and inside a Svelte component that is
 * `svelte/prefer-svelte-reactivity`'s error, because a built-in mutable instance in a
 * component is a reactivity trap waiting for someone to keep it in state. Nothing here is
 * state - the string is built when the notice renders and read once as an href - so the
 * honest fix is to build it where the rule does not apply and where it can be tested,
 * exactly like the browse query already is.
 *
 * Returns the leading `?`, or an empty string when there is nothing to carry, matching
 * `browseQuery`'s own contract so the two read the same at their call sites.
 */
export interface ShippedForkTarget {
	relationTypeId: string;
	/** The end types the refused accept named, either of which may be absent when only the
	 * other end of the pair was short. */
	addFrom: string | null;
	addTo: string | null;
}

export function shippedForkQuery(target: ShippedForkTarget): string {
	const params = new URLSearchParams({ fork: target.relationTypeId });
	if (target.addFrom) params.append('addFrom', target.addFrom);
	if (target.addTo) params.append('addTo', target.addTo);
	return `?${params.toString()}`;
}
