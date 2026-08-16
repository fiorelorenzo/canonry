/**
 * Re-derives `packages/indexing/src/retriever.ts`'s `DEFAULT_THRESHOLD` and
 * `DEFAULT_TOP_K` against Valdoria Reach through the live gateway (issue #168, step 2 of
 * 3, SPEC.md §11.4: "re-run that eval before changing the embedding model").
 *
 *   pnpm --filter @canonry/bench retrieval-sweep
 *
 * Sweeps both knobs through `@canonry/eval`'s `runRetrievalEval` rather than a bench-local
 * reimplementation of that sweep - the harness already reports `meanRecallAtTopK` and
 * `meanResultCount` per threshold, and MRR and recall-at-k per top-k. This file's only job
 * is to wire that harness to real data: the corpus seeded and indexed through the product's
 * own `indexEntity` path (`index-corpus.ts`), and a `Retriever` backed by real Qdrant
 * (`scoreLoreHits`, unthresholded and untruncated) and a real embedded query per gold
 * question (`ASK_QUESTIONS`, `corpus/gold.ts`).
 *
 * Retrieval-only: no Ask, no propagate, no audit, no premium model calls. Every raw hit
 * list is fetched once per question and cached, so sweeping ten thresholds and six top-k
 * values costs the same eighteen embedding calls the plain `loremaster-e2e` retrieval
 * section costs, not eighteen times the sweep width.
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
	type RetrievalReport,
	type Retriever
} from '@canonry/eval';
import { chunkWikiPage, scoreLoreHits, type Embedder } from '@canonry/indexing';
import { createVectorClient, loreCollectionNameForModel, type QdrantClient } from '@canonry/vector';
import { dataDir, loadEnv, requireEnv } from './env.js';
import { benchEmbedder } from './embedder.js';
import { benchFixture } from './fixture.js';
import { assertCreditAvailable } from './models/credits.js';
import { indexCorpus } from './index-corpus.js';
import { seedWorld } from './corpus/seed.js';
import { worldV1 } from './corpus/valdoria-reach.js';
import { ASK_QUESTIONS } from './corpus/gold.js';

/** `retriever.ts`'s current constants, so the sweep always reports where they sit. */
const CURRENT_THRESHOLD = 0.25;
const CURRENT_TOP_K = 8;

const THRESHOLD_SWEEP = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65];
/** Up to the whole 32-chunk corpus: issue #168's own caveat is that top-k 8 of 32 hands
 * back a quarter of the world, so the sweep has to go past 8 to say whether that matters. */
const TOP_K_SWEEP = [1, 2, 4, 6, 8, 12, 16, 24, 32];

export interface TopKPoint {
	topK: number;
	mrr: number;
	recallAtTopK: number;
	meanResultCount: number;
}

export interface RetrievalSweepReport {
	ranAt: string;
	embeddingModel: string;
	chunks: number;
	vectorSize: number;
	questions: number;
	/** Threshold swept at `CURRENT_TOP_K`. */
	thresholdSweep: RetrievalReport;
	/** Top-k swept at `CURRENT_THRESHOLD`, one `runRetrievalEval` call per value. */
	topKSweep: TopKPoint[];
}

/** Builds the eval corpus from what is actually indexed: one `GoldChunk` per real chunk
 * (`chunkWikiPage`, the same chunker `indexEntity` used to write it), and one
 * `GoldQuestion` per `ASK_QUESTIONS` entry that names entities it expects to find -
 * `groundedIn` already is `relevantChunkIds` ordered best-first, since a chunk id here is
 * just the entity slug the corpus chunks one entity into (issue #168's own caveat). */
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

/** One embed plus one unthresholded, untruncated `scoreLoreHits` call per question,
 * cached by question id - every `runRetrievalEval` call below only varies `topK` or
 * `threshold`, runner parameters applied to the same raw hits, never a reason to re-query. */
function makeLiveRetriever(deps: {
	db: Db;
	vectorClient: QdrantClient;
	universeId: string;
	collectionName: string;
	embedder: Embedder;
	idToSlug: Map<string, string>;
	candidateLimit: number;
}): Retriever {
	const cache = new Map<string, RetrievalHit[]>();
	return async (question) => {
		const cached = cache.get(question.id);
		if (cached) return cached;
		const [vector] = await deps.embedder([question.question]);
		if (!vector) throw new Error(`no query vector for ${question.id}`);
		const scored = await scoreLoreHits({
			db: deps.db,
			vectorClient: deps.vectorClient,
			collectionName: deps.collectionName,
			universeId: deps.universeId,
			queryVector: vector,
			queryText: question.question,
			candidateLimit: deps.candidateLimit
		});
		const hits: RetrievalHit[] = scored.map((hit) => ({
			chunkId:
				deps.idToSlug.get(hit.payload.url.replace('canonry://entity/', '')) ?? hit.payload.url,
			score: hit.score
		}));
		cache.set(question.id, hits);
		return hits;
	};
}

function parseChunkBudget(argv: string[]): number | undefined {
	for (const arg of argv) {
		const match = /^--chunk-budget=(\d+)$/.exec(arg);
		if (match?.[1]) return Number(match[1]);
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

	// Issue #168's chunking-granularity check: `--chunk-budget=100` re-indexes into a
	// collection isolated by suffix, never the real "Own canon" one, so a one-off finer
	// chunking measurement can never leave stale points behind for the real run.
	const chunkBudget = parseChunkBudget(process.argv.slice(2));

	const balance = await assertCreditAvailable();
	console.log(`gateway balance ${balance.balanceUsd.toFixed(2)} USD`);
	if (chunkBudget !== undefined) {
		console.log(`chunk budget override: ${chunkBudget} tokens (isolated collection)`);
	}

	const db = createDb(url, { max: 4, quiet: true });
	try {
		const fixture = await benchFixture(db);
		const seeded = await seedWorld(db, fixture.universeId, worldV1);
		const embedding = await resolveModel(db, 'embedding');
		const indexed = await indexCorpus(db, fixture.universeId, {
			...(chunkBudget === undefined ? {} : { chunkTokenBudget: chunkBudget }),
			...(chunkBudget === undefined
				? {}
				: {
						collectionName: `${loreCollectionNameForModel(embedding, fixture.universeId)}-chunk${chunkBudget}`
					})
		});
		const idToSlug = new Map([...seeded.idBySlug].map(([slug, id]) => [id, slug]));

		const corpus = await buildCorpus(db, fixture.universeId);
		const embedder = await benchEmbedder(db, fixture.universeId);
		const vectorClient = createVectorClient();
		const retriever = makeLiveRetriever({
			db,
			vectorClient,
			universeId: fixture.universeId,
			collectionName: indexed.collection,
			embedder,
			idToSlug,
			candidateLimit: indexed.chunks
		});

		const thresholdSweep = await runRetrievalEval(corpus, retriever, {
			topK: CURRENT_TOP_K,
			threshold: CURRENT_THRESHOLD,
			thresholdSweep: THRESHOLD_SWEEP
		});

		const topKSweep: TopKPoint[] = [];
		for (const topK of TOP_K_SWEEP) {
			const report = await runRetrievalEval(corpus, retriever, {
				topK,
				threshold: CURRENT_THRESHOLD
			});
			const atCurrentThreshold = report.thresholdEffect.find(
				(effect) => effect.threshold === CURRENT_THRESHOLD
			);
			topKSweep.push({
				topK,
				mrr: report.mrr,
				recallAtTopK: atCurrentThreshold?.meanRecallAtTopK ?? 0,
				meanResultCount: atCurrentThreshold?.meanResultCount ?? 0
			});
		}

		const report: RetrievalSweepReport = {
			ranAt: new Date().toISOString(),
			embeddingModel: `${embedding.provider}/${embedding.modelId}`,
			chunks: indexed.chunks,
			vectorSize: indexed.vectorSize,
			questions: corpus.questions.length,
			thresholdSweep,
			topKSweep
		};

		const reportName =
			chunkBudget === undefined
				? 'retrieval-sweep.json'
				: `retrieval-sweep-chunk${chunkBudget}.json`;

		mkdirSync(dataDir, { recursive: true });
		const file = path.join(dataDir, reportName);
		writeFileSync(file, JSON.stringify(report, null, '\t'));

		console.log(
			`${indexed.chunks} chunks, ${indexed.vectorSize} dims, ${embedding.provider}/${embedding.modelId}`
		);
		console.log(`\nthreshold sweep at top-k ${CURRENT_TOP_K}:`);
		for (const effect of thresholdSweep.thresholdEffect) {
			console.log(
				`  ${effect.threshold.toFixed(2)}  recall@${CURRENT_TOP_K} ${effect.meanRecallAtTopK.toFixed(3)}  mean hits ${effect.meanResultCount.toFixed(2)}`
			);
		}
		console.log(`\ntop-k sweep at threshold ${CURRENT_THRESHOLD}:`);
		for (const point of topKSweep) {
			console.log(
				`  k=${point.topK.toString().padStart(2)}  mrr ${point.mrr.toFixed(3)}  recall@k ${point.recallAtTopK.toFixed(3)}  mean hits ${point.meanResultCount.toFixed(2)}`
			);
		}
		console.log(`\nwritten to ${file}`);
	} finally {
		await closeDb(db);
	}
}

await main();
