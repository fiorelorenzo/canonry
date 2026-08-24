/**
 * Runs `@canonry/copilot`'s relation-label gold set (issue #637) against the real gateway
 * embedding model production resolves relation labels with, and reports what the corpus
 * implies about `SEMANTIC_REUSE_THRESHOLD`. The sibling of `matching-sweep.ts`, one rung
 * over.
 *
 *   pnpm --filter @canonry/bench relation-label-sweep -- --runs=5
 *   pnpm --filter @canonry/bench relation-label-sweep -- --runs=5 --raw-label
 *
 * It reports and it changes nothing. #629 measured the shape of this rung's curve on the
 * real notebook and declined to move the threshold because there were no labelled pairs to
 * compute a precision against; the pairs now exist, and a threshold change is still its own
 * argument in its own issue, made from these numbers rather than bundled with them.
 *
 * The subject it embeds is `normalizeRelationLabel`'s output on both sides, which is what
 * `bestSemanticMatch` compares since #690, so the default table is production's.
 * **`--raw-label` reproduces the pre-#690 subject**, the string a model wrote, which is the
 * comparison #690 was decided on: same corpus, same model, same classification, one substitution
 * on the way into `embedMany`, and a separate output file so the two runs can be diffed.
 *
 * ### Runs, because one run sets a threshold by noise
 *
 * #279's most useful finding on the entity side was that two sweeps of the same corpus
 * against the same model scored one pair 0.802 and 0.799, either side of a cutoff that one
 * run had made look obvious. Short labels are the worse case for this, not the better one: a
 * one-word label carries fewer tokens for anything to average over. So this scores the whole
 * corpus `--runs` times, reports each pair's mean and observed spread, and **refuses to
 * recommend a threshold any pair's jitter could push across**, separately from the cheapest
 * one.
 *
 * ### Two departures from this package's usual rules, both the same as `matching-sweep`'s
 *
 * **It writes no rows, so it carries no `_bench`/`_e2e` database guard.** It reads
 * `model_config`'s `embedding` row and nothing else, so the guard would forbid pointing it
 * at a database it cannot harm.
 *
 * **It calls `embedMany` directly rather than through `createGatewayEmbedder`**, which wraps
 * every call in `withUsage` and writes a `model_call` row against a real user id. A
 * threshold sweep has no user to attribute embeddings to, and inventing one would put fake
 * rows in the table `SPEC.md` §14's cost metrics read. Underneath it is the same `embedMany`
 * against the same gateway-routed model, and everything above it (the
 * `relationTypeMatchCandidates` expansion, the max over the expanded set, the three-way
 * classification) is `runRelationLabelBenchmark`'s rather than reimplemented here: this file
 * measures cosines and hands them over.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { embedMany } from 'ai';
import { closeDb, createDb } from '@canonry/db';
import { createEmbeddingModel, readGatewayCredentials, resolveModel } from '@canonry/ai';
import { embeddingDimensionsFor } from '@canonry/indexing';
import { normalizeRelationLabel } from '@canonry/lang';
import {
	ONENOTE_RELATION_LABEL_CORPUS,
	relationLabelCandidates,
	runRelationLabelBenchmark,
	SEMANTIC_REUSE_THRESHOLD,
	type RelationLabelPairExample,
	type RelationLabelThresholdScore
} from '@canonry/copilot';
import { cosineSimilarity } from '@canonry/import';
import { dataDir, loadEnv, requireEnv } from './env.js';

/** Five rather than two: two runs can only report the distance between two samples, and the
 * question is how wide the jitter is, which needs enough samples that a third does not move
 * it. One `embedMany` call per run over fewer than a hundred short strings, so the default
 * costs a few thousand embedding tokens for the whole exercise. */
const DEFAULT_RUNS = 5;

/** The floor under an observed spread when a threshold is checked for fragility. #279
 * measured this model returning cosines that move by about 0.003 between calls on identical
 * input, so a threshold is never trusted closer than this to a score even when every sample
 * agreed. */
const JITTER_FLOOR = 0.01;

interface PairMeasurement {
	pair: RelationLabelPairExample;
	/** Mean over the runs of the best score across the type's expanded label set - the same
	 * number `runRelationLabelBenchmark` classifies, since it is handed the same means. */
	mean: number;
	/** Max minus min of that best score over the runs. */
	spread: number;
	matchedLabel: string;
	direction: 'forward' | 'inverse';
}

function parseRuns(argv: string[]): number {
	for (const arg of argv) {
		const match = /^--runs=(\d+)$/.exec(arg);
		if (!match) continue;
		const runs = Number(match[1]);
		if (runs > 0) return runs;
	}
	return DEFAULT_RUNS;
}

/** One cell of the pairwise cosine table, keyed on the two strings that produced it. NUL is
 * not a character a relation label can contain, so this cannot collide. */
function cellKey(proposedLabel: string, catalogueLabel: string): string {
	return `${proposedLabel}\u0000${catalogueLabel}`;
}

function sweepRow(score: RelationLabelThresholdScore, positives: number): string {
	const merged = positives - score.falseSplits;
	const precision = merged + score.falseMerges === 0 ? 0 : merged / (merged + score.falseMerges);
	return (
		`| ${score.threshold.toFixed(2)} | ${score.falseMerges} | ${score.directionErrors} | ` +
		`${score.falseSplits} | ${merged}/${positives} | ${precision.toFixed(3)} | ` +
		`${score.weightedCost} |`
	);
}

const SWEEP_HEADER =
	'| threshold | fMerge | dirErr | fSplit | merged | precision | cost |\n| --- | --- | --- | --- | --- | --- | --- |';

async function main(): Promise<void> {
	loadEnv();
	requireEnv('AI_GATEWAY_API_KEY');
	const databaseUrl = requireEnv('DATABASE_URL');
	const runs = parseRuns(process.argv.slice(2));
	/**
	 * Issue #690: `bestSemanticMatch` embeds `normalizeRelationLabel`'s output on both sides, so
	 * that is what this sweep embeds too and the default table is the shipped rung's. Rung 1 and
	 * `packages/db`'s vocabulary dedupe key compare normalised labels, and while this rung
	 * compared raw ones two labels rung 1 called one question could get two rung-2 answers.
	 * `--raw-label` puts that subject back, which is how the two tables in that function's own
	 * comment were produced.
	 */
	const rawLabel = process.argv.includes('--raw-label');
	const corpus = ONENOTE_RELATION_LABEL_CORPUS;

	const db = createDb(databaseUrl);
	try {
		const model = await resolveModel(db, 'embedding');
		const dimensions = embeddingDimensionsFor(model.provider, model.modelId);
		const embeddingModel = createEmbeddingModel(
			model.provider,
			model.modelId,
			readGatewayCredentials(process.env)
		);

		// Every distinct string the corpus needs, once per run: the proposed labels plus every
		// label of every type they are scored against. Fewer than a hundred short texts, so one
		// `embedMany` call per run. On the default subject the set is smaller than the corpus's
		// label count, because that is the point: two labels rung 1 calls one string are one text
		// here too, and the cosine table below is still keyed on the raw pair so the runner
		// classifies the same rows either way.
		const embeddedText = (label: string): string =>
			rawLabel ? label : normalizeRelationLabel(label);
		const texts = new Set<string>();
		for (const pair of corpus.pairs) {
			texts.add(embeddedText(pair.proposedLabel));
			for (const candidate of relationLabelCandidates(pair.catalogueKey)) {
				texts.add(embeddedText(candidate.label));
			}
		}
		const ordered = [...texts];

		let embedCalls = 0;
		let embedTokens = 0;
		const samplesByCell = new Map<string, number[]>();
		// Per run, per pair, the best score across the pair's expanded set - the sample the
		// spread is computed from. The mean is taken per cell rather than per pair, so the
		// benchmark below sees a whole cosine table and does its own max over it.
		const bestPerRun = new Map<string, number[]>();
		for (let run = 0; run < runs; run++) {
			const result = await embedMany({ model: embeddingModel, values: ordered });
			embedCalls += 1;
			embedTokens += result.usage.tokens ?? 0;
			const vectors = new Map<string, number[]>();
			for (const [index, text] of ordered.entries()) {
				const vector = result.embeddings[index];
				if (vector) vectors.set(text, vector);
			}
			for (const pair of corpus.pairs) {
				const subject = vectors.get(embeddedText(pair.proposedLabel)) ?? [];
				let best = Number.NEGATIVE_INFINITY;
				for (const candidate of relationLabelCandidates(pair.catalogueKey)) {
					const score = cosineSimilarity(subject, vectors.get(embeddedText(candidate.label)) ?? []);
					const key = cellKey(pair.proposedLabel, candidate.label);
					const cell = samplesByCell.get(key);
					if (cell) cell.push(score);
					else samplesByCell.set(key, [score]);
					if (score > best) best = score;
				}
				const bests = bestPerRun.get(pair.id);
				if (bests) bests.push(best);
				else bestPerRun.set(pair.id, [best]);
			}
		}

		const meanByCell = new Map<string, number>();
		for (const [key, samples] of samplesByCell) {
			meanByCell.set(key, samples.reduce((sum, value) => sum + value, 0) / samples.length);
		}

		// Replay the measured means rather than embedding again, so the runner classifies
		// exactly the numbers this report prints, and so the max and the direction come out of
		// the runner rather than out of this file.
		const report = await runRelationLabelBenchmark(
			corpus,
			(proposedLabel, catalogueLabel) => meanByCell.get(cellKey(proposedLabel, catalogueLabel)) ?? 0
		);

		const measurements: PairMeasurement[] = report.pairScores.map((scored) => {
			const bests = bestPerRun.get(scored.pair.id) ?? [scored.similarity];
			return {
				pair: scored.pair,
				mean: scored.similarity,
				spread: Math.max(...bests) - Math.min(...bests),
				matchedLabel: scored.matchedLabel,
				direction: scored.direction
			};
		});

		const positives = corpus.pairs.filter((pair) => pair.verdict !== 'distinct').length;
		const rungTwoPositives = corpus.pairs.filter(
			(pair) => !pair.rungOne && pair.verdict !== 'distinct'
		).length;

		console.log(
			`Relation-label sweep: ${corpus.name}\n` +
				`${corpus.pairs.length} labelled pairs (${positives} same or inverse, ` +
				`${corpus.pairs.length - positives} distinct), ` +
				`${report.rungTwoOnly.pairCount} of them past rung 1, ${runs} run(s)`
		);
		console.log(`Embedding model: ${model.provider}/${model.modelId}, ${dimensions} dimensions`);
		console.log(
			`Subject embedded: ${rawLabel ? 'the raw label, both sides (the pre-#690 rung)' : 'normalizeRelationLabel(label), both sides (shipped)'}` +
				`, ${ordered.length} distinct texts`
		);
		console.log(
			`Weights: false merge ${report.falseMergeWeight}x, direction error ` +
				`${report.directionErrorWeight}x, false split 1x. Shipped threshold ` +
				`${SEMANTIC_REUSE_THRESHOLD}`
		);

		console.log('\nPer-pair mean over the runs, highest first');
		console.log(
			'| pair | proposed label | key | truth | rung1 | mean | spread | won on | direction |'
		);
		console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
		for (const entry of [...measurements].sort((a, b) => b.mean - a.mean)) {
			console.log(
				`| ${entry.pair.id} | ${entry.pair.proposedLabel} | ${entry.pair.catalogueKey} | ` +
					`${entry.pair.verdict} | ${entry.pair.rungOne ? 'yes' : 'no'} | ` +
					`${entry.mean.toFixed(4)} | ${entry.spread.toFixed(4)} | ${entry.matchedLabel} | ` +
					`${entry.direction} |`
			);
		}

		console.log('\nWhole corpus');
		console.log(SWEEP_HEADER);
		for (const score of report.whole.scores) console.log(sweepRow(score, positives));

		console.log('\nRung-2-only subset (the pairs rung 1 does not already resolve)');
		console.log(SWEEP_HEADER);
		for (const score of report.rungTwoOnly.scores) console.log(sweepRow(score, rungTwoPositives));

		const shippedRow = report.rungTwoOnly.scores.find(
			(score) => Math.abs(score.threshold - SEMANTIC_REUSE_THRESHOLD) < 1e-9
		);
		if (shippedRow) {
			console.log(
				`\nShipped ${SEMANTIC_REUSE_THRESHOLD} on the rung-2 subset: ` +
					`${shippedRow.falseMerges} false merges, ${shippedRow.directionErrors} direction ` +
					`errors, ${shippedRow.falseSplits} false splits of ${rungTwoPositives} true pairs, ` +
					`weighted cost ${shippedRow.weightedCost}`
			);
			if (shippedRow.falseMergeIds.length > 0) {
				console.log(`  false merges: ${shippedRow.falseMergeIds.join(', ')}`);
			}
			if (shippedRow.directionErrorIds.length > 0) {
				console.log(`  direction errors: ${shippedRow.directionErrorIds.join(', ')}`);
			}
		}

		// Fragile means a pair's own jitter could move it across the threshold, so the row's
		// classification is a property of which afternoon it ran rather than of the model.
		const fragileAt = (threshold: number): RelationLabelPairExample[] =>
			measurements
				.filter((entry) => Math.abs(entry.mean - threshold) < Math.max(entry.spread, JITTER_FLOOR))
				.map((entry) => entry.pair);
		const robust = report.rungTwoOnly.scores
			.filter((score) => fragileAt(score.threshold).length === 0)
			.sort((a, b) => a.weightedCost - b.weightedCost || b.threshold - a.threshold)[0];
		const cheapest = report.rungTwoOnly.suggestedThreshold;

		console.log(
			`\nCheapest threshold on the rung-2 subset (measured, not chosen): ` +
				`${cheapest.threshold.toFixed(2)}, cost ${cheapest.weightedCost}, ` +
				`${fragileAt(cheapest.threshold).length} pair(s) whose jitter straddles it`
		);
		console.log(
			robust
				? `Cheapest threshold no pair's jitter can cross: ${robust.threshold.toFixed(2)}, cost ` +
						`${robust.weightedCost} (${robust.falseMerges} false merges, ` +
						`${robust.directionErrors} direction errors, ${robust.falseSplits} false splits)`
				: "No swept threshold is clear of every pair's jitter, so this corpus recommends none"
		);
		console.log(
			`\nCost: ${embedCalls} embedding call(s) of ${ordered.length} texts, ` +
				`${embedTokens} embedding tokens total, at zero credits (reading is free).`
		);

		mkdirSync(dataDir, { recursive: true });
		// Two files rather than one, so the raw and normalised runs can be diffed rather than
		// overwriting each other: comparing them is the whole of #690.
		const out = path.join(
			dataDir,
			rawLabel ? 'relation-label-sweep.raw-label.json' : 'relation-label-sweep.json'
		);
		writeFileSync(
			out,
			JSON.stringify(
				{
					corpusId: corpus.id,
					model: `${model.provider}/${model.modelId}`,
					dimensions,
					normalizedSubject: !rawLabel,
					runs,
					shippedThreshold: SEMANTIC_REUSE_THRESHOLD,
					weights: {
						falseMerge: report.falseMergeWeight,
						directionError: report.directionErrorWeight
					},
					embedCalls,
					embedTexts: embedCalls * ordered.length,
					embedTokens,
					measurements: measurements.map((entry) => ({
						id: entry.pair.id,
						proposedLabel: entry.pair.proposedLabel,
						catalogueKey: entry.pair.catalogueKey,
						verdict: entry.pair.verdict,
						rungOne: entry.pair.rungOne,
						mean: entry.mean,
						spread: entry.spread,
						matchedLabel: entry.matchedLabel,
						direction: entry.direction
					})),
					whole: report.whole,
					rungTwoOnly: report.rungTwoOnly,
					robustThreshold: robust?.threshold ?? null
				},
				null,
				2
			),
			'utf8'
		);
		console.log(`\nWrote ${out}`);
	} finally {
		await closeDb(db);
	}
}

await main();
