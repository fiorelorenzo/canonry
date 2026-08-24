/**
 * The relation-label benchmark (issue #637): what `matching-benchmark.ts` is for entity
 * matching, one domain over, for `resolveRelationType`'s semantic rung.
 *
 * `SPEC.md` §6.4's rule for entity matching is that "the thresholds are not guessable and
 * must not be guessed. They come out of a benchmark: a labelled corpus of real export pairs
 * where the right answer is known, scored for false merges (the expensive error) and false
 * splits (the cheap one). False merges are weighted far heavier". The entity side honours
 * that with `matching-benchmark.ts` and a hand-labelled corpus. The relation side had
 * nothing, which is what #629 had to say about its own measurement: every right-or-wrong
 * judgement in it was one person's by hand, so a false merge could not be measured and
 * `SEMANTIC_REUSE_THRESHOLD` could not honestly move. This file is the missing half.
 *
 * ## Three outcomes, not two, and that is the difference from the entity benchmark
 *
 * An entity pair is the same entity or it is not. A relation label has a third answer, and
 * #628 is why: a proposed label can name an existing type's *inverse*, in which case the
 * right move is to reuse that type with the relation's ends swapped rather than to create a
 * second one. "ha come membro" against `member_of` is neither a merge nor a split; it is a
 * match with the ends reversed, and a benchmark that cannot express it measures the wrong
 * thing. So ground truth here is `same` | `inverse` | `distinct`, and the report carries a
 * third error class: a **direction error**, where the rung merges onto the right type in the
 * wrong direction. That is a real defect (the row is written backwards) and it is not a
 * false merge (the identity is right), so it is counted and weighted on its own.
 *
 * ## What is measured is the production rung, not a re-derivation of it
 *
 * `bestSemanticMatch` scores a proposed label against the *whole* locale-expanded label set
 * of each candidate type (`relationTypeMatchCandidates`, #197) and keeps the best. So does
 * this: `scoreRelationLabelPair` expands the pair's catalogue key through that same
 * function, scores the proposed label against every expanded label, and keeps the maximum
 * plus which label won. The winning label's direction is what the resolution's `reversed`
 * would be. Two consequences worth stating rather than discovering:
 *
 * - Every pair is a cross-language pair whether or not it looks like one, because the
 *   expanded set contains both shipped locales at once. An Italian label scored against
 *   `owns` is scored against `owns`, `owned by`, `possiede` and `posseduto da` together.
 *   That is what production does, and it is why #629's Italian corpus was never measuring
 *   only Italian.
 * - A symmetric type scores its forward label first and wins ties forward, because rung 1a
 *   runs its whole loop before rung 1b does. `ally_of`'s inverse label *is* `ally of`, so a
 *   direction is meaningless for it and the corpus never labels a pair against it `inverse`.
 *
 * Model-free and database-free like its sibling: an injected `RelationLabelSimilarityFn`
 * over two label strings, so CI runs it on a deterministic stand-in and
 * `packages/bench`'s `relation-label-sweep` runs the same corpus against the real gateway
 * embedding model. `runRelationLabelBenchmark` scores each pair once, sweeps a threshold
 * range, and reports what the corpus implies. It reports; it does not set anything.
 */
import {
	normalizeRelationLabel,
	RELATION_TYPE_CATALOGUE,
	relationTypeMatchCandidates,
	type RelationTypeIdentity
} from '@canonry/lang';

/**
 * Ground truth for one pair. `same` and `inverse` both mean "this is that type", and they
 * differ only in which end of the relation the proposed label puts first; `distinct` means
 * reusing that type's `key` for this label would give one identity two relations, which is
 * the error decision L1 makes permanent.
 */
export type RelationLabelVerdict = 'same' | 'inverse' | 'distinct';

export interface RelationLabelPairExample {
	id: string;
	/** The label an import proposed, as the model wrote it. */
	proposedLabel: string;
	/** `relation_type.key` of the shipped catalogue type it is scored against. */
	catalogueKey: string;
	verdict: RelationLabelVerdict;
	/**
	 * Whether rung 1's normalised exact match already resolves this pair, so a report can
	 * subtract what an exact match already had from what the semantic rung actually buys.
	 * #629's headline was that all three labels crossing 0.86 were exact catalogue labels
	 * rung 1 had already matched, which is a rung-2 contribution of nothing dressed as
	 * three merges. Declared here as data and verified against the production predicate by
	 * this corpus's own test, so it cannot drift away from what rung 1 really does.
	 */
	rungOne: boolean;
	/** Which rule or trap this pair exercises, kept next to the data so the corpus reads as
	 * a labelled set of judgement calls rather than an opaque table. */
	note: string;
}

export interface RelationLabelCorpus {
	id: string;
	name: string;
	pairs: RelationLabelPairExample[];
}

/** The seam, mirroring `matching.ts`'s `SimilarityFn`: two label strings in, a similarity
 * out. A deterministic stand-in in CI, a cosine over the real gateway embedder in
 * `packages/bench`. Kept over two strings rather than over an `Embedder` so a caller is
 * free to batch every text in the corpus into one embedding call, which is what the sweep
 * does. */
export type RelationLabelSimilarityFn = (
	proposedLabel: string,
	catalogueLabel: string
) => number | Promise<number>;

export interface RelationLabelPairScore {
	pair: RelationLabelPairExample;
	/** The best similarity across the type's whole locale-expanded label set, which is what
	 * `bestSemanticMatch` scores a candidate at. */
	similarity: number;
	/** The direction of the label that won, so the resolution's `reversed` is predictable
	 * from a score rather than assumed. */
	direction: 'forward' | 'inverse';
	/** Which of the type's labels won, so a reviewer reads why a score is what it is. */
	matchedLabel: string;
}

/** What the rung does to one pair at one threshold. `correct-split` is the silent majority
 * and carries no cost; the other four are the report. */
export type RelationLabelOutcome =
	'correct-merge' | 'correct-split' | 'false-merge' | 'false-split' | 'direction-error';

export interface RelationLabelThresholdScore {
	threshold: number;
	/** `distinct` pairs that scored at or above the threshold: two unrelated relations
	 * under one `key`, which decision L1 makes permanent and nothing flags afterwards. */
	falseMerges: number;
	/** `same`/`inverse` pairs that scored below it: one extra vocabulary question for the
	 * GM, which #192's `mergeRelationTypes` fixes after the fact. */
	falseSplits: number;
	/** Pairs that merged onto the right type on the wrong end: the row is written
	 * backwards. #628's three `member of` refusals were this. */
	directionErrors: number;
	falseMergeIds: string[];
	falseSplitIds: string[];
	directionErrorIds: string[];
	/** `falseMerges * falseMergeWeight + directionErrors * directionErrorWeight +
	 * falseSplits`. */
	weightedCost: number;
}

export interface RelationLabelSweep {
	pairCount: number;
	scores: RelationLabelThresholdScore[];
	/**
	 * The cheapest row this corpus implies, and a measurement rather than a decision. Ties
	 * are broken towards the *higher* threshold, which is where this runner deliberately
	 * differs from `runMatchingBenchmark`: two thresholds of equal weighted cost do not
	 * have equal composition, the higher one trades false merges for false splits, and
	 * `SEMANTIC_REUSE_THRESHOLD`'s own comment says under-merging is the safe direction to
	 * be wrong in on this rung.
	 */
	suggestedThreshold: RelationLabelThresholdScore;
}

export interface RelationLabelBenchmarkReport {
	corpusId: string;
	pairCount: number;
	falseMergeWeight: number;
	directionErrorWeight: number;
	/** The whole corpus, rung-1 pairs included. */
	whole: RelationLabelSweep;
	/** The same sweep over only the pairs rung 1 does not already resolve, which is the
	 * only subset the semantic rung is answerable for. */
	rungTwoOnly: RelationLabelSweep;
	pairScores: RelationLabelPairScore[];
}

/**
 * 0.50 to 0.98 in steps of 0.02, rather than the entity benchmark's 0.05-to-0.95 in
 * twentieths. Two reasons, both from measurements already in the repo: short-label cosines
 * sit high and compressed (the scale warning `packages/import/src/matching.ts`'s own sweep
 * carries for bare names applies more strongly to one-to-three-word labels), and #629
 * measured the entire interesting band between 0.70 and 0.86 on the real model. A sweep
 * that steps by 0.05 through that band reports three points where the decision lives.
 */
const DEFAULT_THRESHOLD_SWEEP = Array.from({ length: 25 }, (_, i) => (50 + i * 2) / 100);

/** Same weight as `runMatchingBenchmark`, so the two benchmarks' costs are comparable and
 * neither invents its own scale. `SPEC.md` §6.4 states the direction and no number; 5 is a
 * documented starting weight, and the report always says which weight produced its
 * numbers. */
const DEFAULT_FALSE_MERGE_WEIGHT = 5;

/**
 * A direction error sits between the two, and 2 is where I put it rather than a number I
 * can defend from data. It is worse than a false split: the GM is shown a reuse proposal
 * whose ends are backwards, so accepting it writes canon that says the opposite of the
 * source, and guardrail 3's evidence is attached to it. It is cheaper than a false merge:
 * the type's identity is right, so one relation row is wrong rather than every future
 * relation under that `key`. Stated here rather than folded into a mean so a reader can
 * disagree with it by passing another number.
 */
const DEFAULT_DIRECTION_ERROR_WEIGHT = 2;

export interface RunRelationLabelBenchmarkOptions {
	thresholds?: number[];
	falseMergeWeight?: number;
	directionErrorWeight?: number;
}

/** The shipped catalogue row for `key` as the seed migration writes it: English label and
 * inverse label, `universeId` null so `relationTypeMatchCandidates` expands it across every
 * shipped locale exactly as it does for a real row. */
export function shippedRelationTypeIdentity(key: string): RelationTypeIdentity {
	const entry = RELATION_TYPE_CATALOGUE.en[key];
	if (!entry) {
		throw new Error(
			`shippedRelationTypeIdentity: "${key}" is not a shipped relation type key. ` +
				`The shipped keys are ${Object.keys(RELATION_TYPE_CATALOGUE.en).sort().join(', ')}.`
		);
	}
	return { key, label: entry.label, inverseLabel: entry.inverseLabel, universeId: null };
}

/** Every label string the shipped type `key` is known by, across both directions and both
 * shipped locales - the exact set rung 2 embeds and rung 1 compares against. */
export function relationLabelCandidates(
	key: string
): Array<{ label: string; direction: 'forward' | 'inverse' }> {
	return relationTypeMatchCandidates(shippedRelationTypeIdentity(key));
}

/**
 * Whether rung 1 resolves `label` against the shipped type `key`, and in which direction.
 * Built from the two primitives rung 1 is itself built from (`normalizeRelationLabel` and
 * `relationTypeMatchCandidates`) rather than from a copy of its logic, and forward-first
 * because `resolveRelationType` runs its whole 1a loop before 1b, so a label that is both
 * a forward and an inverse label of the same type resolves forward.
 */
export function rungOneDirection(key: string, label: string): 'forward' | 'inverse' | null {
	const normalized = normalizeRelationLabel(label);
	const candidates = relationLabelCandidates(key);
	for (const direction of ['forward', 'inverse'] as const) {
		for (const candidate of candidates) {
			if (candidate.direction !== direction) continue;
			if (normalizeRelationLabel(candidate.label) === normalized) return direction;
		}
	}
	return null;
}

/**
 * Scores one pair the way `bestSemanticMatch` scores one candidate: the maximum similarity
 * across the type's whole expanded label set, with the winning label kept. Ties go to the
 * earlier candidate, which is `relationTypeMatchCandidates`'s own order (the row's stored
 * label first, then its inverse, then each locale) and therefore forward-first, matching
 * rung 1's precedence.
 */
export async function scoreRelationLabelPair(
	pair: RelationLabelPairExample,
	similarity: RelationLabelSimilarityFn
): Promise<RelationLabelPairScore> {
	const candidates = relationLabelCandidates(pair.catalogueKey);
	let best: { similarity: number; direction: 'forward' | 'inverse'; label: string } | null = null;
	for (const candidate of candidates) {
		const score = await similarity(pair.proposedLabel, candidate.label);
		if (!best || score > best.similarity) {
			best = { similarity: score, direction: candidate.direction, label: candidate.label };
		}
	}
	if (!best) {
		throw new Error(
			`scoreRelationLabelPair: shipped type "${pair.catalogueKey}" expanded to no labels, ` +
				'which relationTypeMatchCandidates cannot do for a real row'
		);
	}
	return {
		pair,
		similarity: best.similarity,
		direction: best.direction,
		matchedLabel: best.label
	};
}

/** What the rung does to one scored pair at one threshold. Exported because the sweep CLI
 * lists the pairs a threshold newly buys and must not reimplement this classification. */
export function classifyRelationLabelPair(
	scored: RelationLabelPairScore,
	threshold: number
): RelationLabelOutcome {
	const merged = scored.similarity >= threshold;
	// `distinct` has no direction a correct merge could take, which is what makes it the
	// only verdict whose two outcomes are "merged at all" and "did not".
	if (scored.pair.verdict === 'distinct') return merged ? 'false-merge' : 'correct-split';
	if (!merged) return 'false-split';
	const expected = scored.pair.verdict === 'same' ? 'forward' : 'inverse';
	return scored.direction === expected ? 'correct-merge' : 'direction-error';
}

function sweep(
	scoredPairs: RelationLabelPairScore[],
	thresholds: number[],
	falseMergeWeight: number,
	directionErrorWeight: number
): RelationLabelSweep {
	const scores: RelationLabelThresholdScore[] = thresholds.map((threshold) => {
		const falseMergeIds: string[] = [];
		const falseSplitIds: string[] = [];
		const directionErrorIds: string[] = [];
		for (const scored of scoredPairs) {
			const outcome = classifyRelationLabelPair(scored, threshold);
			if (outcome === 'false-merge') falseMergeIds.push(scored.pair.id);
			else if (outcome === 'false-split') falseSplitIds.push(scored.pair.id);
			else if (outcome === 'direction-error') directionErrorIds.push(scored.pair.id);
		}
		return {
			threshold,
			falseMerges: falseMergeIds.length,
			falseSplits: falseSplitIds.length,
			directionErrors: directionErrorIds.length,
			falseMergeIds,
			falseSplitIds,
			directionErrorIds,
			weightedCost:
				falseMergeIds.length * falseMergeWeight +
				directionErrorIds.length * directionErrorWeight +
				falseSplitIds.length
		};
	});

	let suggestedThreshold = scores[0];
	for (const score of scores) {
		if (!suggestedThreshold) {
			suggestedThreshold = score;
			continue;
		}
		// Strictly cheaper wins; equal cost goes to the higher threshold, which is the
		// conservative direction on this rung. `scores` is in the caller's threshold order,
		// so `<=` alone would not do it if a caller passed a descending sweep.
		if (
			score.weightedCost < suggestedThreshold.weightedCost ||
			(score.weightedCost === suggestedThreshold.weightedCost &&
				score.threshold > suggestedThreshold.threshold)
		) {
			suggestedThreshold = score;
		}
	}
	if (!suggestedThreshold) {
		throw new Error(
			'runRelationLabelBenchmark: threshold sweep produced no scores - options.thresholds was empty'
		);
	}
	return { pairCount: scoredPairs.length, scores, suggestedThreshold };
}

export async function runRelationLabelBenchmark(
	corpus: RelationLabelCorpus,
	similarity: RelationLabelSimilarityFn,
	options: RunRelationLabelBenchmarkOptions = {}
): Promise<RelationLabelBenchmarkReport> {
	const thresholds = options.thresholds ?? DEFAULT_THRESHOLD_SWEEP;
	const falseMergeWeight = options.falseMergeWeight ?? DEFAULT_FALSE_MERGE_WEIGHT;
	const directionErrorWeight = options.directionErrorWeight ?? DEFAULT_DIRECTION_ERROR_WEIGHT;

	// Sequential rather than `Promise.all`, unlike the entity benchmark: a real
	// `RelationLabelSimilarityFn` here is a lookup into one pre-embedded batch, and the
	// deterministic stand-in is pure, so there is nothing to overlap and a stable call order
	// makes a failing assertion readable.
	const pairScores: RelationLabelPairScore[] = [];
	for (const pair of corpus.pairs) {
		pairScores.push(await scoreRelationLabelPair(pair, similarity));
	}

	return {
		corpusId: corpus.id,
		pairCount: corpus.pairs.length,
		falseMergeWeight,
		directionErrorWeight,
		whole: sweep(pairScores, thresholds, falseMergeWeight, directionErrorWeight),
		rungTwoOnly: sweep(
			pairScores.filter((scored) => !scored.pair.rungOne),
			thresholds,
			falseMergeWeight,
			directionErrorWeight
		),
		pairScores
	};
}
