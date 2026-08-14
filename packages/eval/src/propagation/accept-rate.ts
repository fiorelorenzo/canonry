/**
 * The accept-rate metric shape (SPEC.md §14 #1 and #6, AGENTS.md "two metrics decide
 * whether this product works"). `proposal.outcome` (`packages/db/src/schema/proposal.ts`,
 * issue #47's schema) is the real instrumentation once a caller reads it; this module
 * operates on the minimal shape independent of `@canonry/db` on purpose, so the harness
 * keeps no dependency on the implementation it will eventually measure. A caller maps
 * `proposal` rows (`outcome`, `reject_reason`) into `ProposalOutcomeRecord[]`.
 *
 * `ProposalOutcome` mirrors `proposal_outcome` exactly, `superseded` included: a proposal
 * whose target changed underneath it before anyone decided is neither accepted nor
 * rejected, and counting it as a rejection would poison the accept rate (see the comment
 * on `proposalOutcomeEnum` in `packages/db/src/schema/enums.ts`).
 */

export type ProposalOutcome = 'pending' | 'accepted' | 'rejected' | 'superseded';

export interface ProposalOutcomeRecord {
	outcome: ProposalOutcome;
	/** e.g. a playbook name, a propagation trigger, an import id - whatever axis the
	 * caller wants the rate broken out by. */
	group?: string;
}

export interface AcceptRateResult {
	accepted: number;
	rejected: number;
	pending: number;
	superseded: number;
	/** accepted + rejected + pending + superseded. */
	produced: number;
	/** accepted + rejected - the denominator for `acceptRate`. Pending has not been
	 * judged yet and superseded was never judged at all; both would silently drag the
	 * rate toward zero if counted as decided. */
	decided: number;
	/** `null` when nothing has been decided yet, rather than a misleading 0. */
	acceptRate: number | null;
}

function summarize(records: ProposalOutcomeRecord[]): AcceptRateResult {
	const accepted = records.filter((r) => r.outcome === 'accepted').length;
	const rejected = records.filter((r) => r.outcome === 'rejected').length;
	const pending = records.filter((r) => r.outcome === 'pending').length;
	const superseded = records.filter((r) => r.outcome === 'superseded').length;
	const decided = accepted + rejected;
	return {
		accepted,
		rejected,
		pending,
		superseded,
		produced: accepted + rejected + pending + superseded,
		decided,
		acceptRate: decided === 0 ? null : accepted / decided
	};
}

/** Accept rate across every record handed in - SPEC.md §14 #1, "accept rate of
 * propagation proposals". */
export function acceptRate(records: ProposalOutcomeRecord[]): AcceptRateResult {
	return summarize(records);
}

/** Accept rate broken out by `group` - SPEC.md §14 #6, "watch it per playbook, not in
 * aggregate". Records with no `group` are collected under `'ungrouped'`. */
export function acceptRateByGroup(records: ProposalOutcomeRecord[]): Map<string, AcceptRateResult> {
	const byGroup = new Map<string, ProposalOutcomeRecord[]>();
	for (const record of records) {
		const key = record.group ?? 'ungrouped';
		const bucket = byGroup.get(key);
		if (bucket) bucket.push(record);
		else byGroup.set(key, [record]);
	}

	const result = new Map<string, AcceptRateResult>();
	for (const [key, bucket] of byGroup) {
		result.set(key, summarize(bucket));
	}
	return result;
}
