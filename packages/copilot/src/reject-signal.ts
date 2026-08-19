/**
 * Reject reasons feed candidate ranking (issue #56, SPEC.md §5.1: "rejection asks for a
 * one-word reason, which is training signal for the ranking, not a survey").
 *
 * `docs/ux/c7-reject-reasons.html`'s decision fixes the vocabulary and, in "What this
 * locks in", what each reason is for: "wrong" and "already true" are strong negative
 * weights on the candidate-finding step; "too much" tunes the ~10-entry cap's relevance
 * cutoff; "not canon yet" behaves like a snooze rather than a penalty; "prose" is never a
 * ranking signal at all, it routes to the diff-writing step instead. This module builds
 * exactly that: a deterministic score, no learning system, no aggregate model of "what
 * GMs reject" - the artifact explicitly rules that survey out.
 */
import type { CandidateEntry } from './candidates.js';

/** The fixed five plus the open escape hatch, exactly as the decision names them. */
export type ReasonChip =
	'wrong' | 'already_true' | 'not_canon_yet' | 'too_much' | 'prose' | 'other';

const CANONICAL_REASONS: Record<string, ReasonChip> = {
	wrong: 'wrong',
	'already true': 'already_true',
	already_true: 'already_true',
	'not canon yet': 'not_canon_yet',
	not_canon_yet: 'not_canon_yet',
	'too much': 'too_much',
	too_much: 'too_much',
	prose: 'prose'
};

/** Maps a raw `proposal.reject_reason` value onto the fixed vocabulary. Free text that
 * does not match one of the five chips falls into 'other', same as picking "Other..." in
 * the UI - the ranker ignores it rather than guessing at meaning nobody labelled. */
export function normalizeReason(raw: string | null | undefined): ReasonChip {
	if (!raw) return 'other';
	return CANONICAL_REASONS[raw.trim().toLowerCase()] ?? 'other';
}

/** Per-occurrence weight applied to a resembling candidate. Zero means "no ranking
 * signal", not "unknown" - 'prose' is deliberately zero here because the decision routes
 * it to diff-writing, not candidate-finding; 'not_canon_yet' is zero because a snooze
 * needs a time axis this stateless scorer does not have, and the decision is explicit
 * that it must never be scored as a penalty. */
const REASON_WEIGHT: Record<ReasonChip, number> = {
	wrong: -1,
	already_true: -1,
	too_much: -0.4,
	not_canon_yet: 0,
	prose: 0,
	other: 0
};

export interface RejectionRecord {
	targetEntityId: string;
	/** `relation_type.key` values this past candidate's evidence carried (see
	 * `RelationEvidence.path` in candidates.ts) - identity, not the display label
	 * (decision L1, #195). Empty for a mention/embedding-only candidate. */
	relationKeys: string[];
	reason: string | null;
}

/** 1 for the exact same entity rejected before, 0.5 for a candidate that only resembles it
 * (arrived via a shared relation key), 0 for no resemblance at all. "Resembling", not
 * "identical to", is the word issue #56 uses. */
function resemblance(candidate: CandidateEntry, record: RejectionRecord): number {
	if (candidate.entityId === record.targetEntityId) return 1;
	if (record.relationKeys.length === 0) return 0;
	const candidateKeys = candidate.evidence.flatMap((evidence) =>
		evidence.kind === 'relation' ? evidence.path : []
	);
	return record.relationKeys.some((key) => candidateKeys.includes(key)) ? 0.5 : 0;
}

/** The reason-weighted score for one candidate against the universe's reject history.
 * Always <= 0: a candidate with no resemblance to any weighted rejection scores exactly 0
 * and is unaffected. */
export function rejectPenaltyFor(candidate: CandidateEntry, history: RejectionRecord[]): number {
	let penalty = 0;
	for (const record of history) {
		const weight = REASON_WEIGHT[normalizeReason(record.reason)];
		if (weight === 0) continue;
		penalty += weight * resemblance(candidate, record);
	}
	return penalty;
}

export interface ScoredCandidate extends CandidateEntry {
	rejectPenalty: number;
	/** `score + rejectPenalty` - what the plan is actually ordered and capped by. */
	finalScore: number;
}

/** Orders a candidate pool by relevance adjusted for reject history, highest first. Pure
 * and deterministic - the cheap model issue #52 calls (ranking.ts) writes the plan's
 * human-readable rationale over this order, it does not recompute it. */
export function scoreCandidates(
	pool: CandidateEntry[],
	history: RejectionRecord[]
): ScoredCandidate[] {
	return pool
		.map((candidate) => {
			const rejectPenalty = rejectPenaltyFor(candidate, history);
			return { ...candidate, rejectPenalty, finalScore: candidate.score + rejectPenalty };
		})
		.sort((a, b) => b.finalScore - a.finalScore);
}

/** docs/ux/c7-reject-reasons.html: "too much" tunes the cap's cutoff rather than
 * penalising a specific candidate. Each recent "too much" tightens the cap by one entry,
 * down to a floor of 3 - a plan can get smaller as the GM says the copilot is too noisy,
 * but it never disappears, since a plan of zero candidates is silence, not a signal.
 *
 * `baseCap: null` is decision C3's amendment: the GM turned the limit off entirely, and
 * there is nothing to tighten - a cap that does not exist cannot get one smaller. This
 * returns null straight through rather than substituting a number, and the floor of 3
 * never applies in that case: a GM who explicitly asked for every candidate does not
 * silently get three because they also rejected a few as "too much" in the past. The
 * floor is a floor on *tightening a real cap*, not a minimum plan size the product
 * imposes regardless of what the GM asked for. */
export function effectiveCap(
	baseCap: number | null,
	recentReasons: Array<string | null>
): number | null {
	if (baseCap === null) return null;
	const tooMuchCount = recentReasons.filter(
		(reason) => normalizeReason(reason) === 'too_much'
	).length;
	return Math.max(3, baseCap - tooMuchCount);
}
