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
 */
import type { MatchCandidate, MatchSubject, SimilarityFn } from './matching.js';

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
