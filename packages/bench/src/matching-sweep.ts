/**
 * Measures the matching decision of SPEC.md §6.4 with both `SimilarityFn`s the product can
 * be wired with, over the same labelled corpus, and re-derives `MATCH_THRESHOLDS` and
 * `EMBEDDING_MATCH_THRESHOLDS` (`packages/import/src/matching.ts`) from the numbers. Issues
 * #279 and #310.
 *
 * Thresholds derived for trigram Jaccard have no reason to be right for cosine similarity,
 * so this reports both distributions and both band classifications rather than assuming the
 * band transfers. It runs `runMatchingBenchmark` for the single-threshold view and the real
 * `resolveMatch` for the three-way one, because match/ask/new is what the product actually
 * decides and reimplementing that classification here would measure the reimplementation.
 *
 * ### Four scorers, because issue #310 changed the text and not the metric
 *
 * #279 measured a cosine over a bare name and found the ceiling: mean 0.912 over true pairs
 * against 0.853 over false ones, so the band had to ask about 20 of 24 pairs to hold false
 * merges at the floor. #310's answer is to give each side the `MatchContext` the seam already
 * had available and was discarding. That is a change to the text being compared, so this run
 * scores **both texts with both metrics**, in one process against one model at one moment:
 * names only and names plus context, trigram and cosine. Measuring the before on a different
 * day would leave "the model moved" as an explanation for the difference.
 *
 * ### Runs, because one run sets a threshold by noise
 *
 * #279's most useful finding: two sweeps of the same corpus against the same model scored the
 * acceptance pair 0.802 and 0.799, either side of the `newBelow` that one run had made look
 * obvious, which would have turned SPEC.md §6.4's own example from a question into a false
 * split. So this runs the whole corpus `--runs` times (default `DEFAULT_RUNS`), with a fresh
 * `createEmbeddingSimilarity` each time so the cache cannot hand back the first run's vectors,
 * reports each pair's mean and observed spread, and **refuses to recommend a band a pair's
 * jitter could push into or out of an error**. Jitter that can only move a pair between asking
 * and deciding is reported in its own column and does not disqualify a band, because that
 * moves what a run costs and not whether it is right.
 *
 * ### Two deliberate departures from this package's usual rules, both stated rather than hidden
 *
 * **It writes nothing, so it carries no `_bench`/`_e2e` database guard.** Every other runner
 * here refuses a database that is not disposable because it writes `model_config`,
 * `proposal`, `entity` and `model_call` rows. This one only reads `model_config`'s
 * `embedding` row, so the guard would forbid pointing it at a database it cannot harm.
 *
 * **It calls `embedMany` directly rather than through `createGatewayEmbedder`.** That is the
 * one product function it does not run, and the reason is that `createGatewayEmbedder` wraps
 * every call in `withUsage`, which writes a `model_call` row against a real user id. A
 * threshold sweep has no user to attribute embeddings to, and inventing one would put fake
 * rows in the table SPEC.md §14's cost metrics read. Underneath, the call is the same
 * `embedMany` against the same gateway-routed model that `createGatewayEmbedder` makes. The
 * scorer itself, `createEmbeddingSimilarity`, is exactly what a real import runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { embedMany } from 'ai';
import { closeDb, createDb } from '@canonry/db';
import { createEmbeddingModel, readGatewayCredentials, resolveModel } from '@canonry/ai';
import { embeddingDimensionsFor } from '@canonry/indexing';
import {
	createEmbeddingSimilarity,
	createLexicalTrigramSimilarity,
	matchTextFor,
	EMBEDDING_MATCH_THRESHOLDS,
	MATCH_THRESHOLDS,
	resolveMatch,
	runMatchingBenchmark,
	SAMPLE_WORLD_MATCHING_CORPUS,
	type MatchingCorpus,
	type MatchingPairExample,
	type MatchThresholds,
	type SimilarityFn
} from '@canonry/import';
import { dataDir, loadEnv, requireEnv } from './env.js';

/** SPEC.md §6.4 states the direction ("false merges are weighted far heavier") without a
 * number, and `runMatchingBenchmark` already documents 5 as a starting weight rather than a
 * claim. Same weight here so the two views of the same corpus are comparable. */
const FALSE_MERGE_WEIGHT = 5;

/** An ask is not an error - SPEC.md §6.4 wants the in-between band asked rather than guessed
 * - but it is not free either, and pricing it at zero is what makes a threshold sweep
 * recommend a matcher that asks about almost everything. It is stated separately from the
 * two error weights, and it is a stated choice rather than a measurement: half a false
 * split, on the reasoning that a question the GM answers costs less than a duplicate the GM
 * has to find and merge, and that SPEC.md §14's first metric is the accept rate of what the
 * copilot proposes rather than the count of questions it avoids getting wrong. Both cost
 * columns are reported, so a reader who disagrees with 0.5 can re-rank from the raw counts.
 */
const ASK_WEIGHT = 0.5;

/** How many times the whole corpus is scored, unless `--runs=N` says otherwise. Five rather
 * than two: two runs can only ever report the distance between two samples, and the question
 * a band needs answered is how wide the jitter is, which needs enough samples that a third
 * one does not move it. One `embedMany` call per run, so the cost of the default is a few
 * thousand embedding tokens for the whole exercise. */
const DEFAULT_RUNS = 5;

/** The floor under an observed spread when the bands are checked for fragility. #279 measured
 * this model returning cosines that move by about 0.003 between calls on identical input, and
 * `packages/indexing/src/models.ts` measured the same thing from the retrieval side (repeated
 * calls for one text, cosine self-similarity 0.99989). A corpus scored a handful of times can
 * easily observe a spread of zero on a pair that would move on the eleventh run, so a bound is
 * never trusted closer than this to a score even when the samples all agreed. */
const JITTER_FLOOR = 0.01;

const NEW_BELOW_SWEEP = [
	0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9
];
/** Up to 0.98 rather than 0.95: qwen3's cosines for two short name strings sit high and
 * compressed (the scale warning `packages/indexing/src/models.ts` already carries for
 * retrieval), so the interesting part of the range for a cosine match band is above where a
 * Jaccard band would ever need to look. */
const MATCH_ABOVE_SWEEP = [
	0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98
];

/** One of the four scorer/text combinations this run measures. */
type ViewId = 'trigram-names' | 'trigram-context' | 'cosine-names' | 'cosine-context';

interface View {
	id: ViewId;
	label: string;
	/** The corpus as this view compares it: with `MatchContext` or with it stripped. */
	corpus: MatchingCorpus;
	similarityFor: (run: number) => SimilarityFn;
}

/** Every score one pair took across the runs, plus what the band derivation reads off them. */
interface PairScore {
	id: string;
	sameEntity: boolean;
	sameType: boolean;
	subjectText: string;
	candidateText: string;
	runs: number[];
	mean: number;
	min: number;
	max: number;
	/** `max - min` over the runs: the jitter this pair actually showed. */
	spread: number;
}

/** How the product's own three-way decision lands on the corpus for one threshold pair.
 * `asks` is not an error: SPEC.md §6.4 wants the in-between band asked rather than guessed,
 * so it is reported next to the two errors instead of folded into a single cost. */
interface BandScore {
	matchAbove: number;
	newBelow: number;
	correctMatches: number;
	correctNews: number;
	falseMerges: number;
	falseSplits: number;
	asksOnPositives: number;
	asksOnNegatives: number;
	/** falseMerges * FALSE_MERGE_WEIGHT + falseSplits, the same cost `runMatchingBenchmark`
	 * uses, so the two views of one corpus rank on one scale. Asks are free in this column. */
	weightedCost: number;
	/** The same, plus ASK_WEIGHT per ask. This is the column the thresholds are chosen on:
	 * see ASK_WEIGHT's own comment for why a sweep that prices an ask at zero recommends a
	 * matcher that asks about almost everything. */
	totalCost: number;
	/**
	 * Pairs whose score sits close enough to a bound that a different run could move them
	 * across it **into or out of an error**: a true pair near `newBelow` (drifting under it is a
	 * false split) or a false pair near `matchAbove` (drifting over it is a false merge, the
	 * expensive one). This is the list that disqualifies a band, because it is the one where
	 * jitter changes the answer that matters. #279's near miss is exactly this shape: the
	 * bilingual acceptance pair scored 0.802 and 0.799 on two runs either side of a `newBelow`
	 * of 0.80, which would have turned SPEC.md §6.4's own example into a false split.
	 */
	errorFragileOn: string[];
	/**
	 * Pairs equally close to a bound whose drift can only move them between asking and
	 * deciding, never into an error: a true pair near `matchAbove`, a false pair near
	 * `newBelow`. Reported rather than ignored, because it does move the ask count a reader is
	 * comparing bands on, and kept separate from the list above because treating the two as one
	 * risk is how a band gets rejected for being unstable in the direction that costs nothing.
	 */
	askFragileOn: string[];
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The corpus a "names only" view compares: the same pairs, with `MatchContext` removed from
 * both sides, so the text embedded and the text trigrammed are byte-identical to what they
 * were before issue #310. That is what makes the before column a baseline rather than a
 * memory of a previous run. */
function withoutContext(corpus: MatchingCorpus): MatchingCorpus {
	return {
		...corpus,
		pairs: corpus.pairs.map((pair) => ({
			...pair,
			subject: { name: pair.subject.name, aliases: pair.subject.aliases },
			candidate: {
				id: pair.candidate.id,
				name: pair.candidate.name,
				aliases: pair.candidate.aliases
			}
		}))
	};
}

/** Whether a real candidate pool could ever present this pair: `candidateEntitiesForMatching`
 * filters to one entity type before any similarity call, so a cross-type pair is a corpus
 * artefact and its type line separates it for free. A pair whose sides declare no type counts
 * as same-type, since nothing about it is being separated by a type either. */
function isSameType(pair: MatchingPairExample): boolean {
	const subjectType = pair.subject.context?.type ?? null;
	const candidateType = pair.candidate.context?.type ?? null;
	if (subjectType === null || candidateType === null) return true;
	return subjectType === candidateType;
}

/**
 * Scores every pair of one view `runs` times and folds the runs into a mean and a spread.
 *
 * All of a run's pairs are issued in one synchronous sweep and awaited together, which is
 * what `resolveMatch` does with a real candidate set and what `createEmbeddingSimilarity`'s
 * microtask coalescing is built for: one `embedMany` for the whole corpus instead of one per
 * pair. Awaiting pair by pair measured the same numbers and made 48 gateway calls per run to
 * do it.
 */
async function scoreView(view: View, runs: number): Promise<PairScore[]> {
	const perRun: number[][] = [];
	for (let run = 0; run < runs; run++) {
		const similarity = view.similarityFor(run);
		perRun.push(
			await Promise.all(view.corpus.pairs.map((pair) => similarity(pair.subject, pair.candidate)))
		);
	}
	return view.corpus.pairs.map((pair, index) => {
		const values = perRun.map((scores) => scores[index] ?? 0);
		const min = Math.min(...values);
		const max = Math.max(...values);
		return {
			id: pair.id,
			sameEntity: pair.sameEntity,
			sameType: isSameType(pair),
			subjectText: matchTextFor(pair.subject),
			candidateText: matchTextFor(pair.candidate),
			runs: values,
			mean: mean(values),
			min,
			max,
			spread: max - min
		};
	});
}

/**
 * A `SimilarityFn` that replays the measured mean for a pair instead of scoring it again.
 *
 * Keyed on the two embedded texts, which is what "this pair" means to a scorer: the corpus
 * reuses candidate ids across pairs (three pairs point at `char-aldric`) so an id is not a
 * key, while the text pair is unique here and is asserted to be. A miss throws rather than
 * returning zero, because a silent zero would read as a genuine measurement of no similarity.
 */
function measured(pairs: PairScore[]): SimilarityFn {
	const byTexts = new Map<string, number>();
	for (const pair of pairs) {
		const key = `${pair.subjectText}\u0000${pair.candidateText}`;
		if (byTexts.has(key)) {
			throw new Error(
				`two corpus pairs reduce to the same pair of texts (${pair.id}), so a measured ` +
					`score cannot be replayed by text. Give one of them distinguishing context.`
			);
		}
		byTexts.set(key, pair.mean);
	}
	return (subject, candidate) => {
		const key = `${matchTextFor(subject)}\u0000${matchTextFor(candidate)}`;
		const score = byTexts.get(key);
		if (score === undefined) throw new Error('no measured score for this pair');
		return score;
	};
}

/**
 * The whole threshold grid, classified by the product's own `resolveMatch`, from the mean
 * score each pair took across the runs.
 *
 * `resolveMatch` gets a `SimilarityFn` that returns the recorded number rather than the live
 * scorer: the decision logic under test is still the product's, and the 225 grid points are
 * scored from one set of measurements instead of asking a cached embedder the same question
 * two hundred times, which would report the cache's determinism as the model's.
 */
async function bandScores(pairs: PairScore[], corpus: MatchingCorpus): Promise<BandScore[]> {
	const scores: BandScore[] = [];
	for (const matchAbove of MATCH_ABOVE_SWEEP) {
		for (const newBelow of NEW_BELOW_SWEEP) {
			if (newBelow > matchAbove) continue;
			const score: BandScore = {
				matchAbove,
				newBelow,
				correctMatches: 0,
				correctNews: 0,
				falseMerges: 0,
				falseSplits: 0,
				asksOnPositives: 0,
				asksOnNegatives: 0,
				weightedCost: 0,
				totalCost: 0,
				errorFragileOn: [],
				askFragileOn: []
			};
			for (const [index, pair] of corpus.pairs.entries()) {
				const measured = pairs[index];
				if (!measured) continue;
				const decision = await resolveMatch({
					subject: pair.subject,
					exactSourceRefMatch: null,
					candidates: [pair.candidate],
					similarity: () => measured.mean,
					thresholds: { matchAbove, newBelow }
				});
				if (decision.outcome === 'match') {
					if (pair.sameEntity) score.correctMatches += 1;
					else score.falseMerges += 1;
				} else if (decision.outcome === 'new') {
					if (pair.sameEntity) score.falseSplits += 1;
					else score.correctNews += 1;
				} else if (pair.sameEntity) {
					score.asksOnPositives += 1;
				} else {
					score.asksOnNegatives += 1;
				}
				const margin = Math.max(measured.spread, JITTER_FLOOR);
				// Which side of the error line a drift across the nearer bound would land on. A true
				// pair only errs by falling under `newBelow`, a false pair only by rising over
				// `matchAbove`; the other direction of each costs a question, which SPEC.md §6.4 asks
				// for rather than counts against.
				const errorBound = pair.sameEntity ? newBelow : matchAbove;
				const askBound = pair.sameEntity ? matchAbove : newBelow;
				if (Math.abs(measured.mean - errorBound) < margin) score.errorFragileOn.push(measured.id);
				else if (Math.abs(measured.mean - askBound) < margin) score.askFragileOn.push(measured.id);
			}
			score.weightedCost = score.falseMerges * FALSE_MERGE_WEIGHT + score.falseSplits;
			score.totalCost =
				score.weightedCost + (score.asksOnPositives + score.asksOnNegatives) * ASK_WEIGHT;
			scores.push(score);
		}
	}
	return scores;
}

/** Recall and precision of the decisive-match outcome alone: of the true pairs, how many
 * were matched without a question, and of the pairs matched without a question, how many
 * were true. Asks are neither, which is why both numbers are stated with the ask counts
 * beside them and never on their own. */
function recallPrecision(
	score: BandScore,
	positives: number
): { recall: number; precision: number } {
	const matched = score.correctMatches + score.falseMerges;
	return {
		recall: positives === 0 ? 0 : score.correctMatches / positives,
		precision: matched === 0 ? 1 : score.correctMatches / matched
	};
}

function pad(value: string | number, width: number): string {
	return String(value).padStart(width);
}

function bandRow(score: BandScore, positives: number, negatives: number): string {
	const { recall, precision } = recallPrecision(score, positives);
	return (
		`| ${score.matchAbove.toFixed(2)} | ${score.newBelow.toFixed(2)} ` +
		`| ${pad(score.correctMatches, 2)}/${positives} | ${pad(score.correctNews, 2)}/${negatives} ` +
		`| ${pad(score.falseMerges, 2)} | ${pad(score.falseSplits, 2)} ` +
		`| ${pad(score.asksOnPositives, 2)}/${pad(score.asksOnNegatives, 2)} ` +
		`| ${recall.toFixed(3)} | ${precision.toFixed(3)} | ${pad(score.weightedCost, 3)} ` +
		`| ${score.totalCost.toFixed(1).padStart(5)} ` +
		`| ${score.errorFragileOn.length > 0 ? `error:${score.errorFragileOn.length}` : 'clear'} ` +
		`| ${score.askFragileOn.length > 0 ? `ask:${score.askFragileOn.length}` : '-'} |`
	);
}

const BAND_HEADER =
	'| matchAbove | newBelow | matched | new | falseMerge | falseSplit | ask +/- | recall | precision | cost | cost+ask | jitter | ask jitter |';
const BAND_DIVIDER =
	'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

function ranked(scores: BandScore[]): BandScore[] {
	return [...scores].sort(
		(a, b) =>
			a.totalCost - b.totalCost || a.falseMerges - b.falseMerges || b.matchAbove - a.matchAbove
	);
}

function bandTable(
	title: string,
	scores: BandScore[],
	positives: number,
	negatives: number,
	limit: number
): void {
	console.log(`\n${title}`);
	console.log(BAND_HEADER);
	console.log(BAND_DIVIDER);
	for (const score of ranked(scores).slice(0, limit)) {
		console.log(bandRow(score, positives, negatives));
	}
}

/** The sweep row for one of the two shipped bands, so a run always states what the constant
 * it is re-deriving actually costs on this corpus rather than only what the optimum costs. */
function shipped(scores: BandScore[], thresholds: MatchThresholds, name: string): BandScore {
	const found = scores.find(
		(score) => score.matchAbove === thresholds.matchAbove && score.newBelow === thresholds.newBelow
	);
	if (!found) {
		throw new Error(
			`the sweep grid does not contain ${name} (${thresholds.matchAbove}/` +
				`${thresholds.newBelow}), so this run cannot say what it costs. Widen ` +
				`NEW_BELOW_SWEEP/MATCH_ABOVE_SWEEP.`
		);
	}
	return found;
}

/**
 * The band this run recommends: the cheapest row no pair's jitter can push into or out of an
 * error. The cheapest row overall is reported beside it, so the price of insisting on that is
 * visible rather than hidden inside one number.
 *
 * Ask-side jitter deliberately does not disqualify a row. A bound a question drifts across
 * changes what the run costs and not whether it is right, and rejecting bands for that would
 * throw away the whole point of SPEC.md §6.4's in-between band.
 */
function recommend(scores: BandScore[]): { cheapest: BandScore; robust: BandScore | null } {
	const order = ranked(scores);
	const cheapest = order[0];
	if (!cheapest) throw new Error('empty threshold grid');
	return { cheapest, robust: order.find((score) => score.errorFragileOn.length === 0) ?? null };
}

function separationLine(pairs: PairScore[]): string {
	const same = pairs.filter((pair) => pair.sameEntity).map((pair) => pair.mean);
	const diff = pairs.filter((pair) => !pair.sameEntity).map((pair) => pair.mean);
	if (same.length === 0 || diff.length === 0) return 'not enough labelled pairs';
	return (
		`mean same ${mean(same).toFixed(3)}, mean diff ${mean(diff).toFixed(3)}, ` +
		`separation ${(mean(same) - mean(diff)).toFixed(3)}, worst true pair ` +
		`${Math.min(...same).toFixed(3)}, best false pair ${Math.max(...diff).toFixed(3)}`
	);
}

function parseRuns(argv: string[]): number {
	for (const arg of argv) {
		const match = /^--runs=(\d+)$/.exec(arg);
		if (match?.[1]) {
			const runs = Number(match[1]);
			if (runs >= 1) return runs;
		}
	}
	return DEFAULT_RUNS;
}

async function main(): Promise<void> {
	loadEnv();
	requireEnv('AI_GATEWAY_API_KEY');
	const databaseUrl = requireEnv('DATABASE_URL');
	const runs = parseRuns(process.argv.slice(2));

	const db = createDb(databaseUrl);
	try {
		const model = await resolveModel(db, 'embedding');
		const vectorSize = embeddingDimensionsFor(model.provider, model.modelId);
		const embeddingModel = createEmbeddingModel(
			model.provider,
			model.modelId,
			readGatewayCredentials(process.env)
		);

		let embedCalls = 0;
		let embedTexts = 0;
		// Tokens as the provider reported them, never a credit figure. Issue #271's measurement
		// found `computeCost` prices a cached input token as fresh, so credits currently
		// overstate spend on any purpose where a provider serves from its own implicit cache.
		// It does not reach this run - `import.match.embed` is a zero-credit reading operation
		// and this script does not bill at all - and reporting the raw count keeps it that way
		// rather than leaving a reader to wonder which side of #271 the number came from.
		let embedTokens = 0;
		const embed = async (texts: string[]): Promise<number[][]> => {
			embedCalls += 1;
			embedTexts += texts.length;
			const result = await embedMany({ model: embeddingModel, values: texts });
			embedTokens += result.usage.tokens ?? 0;
			return result.embeddings;
		};

		const corpus = SAMPLE_WORLD_MATCHING_CORPUS;
		const namesOnly = withoutContext(corpus);
		const positives = corpus.pairs.filter((pair) => pair.sameEntity).length;
		const negatives = corpus.pairs.length - positives;

		// `createEmbeddingSimilarity` directly rather than `bandedSimilarity`, which is the one
		// place in the repo that should not use the pairing: this run has to score the embedding
		// scorer against the *lexical* band to show that band is unreachable for it, and a
		// function whose whole job is to refuse that combination cannot express it. Everything
		// downstream of a measurement uses the pairing; the measurement that produced it cannot.
		//
		// A fresh instance per run, because the cache inside one instance is keyed on the exact
		// text: reusing it across runs would hand back run 1's vectors and report the cache's
		// determinism as the model's, which is exactly the jitter this run exists to measure.
		const views: View[] = [
			{
				id: 'trigram-names',
				label: 'trigram Jaccard, names only (shipped lexical scorer)',
				corpus: namesOnly,
				similarityFor: () => createLexicalTrigramSimilarity({ includeContext: false })
			},
			{
				id: 'trigram-context',
				label: 'trigram Jaccard, names plus context',
				corpus,
				similarityFor: () => createLexicalTrigramSimilarity({ includeContext: true })
			},
			{
				id: 'cosine-names',
				label: 'embedding cosine, names only (the #279 baseline)',
				corpus: namesOnly,
				similarityFor: () => createEmbeddingSimilarity({ vectorSize, embed })
			},
			{
				id: 'cosine-context',
				label: 'embedding cosine, names plus context (issue #310)',
				corpus,
				similarityFor: () => createEmbeddingSimilarity({ vectorSize, embed })
			}
		];

		console.log(
			`Matching sweep: ${corpus.name}, ${corpus.pairs.length} labelled pairs ` +
				`(${positives} same, ${negatives} different), ${runs} run(s)`
		);
		console.log(`Embedding model: ${model.provider}/${model.modelId}, ${vectorSize} dimensions`);
		console.log(
			`Shipped bands: MATCH_THRESHOLDS ${JSON.stringify(MATCH_THRESHOLDS)}, ` +
				`EMBEDDING_MATCH_THRESHOLDS ${JSON.stringify(EMBEDDING_MATCH_THRESHOLDS)}`
		);

		const scored = new Map<ViewId, PairScore[]>();
		for (const view of views) scored.set(view.id, await scoreView(view, runs));

		const scoresOf = (id: ViewId): PairScore[] => {
			const pairs = scored.get(id);
			if (!pairs) throw new Error(`view ${id} was not scored`);
			return pairs;
		};

		console.log('\nPer-pair mean scores over the runs');
		console.log(
			'| pair | label | same type | trigram names | trigram ctx | cosine names | cosine ctx | cosine ctx delta | max spread |'
		);
		console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
		for (const [index, pair] of corpus.pairs.entries()) {
			const cells = views.map((view) => scoresOf(view.id)[index]);
			const [trigramNames, trigramContext, cosineNames, cosineContext] = cells;
			if (!trigramNames || !trigramContext || !cosineNames || !cosineContext) continue;
			const delta = cosineContext.mean - cosineNames.mean;
			const spread = Math.max(...cells.map((cell) => cell?.spread ?? 0));
			console.log(
				`| ${pair.id} | ${pair.sameEntity ? 'same' : 'diff'} ` +
					`| ${isSameType(pair) ? 'yes' : 'no'} | ${trigramNames.mean.toFixed(3)} ` +
					`| ${trigramContext.mean.toFixed(3)} | ${cosineNames.mean.toFixed(3)} ` +
					`| ${cosineContext.mean.toFixed(3)} ` +
					`| ${(delta >= 0 ? '+' : '') + delta.toFixed(3)} | ${spread.toFixed(4)} |`
			);
		}

		console.log('\nSeparation, whole corpus');
		for (const view of views) {
			console.log(`  ${view.label.padEnd(52)} ${separationLine(scoresOf(view.id))}`);
		}
		console.log('\nSeparation, same-type pairs only (the shape a real candidate pool has)');
		for (const view of views) {
			const sameType = scoresOf(view.id).filter((pair) => pair.sameType);
			console.log(`  ${view.label.padEnd(52)} ${separationLine(sameType)}`);
		}

		const bands = new Map<ViewId, BandScore[]>();
		for (const view of views) {
			bands.set(view.id, await bandScores(scoresOf(view.id), view.corpus));
		}
		const bandsOf = (id: ViewId): BandScore[] => {
			const rows = bands.get(id);
			if (!rows) throw new Error(`view ${id} has no band scores`);
			return rows;
		};

		const shippedRows: Array<[string, BandScore]> = [
			[
				'MATCH_THRESHOLDS on trigram names       ',
				shipped(bandsOf('trigram-names'), MATCH_THRESHOLDS, 'MATCH_THRESHOLDS')
			],
			[
				'MATCH_THRESHOLDS on trigram context     ',
				shipped(bandsOf('trigram-context'), MATCH_THRESHOLDS, 'MATCH_THRESHOLDS')
			],
			[
				'MATCH_THRESHOLDS on cosine context      ',
				shipped(bandsOf('cosine-context'), MATCH_THRESHOLDS, 'MATCH_THRESHOLDS')
			],
			[
				'EMBEDDING_MATCH_THRESHOLDS cosine names ',
				shipped(bandsOf('cosine-names'), EMBEDDING_MATCH_THRESHOLDS, 'EMBEDDING_MATCH_THRESHOLDS')
			],
			[
				'EMBEDDING_MATCH_THRESHOLDS cosine ctx   ',
				shipped(bandsOf('cosine-context'), EMBEDDING_MATCH_THRESHOLDS, 'EMBEDDING_MATCH_THRESHOLDS')
			]
		];
		console.log('\nWhat the two shipped constants cost on this corpus');
		console.log(`| constant ${BAND_HEADER.slice(1)}`);
		console.log(`| --- ${BAND_DIVIDER.slice(1)}`);
		for (const [name, score] of shippedRows) {
			console.log(`| ${name} ${bandRow(score, positives, negatives).slice(1)}`);
		}

		for (const view of views) {
			bandTable(
				`Best ten threshold pairs, ${view.label}`,
				bandsOf(view.id),
				positives,
				negatives,
				10
			);
		}

		console.log(
			'\nRe-derived bands (cheapest row, and cheapest row no pair-s jitter can turn into an error)'
		);
		for (const view of views) {
			const { cheapest, robust } = recommend(bandsOf(view.id));
			const describe = (score: BandScore | null): string =>
				score
					? `${score.matchAbove.toFixed(2)}/${score.newBelow.toFixed(2)} ` +
						`(${score.falseMerges} false merge, ${score.falseSplits} false split, ` +
						`${score.asksOnPositives + score.asksOnNegatives} ask, cost+ask ${score.totalCost.toFixed(1)})` +
						(score.errorFragileOn.length > 0
							? `; jitter could turn an error on ${[...new Set(score.errorFragileOn)].join(', ')}`
							: '') +
						(score.askFragileOn.length > 0
							? `; jitter could move a question on ${[...new Set(score.askFragileOn)].join(', ')}`
							: '')
					: 'none: every row on the grid has an error bound inside some pair-s jitter';
			console.log(`  ${view.label}`);
			console.log(`    cheapest: ${describe(cheapest)}`);
			console.log(`    robust:   ${describe(robust)}`);
		}

		// Fed from the measurements above rather than from a live scorer, for the reason
		// `bandScores` states: one set of numbers behind every view of this corpus, and no extra
		// gateway call to re-ask a question already answered once per run.
		const lexicalReport = await runMatchingBenchmark(
			namesOnly,
			measured(scoresOf('trigram-names')),
			{
				falseMergeWeight: FALSE_MERGE_WEIGHT
			}
		);
		const embeddingReport = await runMatchingBenchmark(
			corpus,
			measured(scoresOf('cosine-context')),
			{ falseMergeWeight: FALSE_MERGE_WEIGHT }
		);
		console.log(
			`\nSingle-threshold sweep (runMatchingBenchmark, false-merge weight ${FALSE_MERGE_WEIGHT}x):`
		);
		console.log(
			`  trigram names   suggests ${lexicalReport.suggestedThreshold.threshold.toFixed(2)} ` +
				`(${lexicalReport.suggestedThreshold.falseMerges} false merges, ` +
				`${lexicalReport.suggestedThreshold.falseSplits} false splits, cost ` +
				`${lexicalReport.suggestedThreshold.weightedCost})`
		);
		console.log(
			`  cosine context  suggests ${embeddingReport.suggestedThreshold.threshold.toFixed(2)} ` +
				`(${embeddingReport.suggestedThreshold.falseMerges} false merges, ` +
				`${embeddingReport.suggestedThreshold.falseSplits} false splits, cost ` +
				`${embeddingReport.suggestedThreshold.weightedCost})`
		);

		console.log(
			`\nGateway usage of this run: ${embedCalls} embedMany call(s), ${embedTexts} text(s), ` +
				`${embedTokens} embedding token(s) as the provider counted them. Not a credit figure ` +
				`and not derived from computeCost (see the comment on embedTokens). Every threshold ` +
				`pair above is scored from the per-run measurements, so the grid costs nothing beyond ` +
				`the ${runs} run(s) themselves.`
		);

		const undecidable = scoresOf('cosine-context').filter(
			(pair) => !pair.sameEntity && pair.subjectText === pair.candidateText
		);
		console.log(
			undecidable.length > 0
				? `\n${undecidable.length} negative pair(s) are still byte-identical as text ` +
						`(${undecidable.map((pair) => pair.id).join(', ')}): no scorer of any kind can ` +
						`separate them, so they are a false merge at every threshold below 1.0.`
				: '\nNo negative pair is byte-identical as text any more: the two that were under ' +
						'names-only comparison (an office whose holder changed, a generic guard title ' +
						'reused in two settlements) now differ in the context each side carries, which is ' +
						'the floor issue #310 set out to lift.'
		);

		mkdirSync(dataDir, { recursive: true });
		const outPath = path.join(dataDir, 'matching-sweep.json');
		writeFileSync(
			outPath,
			JSON.stringify(
				{
					corpusId: corpus.id,
					pairCount: corpus.pairs.length,
					positives,
					negatives,
					runs,
					jitterFloor: JITTER_FLOOR,
					embeddingModel: { ...model, vectorSize },
					falseMergeWeight: FALSE_MERGE_WEIGHT,
					askWeight: ASK_WEIGHT,
					shippedThresholds: {
						lexical: MATCH_THRESHOLDS,
						embedding: EMBEDDING_MATCH_THRESHOLDS
					},
					embedCalls,
					embedTexts,
					embedTokens,
					views: views.map((view) => ({
						id: view.id,
						label: view.label,
						pairs: scoresOf(view.id),
						bands: bandsOf(view.id),
						recommended: recommend(bandsOf(view.id))
					})),
					singleThreshold: { trigramNames: lexicalReport, cosineContext: embeddingReport }
				},
				null,
				2
			)
		);
		console.log(`\nWrote ${outPath}`);
	} finally {
		await closeDb(db);
	}
}

await main();
