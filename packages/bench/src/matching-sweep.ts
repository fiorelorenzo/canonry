/**
 * Measures the matching decision of SPEC.md §6.4 with both `SimilarityFn`s the product can
 * be wired with, over the same labelled corpus, and re-derives `MATCH_THRESHOLDS`
 * (`packages/import/src/matching.ts`) from the numbers. Issue #279, and the answer to
 * `MATCH_THRESHOLDS`'s own doc comment: "nothing wires the benchmark's sweep back into this
 * constant yet, and no labelled corpus run has produced a number to replace this one with."
 *
 * Thresholds derived for trigram Jaccard have no reason to be right for cosine similarity,
 * so this reports both distributions and both band classifications rather than assuming the
 * band transfers. It runs `runMatchingBenchmark` for the single-threshold view and the real
 * `resolveMatch` for the three-way one, because match/ask/new is what the product actually
 * decides and reimplementing that classification here would measure the reimplementation.
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
	lexicalTrigramSimilarity,
	matchTextFor,
	EMBEDDING_MATCH_THRESHOLDS,
	MATCH_THRESHOLDS,
	resolveMatch,
	runMatchingBenchmark,
	SAMPLE_WORLD_MATCHING_CORPUS,
	type MatchingCorpus,
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

/** Only the shipped constants and the top of each ranking go to stdout; the full grid is in
 * the JSON. */

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

interface ScoredPair {
	id: string;
	sameEntity: boolean;
	subjectText: string;
	candidateText: string;
	lexical: number;
	embedding: number;
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
}

async function bandScores(corpus: MatchingCorpus, similarity: SimilarityFn): Promise<BandScore[]> {
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
				totalCost: 0
			};
			for (const pair of corpus.pairs) {
				const decision = await resolveMatch({
					subject: pair.subject,
					exactSourceRefMatch: null,
					candidates: [pair.candidate],
					similarity,
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
		`| ${score.totalCost.toFixed(1).padStart(5)} |`
	);
}

function bandTable(
	title: string,
	scores: BandScore[],
	positives: number,
	negatives: number,
	limit: number
): void {
	const best = [...scores].sort(
		(a, b) =>
			a.totalCost - b.totalCost || a.falseMerges - b.falseMerges || b.matchAbove - a.matchAbove
	);
	console.log(`\n${title}`);
	console.log(
		'| matchAbove | newBelow | matched | new | falseMerge | falseSplit | ask +/- | recall | precision | cost | cost+ask |'
	);
	console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const score of best.slice(0, limit)) console.log(bandRow(score, positives, negatives));
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

async function main(): Promise<void> {
	loadEnv();
	requireEnv('AI_GATEWAY_API_KEY');
	const databaseUrl = requireEnv('DATABASE_URL');

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
		// It does not reach this run - `index.embed` is a zero-credit reading operation and this
		// script does not bill at all - and reporting the raw count keeps it that way rather
		// than leaving a reader to wonder which side of #271 the number came from.
		let embedTokens = 0;
		// `createEmbeddingSimilarity` directly rather than `bandedSimilarity`, which is the one
		// place in the repo that should not use the pairing: this run has to score the embedding
		// scorer against the *lexical* band to show that band is unreachable for it, and a
		// function whose whole job is to refuse that combination cannot express it. Everything
		// downstream of a measurement uses the pairing; the measurement that produced it cannot.
		const embeddingSimilarity = createEmbeddingSimilarity({
			vectorSize,
			embed: async (texts) => {
				embedCalls += 1;
				embedTexts += texts.length;
				const result = await embedMany({ model: embeddingModel, values: texts });
				embedTokens += result.usage.tokens ?? 0;
				return result.embeddings;
			}
		});

		const corpus = SAMPLE_WORLD_MATCHING_CORPUS;
		const positives = corpus.pairs.filter((pair) => pair.sameEntity).length;
		const negatives = corpus.pairs.length - positives;

		console.log(
			`Matching sweep: ${corpus.name}, ${corpus.pairs.length} labelled pairs ` +
				`(${positives} same, ${negatives} different)`
		);
		console.log(`Embedding model: ${model.provider}/${model.modelId}, ${vectorSize} dimensions`);
		console.log(
			`Shipped bands: MATCH_THRESHOLDS ${JSON.stringify(MATCH_THRESHOLDS)}, ` +
				`EMBEDDING_MATCH_THRESHOLDS ${JSON.stringify(EMBEDDING_MATCH_THRESHOLDS)}`
		);

		const lexicalReport = await runMatchingBenchmark(corpus, lexicalTrigramSimilarity, {
			falseMergeWeight: FALSE_MERGE_WEIGHT
		});
		const embeddingReport = await runMatchingBenchmark(corpus, embeddingSimilarity, {
			falseMergeWeight: FALSE_MERGE_WEIGHT
		});

		const scoredPairs: ScoredPair[] = [];
		for (const pair of corpus.pairs) {
			scoredPairs.push({
				id: pair.id,
				sameEntity: pair.sameEntity,
				subjectText: matchTextFor(pair.subject),
				candidateText: matchTextFor(pair.candidate),
				lexical: await lexicalTrigramSimilarity(pair.subject, pair.candidate),
				embedding: await embeddingSimilarity(pair.subject, pair.candidate)
			});
		}

		console.log('\nPer-pair scores (label, trigram Jaccard, embedding cosine)');
		console.log('| pair | label | trigram | cosine | delta |');
		console.log('| --- | --- | --- | --- | --- |');
		for (const scored of scoredPairs) {
			console.log(
				`| ${scored.id} | ${scored.sameEntity ? 'same' : 'diff'} | ${scored.lexical.toFixed(3)} ` +
					`| ${scored.embedding.toFixed(3)} | ${(scored.embedding - scored.lexical >= 0 ? '+' : '') + (scored.embedding - scored.lexical).toFixed(3)} |`
			);
		}

		const separation = (pick: (scored: ScoredPair) => number): string => {
			const same = scoredPairs.filter((scored) => scored.sameEntity).map(pick);
			const diff = scoredPairs.filter((scored) => !scored.sameEntity).map(pick);
			const mean = (values: number[]): number =>
				values.reduce((sum, value) => sum + value, 0) / values.length;
			const worstSame = Math.min(...same);
			const bestDiff = Math.max(...diff);
			return (
				`mean same ${mean(same).toFixed(3)}, mean diff ${mean(diff).toFixed(3)}, ` +
				`separation ${(mean(same) - mean(diff)).toFixed(3)}, worst true pair ${worstSame.toFixed(3)}, ` +
				`best false pair ${bestDiff.toFixed(3)}`
			);
		};
		console.log(`\nTrigram:   ${separation((scored) => scored.lexical)}`);
		console.log(`Embedding: ${separation((scored) => scored.embedding)}`);

		const lexicalBands = await bandScores(corpus, lexicalTrigramSimilarity);
		const embeddingBands = await bandScores(corpus, embeddingSimilarity);

		const shippedRows: Array<[string, BandScore]> = [
			[
				'MATCH_THRESHOLDS on trigram          ',
				shipped(lexicalBands, MATCH_THRESHOLDS, 'MATCH_THRESHOLDS')
			],
			[
				'MATCH_THRESHOLDS on embedding        ',
				shipped(embeddingBands, MATCH_THRESHOLDS, 'MATCH_THRESHOLDS')
			],
			[
				'EMBEDDING_MATCH_THRESHOLDS on embed. ',
				shipped(embeddingBands, EMBEDDING_MATCH_THRESHOLDS, 'EMBEDDING_MATCH_THRESHOLDS')
			]
		];
		console.log('\nWhat the two shipped constants cost on this corpus');
		console.log(
			'| constant | matchAbove | newBelow | matched | new | falseMerge | falseSplit | ask +/- | recall | precision | cost | cost+ask |'
		);
		console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
		for (const [name, score] of shippedRows) {
			console.log(`| ${name} ${bandRow(score, positives, negatives).slice(1)}`);
		}

		bandTable('Best ten threshold pairs, trigram scorer', lexicalBands, positives, negatives, 10);
		bandTable(
			'Best ten threshold pairs, embedding scorer',
			embeddingBands,
			positives,
			negatives,
			10
		);

		console.log(
			`\nSingle-threshold sweep (runMatchingBenchmark, false-merge weight ${FALSE_MERGE_WEIGHT}x):`
		);
		console.log(
			`  trigram   suggests ${lexicalReport.suggestedThreshold.threshold.toFixed(2)} ` +
				`(${lexicalReport.suggestedThreshold.falseMerges} false merges, ` +
				`${lexicalReport.suggestedThreshold.falseSplits} false splits, cost ` +
				`${lexicalReport.suggestedThreshold.weightedCost})`
		);
		console.log(
			`  embedding suggests ${embeddingReport.suggestedThreshold.threshold.toFixed(2)} ` +
				`(${embeddingReport.suggestedThreshold.falseMerges} false merges, ` +
				`${embeddingReport.suggestedThreshold.falseSplits} false splits, cost ` +
				`${embeddingReport.suggestedThreshold.weightedCost})`
		);

		console.log(
			`\nGateway usage of this run: ${embedCalls} embedMany call(s), ${embedTexts} text(s), ` +
				`${embedTokens} embedding token(s) as the provider counted them. Not a credit figure ` +
				`and not derived from computeCost (see the comment on embedTokens). Every threshold ` +
				`pair above is scored from the same vectors, cached inside one ` +
				`createEmbeddingSimilarity instance.`
		);

		const undecidable = scoredPairs.filter(
			(scored) => !scored.sameEntity && scored.subjectText === scored.candidateText
		);
		if (undecidable.length > 0) {
			console.log(
				`\n${undecidable.length} negative pair(s) are byte-identical as text ` +
					`(${undecidable.map((scored) => scored.id).join(', ')}): no name-based scorer of any ` +
					`kind can separate them, so they are a false merge at every threshold below 1.0 and ` +
					`they cap the precision either column can reach.`
			);
		}

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
					embeddingModel: { ...model, vectorSize },
					falseMergeWeight: FALSE_MERGE_WEIGHT,
					shippedThresholds: {
						lexical: MATCH_THRESHOLDS,
						embedding: EMBEDDING_MATCH_THRESHOLDS
					},
					askWeight: ASK_WEIGHT,
					embedCalls,
					embedTexts,
					embedTokens,
					pairs: scoredPairs,
					lexical: { report: lexicalReport, bands: lexicalBands },
					embedding: { report: embeddingReport, bands: embeddingBands }
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
