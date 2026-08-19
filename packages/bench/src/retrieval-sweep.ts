/**
 * Re-derives `packages/indexing/src/retriever.ts`'s `DEFAULT_THRESHOLD`, `DEFAULT_TOP_K`
 * and `KEYWORD_BOOST_PER_MATCH` against a real universe through the live gateway
 * (issues #168 and #278, SPEC.md §11.4: "re-run that eval before changing the embedding
 * model").
 *
 *   pnpm --filter @canonry/bench retrieval-sweep
 *   pnpm --filter @canonry/bench retrieval-sweep -- --vault=../../.data/corpus/valdris --repeats=3
 *
 * Two corpus sizes, one harness. Without `--vault` it measures the 32-chunk Valdoria Reach
 * own canon, which is what issue #168 measured and what makes that run reproducible.
 * With `--vault` it indexes a real community world as a second data source into the same
 * per-universe collection first (`index-vault.ts`), which is the mixed own-canon-plus-
 * indexed corpus of realistic size issue #168 said to revisit its top-k conclusion
 * against, and issue #278's whole subject.
 *
 * Sweeps go through `@canonry/eval`'s `runRetrievalEval` rather than a bench-local
 * reimplementation: it already reports recall at k, MRR, admitted survivors and admitted
 * noise inside the window per threshold.
 *
 * **Everything the gateway is paid for happens once.** A repeat re-embeds the eighteen
 * questions (which is what a second run of this script would do, and therefore the honest
 * unit of run-to-run jitter: this model's cosine scores move by a few thousandths between
 * identical calls, so a difference smaller than the spread across repeats is not a
 * finding). The corpus is embedded once and reused; `--collection-suffix` forces a second
 * corpus embedding into its own collection when the question is whether the corpus vectors
 * jitter too. Every sweep point is then derived from cached, unboosted hits: the hit list
 * is pulled once per question per repeat with `keywordBoostPerMatch: 0`, and each point
 * re-scores it locally with `keywordMatchCount` (the production function), so sweeping
 * seven boost values costs nothing beyond arithmetic.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity } from '@canonry/db/schema';
import { resolveModel } from '@canonry/ai';
import {
	runRetrievalEval,
	type GoldChunk,
	type GoldQuestion,
	type RetrievalCorpus,
	type RetrievalHit,
	type Retriever
} from '@canonry/eval';
import {
	chunkWikiPage,
	keywordMatchCount,
	resolveOwnCanonCollection,
	scoreLoreHits,
	DEFAULT_THRESHOLD,
	DEFAULT_TOP_K,
	KEYWORD_BOOST_PER_MATCH,
	type Embedder
} from '@canonry/indexing';
import { createVectorClient, loreCollectionNameForModel, type QdrantClient } from '@canonry/vector';
import { dataDir, loadEnv, requireEnv } from './env.js';
import { benchEmbedder } from './embedder.js';
import { benchFixture } from './fixture.js';
import { assertCreditAvailable, gatewayBalance } from './models/credits.js';
import { indexCorpus } from './index-corpus.js';
import { indexVault } from './index-vault.js';
import { seedWorld } from './corpus/seed.js';
import { worldV1 } from './corpus/valdoria-reach.js';
import { ASK_QUESTIONS, isCrossLanguageQuestion } from './corpus/gold.js';

const THRESHOLD_SWEEP = [
	0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75
];
/** Past 32, which was the whole of issue #168's corpus, because the question there was
 * whether recall kept climbing only because top-k 8 already returned a quarter of the
 * world. On a corpus of thousands, 64 sources is a number worth pricing rather than a
 * number worth shipping, and the table says which. */
const TOP_K_SWEEP = [1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64];
/** Zero (pure cosine, the state the model comparison in `models.ts` measured), the shipped
 * 0.03, and enough either side to see where the boost starts deciding the ranking rather
 * than nudging it. */
const KEYWORD_BOOST_SWEEP = [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12];

/** One number measured over several repeats. `spread` is what a reader compares two rows
 * against before calling a difference real. */
export interface Stat {
	mean: number;
	min: number;
	max: number;
	spread: number;
}

export interface ThresholdPoint {
	threshold: number;
	recallAtTopK: Stat;
	/** Hits above the threshold before the top-k cut, comparable with issue #168's
	 * "mean hits admitted" column. */
	admitted: Stat;
	/** Hits inside the top-k window that are not gold - the noise a reader actually sees. */
	irrelevantInTopK: Stat;
}

export interface TopKPoint {
	topK: number;
	mrr: Stat;
	/** Recall at k with the shipped threshold applied, which is what Ask actually returns. */
	recallAtTopK: Stat;
	/**
	 * Recall at k with no threshold at all, so the ranking's own ceiling is separable from
	 * the cutoff's. Without this column a plateau reads as "more sources do not help" when
	 * it can equally be "the remaining gold chunks score below the threshold and no k
	 * reaches them", which are opposite conclusions about which constant to move.
	 */
	recallNoThreshold: Stat;
	irrelevantInTopK: Stat;
	crossLanguageRecall: Stat;
	sameLanguageRecall: Stat;
	/** How the window splits between the universe's own canon and the indexed source. */
	ownCanonInTopK: Stat;
	indexedInTopK: Stat;
}

export interface KeywordBoostPoint {
	boostPerMatch: number;
	recallAtTopK: Stat;
	mrr: Stat;
	irrelevantInTopK: Stat;
	/** Hits that the boost pulled into the top-k window past a hit that outranked them on
	 * cosine alone. The number the boost's own risk note is about. */
	promotedIntoTopK: Stat;
	/** The largest boost any single hit received, in cosine units. */
	maxBoostApplied: Stat;
}

export interface RetrievalSweepReport {
	ranAt: string;
	embeddingModel: string;
	corpus: {
		chunks: number;
		ownCanonChunks: number;
		indexedChunks: number;
		indexedPages: number;
		vectorSize: number;
		collection: string;
	};
	questions: number;
	crossLanguageQuestions: number;
	repeats: number;
	shipped: { topK: number; threshold: number; keywordBoostPerMatch: number };
	thresholdSweep: ThresholdPoint[];
	topKSweep: TopKPoint[];
	keywordBoostSweep: KeywordBoostPoint[];
	/** Cosine separation on this corpus: gold hits against everything else, which is the
	 * scale any threshold and any boost has to be read against. */
	separation: {
		goldMedian: number;
		goldMin: number;
		otherMedian: number;
		otherP99: number;
	};
	spendUsd: number;
}

/** One cached hit: pure cosine, plus everything a sweep point needs to re-score it. */
interface CachedHit {
	chunkId: string;
	cosine: number;
	keywordMatches: number;
	ownCanon: boolean;
}

type CachedRun = Map<string, CachedHit[]>;

function stat(values: number[]): Stat {
	const min = Math.min(...values);
	const max = Math.max(...values);
	return {
		mean: values.reduce((sum, v) => sum + v, 0) / values.length,
		min,
		max,
		spread: max - min
	};
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function quantile(values: number[], q: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** Builds the eval corpus from what is actually indexed: one `GoldChunk` per own-canon
 * chunk (`chunkWikiPage`, the same chunker `indexEntity` used to write it), and one
 * `GoldQuestion` per `ASK_QUESTIONS` entry that names entities it expects to find -
 * `groundedIn` already is `relevantChunkIds` ordered best-first, since a gold chunk id
 * here is the entity slug the corpus chunks one entity into (issue #168's own caveat).
 *
 * The vault's chunks are deliberately **not** gold chunks. They are what a real universe
 * has around its own canon, and every one of them that takes a top-k slot from a gold
 * chunk is the crowding this sweep exists to measure. */
async function buildCorpus(db: Db, universeId: string): Promise<RetrievalCorpus> {
	const rows = await db
		.select({ slug: entity.slug, name: entity.name, body: entity.body })
		.from(entity)
		.where(eq(entity.universeId, universeId));

	const chunks: GoldChunk[] = [];
	for (const row of rows) {
		for (const chunk of chunkWikiPage(row.name, row.body)) {
			chunks.push({
				id: row.slug,
				entitySlug: row.slug,
				breadcrumb: chunk.breadcrumb,
				text: chunk.text
			});
		}
	}

	const questions: GoldQuestion[] = ASK_QUESTIONS.filter((q) => q.groundedIn.length > 0).map(
		(q) => ({ id: q.id, question: q.question, relevantChunkIds: q.groundedIn })
	);

	return { id: 'valdoria-reach-live', name: 'Valdoria Reach (live gateway)', chunks, questions };
}

/**
 * One embed and one unthresholded, unboosted, untruncated `scoreLoreHits` per question.
 * Everything the sweep varies afterwards - threshold, top-k, boost - is applied to this
 * cached list, so a repeat is one pass over the gateway rather than one per sweep point.
 */
async function cacheRun(deps: {
	db: Db;
	vectorClient: QdrantClient;
	universeId: string;
	collectionName: string;
	embedder: Embedder;
	idToSlug: Map<string, string>;
	ownCanonDataSourceId: string;
	candidateLimit: number;
	questions: GoldQuestion[];
}): Promise<CachedRun> {
	const cached: CachedRun = new Map();
	for (const question of deps.questions) {
		const [vector] = await deps.embedder([question.question]);
		if (!vector) throw new Error(`no query vector for ${question.id}`);
		const scored = await scoreLoreHits({
			db: deps.db,
			vectorClient: deps.vectorClient,
			collectionName: deps.collectionName,
			universeId: deps.universeId,
			queryVector: vector,
			queryText: question.question,
			candidateLimit: deps.candidateLimit,
			// Pure cosine: every boost value below is applied locally from `keywordMatches`.
			keywordBoostPerMatch: 0
		});
		cached.set(
			question.id,
			scored.map((hit) => ({
				chunkId: deps.idToSlug.get(hit.payload.url.replace('canonry://entity/', '')) ?? hit.chunkId,
				cosine: hit.score,
				keywordMatches: keywordMatchCount(question.question, hit.payload.excerptKeywords),
				ownCanon: hit.payload.dataSourceId === deps.ownCanonDataSourceId
			}))
		);
	}
	return cached;
}

function scoredHits(run: CachedRun, questionId: string, boost: number): RetrievalHit[] {
	return (run.get(questionId) ?? [])
		.map((hit) => ({ chunkId: hit.chunkId, score: hit.cosine + hit.keywordMatches * boost }))
		.sort((a, b) => b.score - a.score);
}

function retrieverOver(run: CachedRun, boost: number): Retriever {
	return (question) => scoredHits(run, question.id, boost);
}

/** Mean over questions of a per-question number, restricted to `ids` when given. */
function meanOverQuestions(
	questions: GoldQuestion[],
	ids: Set<string> | null,
	of: (question: GoldQuestion) => number
): number {
	const wanted = ids === null ? questions : questions.filter((q) => ids.has(q.id));
	if (wanted.length === 0) return 0;
	return wanted.reduce((sum, q) => sum + of(q), 0) / wanted.length;
}

function recallOf(hits: RetrievalHit[], relevant: string[], threshold: number, topK: number) {
	const window = hits.filter((hit) => hit.score >= threshold).slice(0, topK);
	const found = new Set(window.map((hit) => hit.chunkId));
	return relevant.filter((id) => found.has(id)).length / relevant.length;
}

function parseNumberArg(argv: string[], name: string): number | undefined {
	for (const arg of argv) {
		const match = new RegExp(`^--${name}=(\\d+)$`).exec(arg);
		if (match?.[1]) return Number(match[1]);
	}
	return undefined;
}

function parseStringArg(argv: string[], name: string): string | undefined {
	for (const arg of argv) {
		const prefix = `--${name}=`;
		if (arg.startsWith(prefix)) return arg.slice(prefix.length);
	}
	return undefined;
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	requireEnv('QDRANT_URL');

	const argv = process.argv.slice(2);
	// Issue #168's chunking-granularity check: `--chunk-budget=100` re-indexes into a
	// collection isolated by suffix, never the real "Own canon" one, so a one-off finer
	// chunking measurement can never leave stale points behind for the real run.
	const chunkBudget = parseNumberArg(argv, 'chunk-budget');
	const repeats = parseNumberArg(argv, 'repeats') ?? 1;
	const vaultDir = parseStringArg(argv, 'vault');
	const vaultLimit = parseNumberArg(argv, 'vault-limit');
	const collectionSuffix = parseStringArg(argv, 'collection-suffix');

	const opening = await assertCreditAvailable();
	console.log(`gateway balance ${opening.balanceUsd.toFixed(2)} USD`);
	if (chunkBudget !== undefined) {
		console.log(`chunk budget override: ${chunkBudget} tokens (isolated collection)`);
	}

	const db = createDb(url, { max: 4, quiet: true });
	try {
		const fixture = await benchFixture(db);
		const seeded = await seedWorld(db, fixture.universeId, worldV1);
		const embedding = await resolveModel(db, 'embedding');
		const ownCanon = await resolveOwnCanonCollection(db, fixture.universeId, embedding);
		const baseCollection = loreCollectionNameForModel(embedding, fixture.universeId);
		const suffix = [
			chunkBudget === undefined ? '' : `-chunk${chunkBudget}`,
			collectionSuffix === undefined ? '' : `-${collectionSuffix}`
		].join('');
		const collectionName = suffix.length === 0 ? baseCollection : `${baseCollection}${suffix}`;

		const indexed = await indexCorpus(db, fixture.universeId, {
			...(chunkBudget === undefined ? {} : { chunkTokenBudget: chunkBudget }),
			...(suffix.length === 0 ? {} : { collectionName })
		});
		let vaultChunks = 0;
		let vaultPages = 0;
		if (vaultDir !== undefined) {
			const vault = await indexVault(db, fixture.universeId, {
				dir: vaultDir,
				collectionName,
				...(vaultLimit === undefined ? {} : { limit: vaultLimit })
			});
			vaultChunks = vault.chunks;
			vaultPages = vault.pages;
			console.log(`vault: ${vault.pages} pages, ${vault.chunks} chunks into ${vault.collection}`);
		}
		const totalChunks = indexed.chunks + vaultChunks;

		const idToSlug = new Map([...seeded.idBySlug].map(([slug, id]) => [id, slug]));
		const corpus = await buildCorpus(db, fixture.universeId);
		const embedder = await benchEmbedder(db, fixture.universeId);
		const vectorClient = createVectorClient();

		const crossIds = new Set(
			ASK_QUESTIONS.filter((q) => isCrossLanguageQuestion(q, worldV1)).map((q) => q.id)
		);
		const sameIds = new Set(corpus.questions.filter((q) => !crossIds.has(q.id)).map((q) => q.id));

		const runs: CachedRun[] = [];
		for (let repeat = 0; repeat < repeats; repeat++) {
			runs.push(
				await cacheRun({
					db,
					vectorClient,
					universeId: fixture.universeId,
					collectionName,
					embedder,
					idToSlug,
					ownCanonDataSourceId: ownCanon.dataSourceId,
					candidateLimit: totalChunks,
					questions: corpus.questions
				})
			);
			console.log(`repeat ${repeat + 1}/${repeats}: ${corpus.questions.length} questions embedded`);
		}

		// --- threshold, at the shipped top-k and the shipped boost -----------------------
		const perRunThreshold = await Promise.all(
			runs.map((run) =>
				runRetrievalEval(corpus, retrieverOver(run, KEYWORD_BOOST_PER_MATCH), {
					topK: DEFAULT_TOP_K,
					threshold: DEFAULT_THRESHOLD,
					thresholdSweep: THRESHOLD_SWEEP
				})
			)
		);
		const thresholdSweep: ThresholdPoint[] = THRESHOLD_SWEEP.map((threshold) => {
			const points = perRunThreshold.map((report) =>
				report.thresholdEffect.find((effect) => effect.threshold === threshold)
			);
			return {
				threshold,
				recallAtTopK: stat(points.map((p) => p?.meanRecallAtTopK ?? 0)),
				admitted: stat(points.map((p) => p?.meanResultCount ?? 0)),
				irrelevantInTopK: stat(points.map((p) => p?.meanIrrelevantInTopK ?? 0))
			};
		});

		// --- top-k, at the shipped threshold and the shipped boost ------------------------
		const topKSweep: TopKPoint[] = [];
		for (const topK of TOP_K_SWEEP) {
			const perRun = await Promise.all(
				runs.map((run) =>
					runRetrievalEval(corpus, retrieverOver(run, KEYWORD_BOOST_PER_MATCH), {
						topK,
						threshold: DEFAULT_THRESHOLD
					})
				)
			);
			const atThreshold = perRun.map((report) =>
				report.thresholdEffect.find((effect) => effect.threshold === DEFAULT_THRESHOLD)!
			);
			const composition = runs.map((run) => {
				let own = 0;
				let indexedHits = 0;
				for (const question of corpus.questions) {
					const window = (run.get(question.id) ?? [])
						.map((hit) => ({
							...hit,
							score: hit.cosine + hit.keywordMatches * KEYWORD_BOOST_PER_MATCH
						}))
						.sort((a, b) => b.score - a.score)
						.filter((hit) => hit.score >= DEFAULT_THRESHOLD)
						.slice(0, topK);
					own += window.filter((hit) => hit.ownCanon).length;
					indexedHits += window.filter((hit) => !hit.ownCanon).length;
				}
				return {
					own: own / corpus.questions.length,
					indexed: indexedHits / corpus.questions.length
				};
			});
			const recallBy = (ids: Set<string> | null, threshold: number) =>
				runs.map((run) =>
					meanOverQuestions(corpus.questions, ids, (question) =>
						recallOf(
							scoredHits(run, question.id, KEYWORD_BOOST_PER_MATCH),
							question.relevantChunkIds,
							threshold,
							topK
						)
					)
				);
			topKSweep.push({
				topK,
				mrr: stat(perRun.map((report) => report.mrr)),
				recallAtTopK: stat(atThreshold.map((effect) => effect.meanRecallAtTopK)),
				recallNoThreshold: stat(recallBy(null, 0)),
				irrelevantInTopK: stat(atThreshold.map((effect) => effect.meanIrrelevantInTopK)),
				crossLanguageRecall: stat(recallBy(crossIds, DEFAULT_THRESHOLD)),
				sameLanguageRecall: stat(recallBy(sameIds, DEFAULT_THRESHOLD)),
				ownCanonInTopK: stat(composition.map((c) => c.own)),
				indexedInTopK: stat(composition.map((c) => c.indexed))
			});
		}

		// --- keyword boost, at the shipped top-k and threshold ----------------------------
		const keywordBoostSweep: KeywordBoostPoint[] = [];
		for (const boostPerMatch of KEYWORD_BOOST_SWEEP) {
			const perRun = await Promise.all(
				runs.map((run) =>
					runRetrievalEval(corpus, retrieverOver(run, boostPerMatch), {
						topK: DEFAULT_TOP_K,
						threshold: DEFAULT_THRESHOLD
					})
				)
			);
			const atThreshold = perRun.map((report) =>
				report.thresholdEffect.find((effect) => effect.threshold === DEFAULT_THRESHOLD)!
			);
			// A hit is promoted when the boost puts it inside the window and pure cosine did
			// not. Counted against the same threshold, so this is displacement by ranking
			// rather than by the cutoff moving.
			const promoted = runs.map((run) =>
				meanOverQuestions(corpus.questions, null, (question) => {
					const cosineWindow = new Set(
						scoredHits(run, question.id, 0)
							.filter((hit) => hit.score >= DEFAULT_THRESHOLD)
							.slice(0, DEFAULT_TOP_K)
							.map((hit) => hit.chunkId)
					);
					return scoredHits(run, question.id, boostPerMatch)
						.filter((hit) => hit.score >= DEFAULT_THRESHOLD)
						.slice(0, DEFAULT_TOP_K)
						.filter((hit) => !cosineWindow.has(hit.chunkId)).length;
				})
			);
			const maxBoost = runs.map((run) =>
				Math.max(
					...corpus.questions.flatMap((question) =>
						(run.get(question.id) ?? []).map((hit) => hit.keywordMatches * boostPerMatch)
					)
				)
			);
			keywordBoostSweep.push({
				boostPerMatch,
				recallAtTopK: stat(atThreshold.map((effect) => effect.meanRecallAtTopK)),
				mrr: stat(perRun.map((report) => report.mrr)),
				irrelevantInTopK: stat(atThreshold.map((effect) => effect.meanIrrelevantInTopK)),
				promotedIntoTopK: stat(promoted),
				maxBoostApplied: stat(maxBoost)
			});
		}

		// --- the cosine scale every number above has to be read against -------------------
		const goldScores: number[] = [];
		const otherScores: number[] = [];
		for (const question of corpus.questions) {
			const relevant = new Set(question.relevantChunkIds);
			for (const hit of runs[0]?.get(question.id) ?? []) {
				(relevant.has(hit.chunkId) ? goldScores : otherScores).push(hit.cosine);
			}
		}

		const closing = await gatewayBalance();
		const report: RetrievalSweepReport = {
			ranAt: new Date().toISOString(),
			embeddingModel: `${embedding.provider}/${embedding.modelId}`,
			corpus: {
				chunks: totalChunks,
				ownCanonChunks: indexed.chunks,
				indexedChunks: vaultChunks,
				indexedPages: vaultPages,
				vectorSize: indexed.vectorSize,
				collection: collectionName
			},
			questions: corpus.questions.length,
			crossLanguageQuestions: corpus.questions.filter((q) => crossIds.has(q.id)).length,
			repeats,
			shipped: {
				topK: DEFAULT_TOP_K,
				threshold: DEFAULT_THRESHOLD,
				keywordBoostPerMatch: KEYWORD_BOOST_PER_MATCH
			},
			thresholdSweep,
			topKSweep,
			keywordBoostSweep,
			separation: {
				goldMedian: median(goldScores),
				goldMin: goldScores.length === 0 ? 0 : Math.min(...goldScores),
				otherMedian: median(otherScores),
				otherP99: quantile(otherScores, 0.99)
			},
			spendUsd: Number((opening.balanceUsd - closing.balanceUsd).toFixed(6))
		};

		const reportName = [
			'retrieval-sweep',
			vaultDir === undefined ? '' : '-scale',
			chunkBudget === undefined ? '' : `-chunk${chunkBudget}`,
			collectionSuffix === undefined ? '' : `-${collectionSuffix}`,
			'.json'
		].join('');
		mkdirSync(dataDir, { recursive: true });
		const file = path.join(dataDir, reportName);
		writeFileSync(file, JSON.stringify(report, null, '\t'));

		console.log(
			`\n${totalChunks} chunks (${indexed.chunks} own canon, ${vaultChunks} indexed), ` +
				`${indexed.vectorSize} dims, ${report.embeddingModel}, ${repeats} repeat(s)`
		);
		console.log(
			`gold cosine median ${report.separation.goldMedian.toFixed(4)} (min ${report.separation.goldMin.toFixed(4)}), ` +
				`other median ${report.separation.otherMedian.toFixed(4)} (p99 ${report.separation.otherP99.toFixed(4)})`
		);
		console.log(`\nthreshold at top-k ${DEFAULT_TOP_K}, boost ${KEYWORD_BOOST_PER_MATCH}:`);
		for (const point of thresholdSweep) {
			console.log(
				`  ${point.threshold.toFixed(2)}  recall ${point.recallAtTopK.mean.toFixed(3)} ` +
					`(spread ${point.recallAtTopK.spread.toFixed(3)})  admitted ${point.admitted.mean.toFixed(2)}  ` +
					`noise@k ${point.irrelevantInTopK.mean.toFixed(2)}`
			);
		}
		console.log(`\ntop-k at threshold ${DEFAULT_THRESHOLD}:`);
		for (const point of topKSweep) {
			console.log(
				`  k=${point.topK.toString().padStart(2)}  mrr ${point.mrr.mean.toFixed(3)}  ` +
					`recall ${point.recallAtTopK.mean.toFixed(3)} (spread ${point.recallAtTopK.spread.toFixed(3)})  ` +
					`raw ${point.recallNoThreshold.mean.toFixed(3)}  ` +
					`cross ${point.crossLanguageRecall.mean.toFixed(3)}  same ${point.sameLanguageRecall.mean.toFixed(3)}  ` +
					`own ${point.ownCanonInTopK.mean.toFixed(2)}  indexed ${point.indexedInTopK.mean.toFixed(2)}`
			);
		}
		console.log(`\nkeyword boost at top-k ${DEFAULT_TOP_K}, threshold ${DEFAULT_THRESHOLD}:`);
		for (const point of keywordBoostSweep) {
			console.log(
				`  ${point.boostPerMatch.toFixed(3)}  recall ${point.recallAtTopK.mean.toFixed(3)}  ` +
					`mrr ${point.mrr.mean.toFixed(3)}  noise@k ${point.irrelevantInTopK.mean.toFixed(2)}  ` +
					`promoted ${point.promotedIntoTopK.mean.toFixed(2)}  max boost ${point.maxBoostApplied.mean.toFixed(3)}`
			);
		}
		console.log(`\nspent ${report.spendUsd.toFixed(4)} USD`);
		console.log(`written to ${file}`);
	} finally {
		await closeDb(db);
	}
}

await main();
