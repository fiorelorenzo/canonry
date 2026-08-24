/**
 * The matching benchmark (issue #37, SPEC.md §6.4, §16): "the thresholds are not
 * guessable and must not be guessed. They come out of a benchmark: a labelled corpus of
 * real export pairs where the right answer is known, scored for false merges (the
 * expensive error: two characters collapsed into one) and false splits (the cheap one: a
 * duplicate the GM merges by hand). False merges are weighted far heavier, and the
 * harness runs on every change to the matcher or the embedding model."
 *
 * Mirrors packages/eval's retrieval and propagation runners exactly: never touches a
 * model or a database, scores an injected `SimilarityFn` (matching.ts) against a labelled
 * corpus. `runMatchingBenchmark` computes each pair's similarity once, then sweeps a
 * threshold range and reports false-merge/false-split counts per threshold, plus the
 * threshold the corpus itself suggests - a *measurement* the corpus produces, never a
 * value chosen ahead of time and then justified.
 *
 * `runPoolOrderingBenchmark` (issue #641) scores the other half of the same decision: not
 * how well the scorer separates a pair it is handed, but whether the pool the scorer is
 * handed contains the right candidate at all. #627 made `candidateEntitiesForMatching`
 * order by slug and said plainly that the ordering is arbitrary with respect to matching,
 * so on a universe with more candidates of one type than the caps allow, which ones reach
 * the scorer is decided by the SQL `ORDER BY` and by `preFilterCandidates`'s tie-break on
 * input order. That is a matching outcome, and it is measurable here: hand the same corpus
 * the same universe under two orderings and count the false merges and false splits each
 * one causes. It takes the pool as an injected function for the same reason the threshold
 * sweep takes the similarity as one, so an in-memory ordering and a real SQL one are
 * scored by identical code.
 */
import {
	normalizeForMatching,
	preFilterCandidates,
	resolveMatch,
	type MatchCandidate,
	type MatchSubject,
	type MatchThresholds,
	type SimilarityFn
} from './matching.js';

export interface MatchingPairExample {
	id: string;
	subject: MatchSubject;
	candidate: MatchCandidate;
	/** Ground truth: are the subject and candidate really the same entity? */
	sameEntity: boolean;
	/** Why this pair is in the corpus - the naming-variance pattern or the trap it
	 * exercises, kept next to the data so the corpus reads as a labelled set of cases
	 * rather than an opaque table. */
	note: string;
}

export interface MatchingCorpus {
	id: string;
	name: string;
	pairs: MatchingPairExample[];
}

export interface ThresholdScore {
	threshold: number;
	/** Pairs that are NOT the same entity but scored at or above `threshold` - the
	 * expensive error (SPEC.md §6.4: "two characters collapsed into one"). */
	falseMerges: number;
	/** Pairs that ARE the same entity but scored below `threshold` - the cheap error (a
	 * duplicate the GM merges by hand). */
	falseSplits: number;
	/** falseMerges * falseMergeWeight + falseSplits (SPEC.md §6.4: "false merges are
	 * weighted far heavier"). */
	weightedCost: number;
}

export interface MatchingBenchmarkReport {
	corpusId: string;
	pairCount: number;
	falseMergeWeight: number;
	/** One entry per swept threshold. */
	scores: ThresholdScore[];
	/** The `scores` entry with the lowest weighted cost - what this corpus, scored by
	 * this similarity function, suggests as the boundary. A measurement to report, not a
	 * decision to hard-code: re-run against the real embedding model before trusting it
	 * (SPEC.md §11.4 makes the same demand of the retrieval threshold). */
	suggestedThreshold: ThresholdScore;
}

const DEFAULT_THRESHOLD_SWEEP = Array.from({ length: 19 }, (_, i) => (i + 1) / 20); // 0.05 .. 0.95
/** SPEC.md §6.4 states the direction ("far heavier") without a number - 5 is a documented
 * starting weight, not a claim that 5 is correct; the report always states which weight
 * produced its numbers so this is auditable rather than hidden inside a mean. */
const DEFAULT_FALSE_MERGE_WEIGHT = 5;

export interface RunMatchingBenchmarkOptions {
	thresholds?: number[];
	falseMergeWeight?: number;
}

export async function runMatchingBenchmark(
	corpus: MatchingCorpus,
	similarity: SimilarityFn,
	options: RunMatchingBenchmarkOptions = {}
): Promise<MatchingBenchmarkReport> {
	const thresholds = options.thresholds ?? DEFAULT_THRESHOLD_SWEEP;
	const falseMergeWeight = options.falseMergeWeight ?? DEFAULT_FALSE_MERGE_WEIGHT;

	const scoredPairs = await Promise.all(
		corpus.pairs.map(async (pair) => ({
			pair,
			similarity: await similarity(pair.subject, pair.candidate)
		}))
	);

	const scores: ThresholdScore[] = thresholds.map((threshold) => {
		let falseMerges = 0;
		let falseSplits = 0;
		for (const scored of scoredPairs) {
			const predictedSame = scored.similarity >= threshold;
			if (predictedSame && !scored.pair.sameEntity) falseMerges += 1;
			if (!predictedSame && scored.pair.sameEntity) falseSplits += 1;
		}
		return {
			threshold,
			falseMerges,
			falseSplits,
			weightedCost: falseMerges * falseMergeWeight + falseSplits
		};
	});

	let suggestedThreshold = scores[0];
	for (const score of scores) {
		if (!suggestedThreshold || score.weightedCost < suggestedThreshold.weightedCost) {
			suggestedThreshold = score;
		}
	}
	if (!suggestedThreshold) {
		throw new Error(
			'runMatchingBenchmark: threshold sweep produced no scores - options.thresholds was empty'
		);
	}

	return {
		corpusId: corpus.id,
		pairCount: corpus.pairs.length,
		falseMergeWeight,
		scores,
		suggestedThreshold
	};
}

// ---------------------------------------------------------------------------
// Issue #641: scoring the pool rather than the scorer.
// ---------------------------------------------------------------------------

/**
 * One import sighting, as the pool sees it: a subject, and every corpus candidate the
 * labels say is or is not the same entity as it.
 *
 * A pair is not the unit here, because a pair cannot express the error this measures. A
 * false merge caused by truncation needs the right candidate to be *absent* and a wrong one
 * to be *present*, which is a statement about a whole universe and not about two rows. So
 * the corpus is regrouped by subject: `sameEntityIds` is what a correct decision may name,
 * `otherEntityIds` is what naming instead is a false merge, and a subject with an empty
 * `sameEntityIds` is genuinely new and any named candidate is a false merge.
 */
export interface PoolSubject {
	/** Stable id for the report: the subject's own key, not a pair's. */
	id: string;
	subject: MatchSubject;
	sameEntityIds: string[];
	otherEntityIds: string[];
}

/** Regroups a corpus by subject. Two pairs whose subjects normalise to the same name and
 * type are one sighting, which is what the corpus already means by reusing a subject across
 * a true pair and its false-merge trap: "Aldric Voss" is one document's sighting scored
 * against Aldric, against Aldric the Younger, and against Seraphine. */
export function poolSubjectsFromCorpus(corpus: MatchingCorpus): PoolSubject[] {
	const bySubject = new Map<string, PoolSubject>();
	for (const pair of corpus.pairs) {
		const key = `${pair.subject.context?.type ?? 'untyped'}:${normalizeForMatching(pair.subject.name)}`;
		let entry = bySubject.get(key);
		if (!entry) {
			entry = { id: key, subject: pair.subject, sameEntityIds: [], otherEntityIds: [] };
			bySubject.set(key, entry);
		}
		const bucket = pair.sameEntity ? entry.sameEntityIds : entry.otherEntityIds;
		if (!bucket.includes(pair.candidate.id)) bucket.push(pair.candidate.id);
	}
	return [...bySubject.values()];
}

/** The pool one ordering hands one subject, already capped: exactly what
 * `candidateEntitiesForMatching` returns, so a SQL-backed implementation and an in-memory
 * one are the same shape. */
export interface OrderedPool {
	candidates: MatchCandidate[];
	truncated: boolean;
}

export type PoolFetch = (subject: MatchSubject) => Promise<OrderedPool> | OrderedPool;

export interface PoolSubjectOutcome {
	subjectId: string;
	/** How many rows the cap let through. */
	poolSize: number;
	truncated: boolean;
	/** Did the capped pool contain a candidate the labels call the same entity? This is the
	 * question the ordering decides. `null` when the subject has no true candidate at all. */
	trueCandidateInPool: boolean | null;
	/** And did it survive `preFilterCandidates` as well? A pool that holds the right row and
	 * a pre-filter that drops it is the same outcome, one layer down, and the pool ordering
	 * decides it too: the pre-filter's tie-break is the input order, so among candidates
	 * with equal name overlap the SQL `ORDER BY` picks which 20 get scored. */
	trueCandidateScored: boolean | null;
	outcome: 'matched' | 'false_merge' | 'false_split' | 'correctly_new' | 'asked';
	/** For an `ask`: whether the band offered the GM a true candidate. An ask that does not
	 * is a false split the GM cannot fix from the question they were shown. */
	askOfferedTruth: boolean | null;
	decidedCandidateId: string | null;
	similarity: number | null;
}

export interface PoolOrderingScore {
	orderingId: string;
	subjectCount: number;
	/** Subjects with a true candidate whose capped pool did not contain it. */
	trueCandidateMissing: number;
	/** Subjects with a true candidate that never reached the similarity call, whether the
	 * cap or the pre-filter dropped it. */
	trueCandidateUnscored: number;
	falseMerges: number;
	falseSplits: number;
	/** `falseMerges * falseMergeWeight + falseSplits`, the same weighting the threshold
	 * sweep uses (SPEC.md §6.4: "false merges are weighted far heavier"). */
	weightedCost: number;
	matched: number;
	correctlyNew: number;
	asked: number;
	outcomes: PoolSubjectOutcome[];
}

export interface PoolOrderingReport {
	corpusId: string;
	falseMergeWeight: number;
	preFilterLimit: number;
	scores: PoolOrderingScore[];
}

export interface RunPoolOrderingBenchmarkOptions {
	thresholds: MatchThresholds;
	/** Mirrors `resolveMatch`'s own default, and is a parameter because the pre-filter is
	 * half of what this measures. */
	preFilterLimit?: number;
	falseMergeWeight?: number;
}

/**
 * Scores one or more pool orderings over the same subjects: for each subject, take the pool
 * that ordering hands it, run SPEC.md §6.4's real decision over it (`resolveMatch`, so the
 * pre-filter and the threshold band are the product's and not a copy), and count the errors
 * the ordering caused.
 *
 * The identity guard is deliberately not modelled: #627 made it a complete lookup rather
 * than a page of a capped pool, so no ordering can move it, and including it would credit
 * every ordering with the same free wins and hide the difference this measures.
 */
export async function runPoolOrderingBenchmark(
	corpusId: string,
	subjects: PoolSubject[],
	orderings: Array<{ id: string; fetchPool: PoolFetch }>,
	similarity: SimilarityFn,
	options: RunPoolOrderingBenchmarkOptions
): Promise<PoolOrderingReport> {
	const falseMergeWeight = options.falseMergeWeight ?? DEFAULT_FALSE_MERGE_WEIGHT;
	const preFilterLimit = options.preFilterLimit ?? 20;
	const scores: PoolOrderingScore[] = [];

	for (const ordering of orderings) {
		const outcomes: PoolSubjectOutcome[] = [];
		for (const entry of subjects) {
			const pool = await ordering.fetchPool(entry.subject);
			const hasTruth = entry.sameEntityIds.length > 0;
			const inPool = pool.candidates.some((c) => entry.sameEntityIds.includes(c.id));
			const scoredSet = preFilterCandidates(entry.subject, pool.candidates, preFilterLimit);
			const inScored = scoredSet.some((c) => entry.sameEntityIds.includes(c.id));

			const decision = await resolveMatch({
				subject: entry.subject,
				exactSourceRefMatch: null,
				candidates: pool.candidates,
				similarity,
				thresholds: options.thresholds,
				preFilterLimit
			});

			let outcome: PoolSubjectOutcome['outcome'];
			let decidedCandidateId: string | null = null;
			let similarityValue: number | null = null;
			let askOfferedTruth: boolean | null = null;
			if (decision.outcome === 'match') {
				decidedCandidateId = decision.candidateId;
				similarityValue = decision.similarity;
				outcome = entry.sameEntityIds.includes(decision.candidateId) ? 'matched' : 'false_merge';
			} else if (decision.outcome === 'ask') {
				similarityValue = decision.similarity;
				askOfferedTruth = decision.candidateIds.some((id) => entry.sameEntityIds.includes(id));
				outcome = 'asked';
			} else {
				outcome = hasTruth ? 'false_split' : 'correctly_new';
			}

			outcomes.push({
				subjectId: entry.id,
				poolSize: pool.candidates.length,
				truncated: pool.truncated,
				trueCandidateInPool: hasTruth ? inPool : null,
				trueCandidateScored: hasTruth ? inScored : null,
				outcome,
				askOfferedTruth,
				decidedCandidateId,
				similarity: similarityValue
			});
		}

		const falseMerges = outcomes.filter((o) => o.outcome === 'false_merge').length;
		const falseSplits = outcomes.filter((o) => o.outcome === 'false_split').length;
		scores.push({
			orderingId: ordering.id,
			subjectCount: outcomes.length,
			trueCandidateMissing: outcomes.filter((o) => o.trueCandidateInPool === false).length,
			trueCandidateUnscored: outcomes.filter((o) => o.trueCandidateScored === false).length,
			falseMerges,
			falseSplits,
			weightedCost: falseMerges * falseMergeWeight + falseSplits,
			matched: outcomes.filter((o) => o.outcome === 'matched').length,
			correctlyNew: outcomes.filter((o) => o.outcome === 'correctly_new').length,
			asked: outcomes.filter((o) => o.outcome === 'asked').length,
			outcomes
		});
	}

	return { corpusId, falseMergeWeight, preFilterLimit, scores };
}
