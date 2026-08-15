/**
 * Wires this package's real retrieval path (Qdrant storage, `scoreLoreHits`'s keyword
 * boost, issue #62's exclusion filter) into `packages/eval`'s retrieval harness (SPEC.md
 * §11.4), so top-k/threshold/keyword-boost are a measurement against a real gold corpus
 * rather than an argument. Uses `hashingEmbedder` (no network dependency, see
 * embedding.ts) since this box has no AI Gateway credentials to call a real embedding
 * model with - the harness numbers below are what that local vectoriser scores, not a
 * claim about the production embedding model's MRR.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	runRetrievalEval,
	valdoriaReachRetrieval,
	type GoldQuestion,
	type RetrievalCorpus,
	type RetrievalHit,
	type Retriever
} from '@canonry/eval';
import {
	collectionExists,
	createVectorClient,
	dropCollection,
	ensureCollection,
	queryLore,
	upsertLoreChunks,
	type LoreChunk,
	type QdrantClient
} from '@canonry/vector';
import { hashingEmbedder } from './embedding.js';
import { detectLanguage } from '@canonry/lang';

const HASH_VECTOR_SIZE = 256;
const TEST_UNIVERSE_ID = 'eval-universe';
const TEST_DATA_SOURCE_ID = 'eval-source';

let client: QdrantClient;
let collectionName: string;

async function seedCorpus(corpus: RetrievalCorpus): Promise<void> {
	const vectors = await hashingEmbedder(corpus.chunks.map((chunk) => chunk.text));
	const loreChunks: LoreChunk[] = corpus.chunks.map((chunk, i) => ({
		id: randomUUID(),
		vector: vectors[i]!,
		payload: {
			text: chunk.text,
			breadcrumb: chunk.breadcrumb,
			pageTitle: chunk.entitySlug,
			// The gold corpus has no real url; its chunk id is round-tripped through this
			// field so the retriever can map a Qdrant hit back to the corpus's own id.
			url: chunk.id,
			pageUpdatedAt: '2026-01-01T00:00:00.000Z',
			indexedAt: '2026-01-01T00:00:00.000Z',
			universeId: TEST_UNIVERSE_ID,
			dataSourceId: TEST_DATA_SOURCE_ID,
			sectionSummary: chunk.text.slice(0, 120),
			questionsThisExcerptCanAnswer: [],
			excerptKeywords: chunk.keywords ?? [],
			language: detectLanguage(chunk.text)
		}
	}));
	await upsertLoreChunks(client, collectionName, loreChunks);
}

const qdrantRetriever: Retriever = async (question: GoldQuestion): Promise<RetrievalHit[]> => {
	const [vector] = await hashingEmbedder([question.question]);
	const hits = await queryLore(client, collectionName, {
		vector: vector!,
		universeId: TEST_UNIVERSE_ID,
		limit: 200
	});
	return hits.map((hit) => ({ chunkId: hit.payload.url, score: hit.score }));
};

describe("packages/indexing retriever wired into packages/eval's retrieval harness (SPEC.md §11.4)", () => {
	beforeAll(async () => {
		client = createVectorClient();
		collectionName = `eval-retriever-${randomUUID()}`;
		await ensureCollection(client, {
			name: collectionName,
			vectorSize: HASH_VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await seedCorpus(valdoriaReachRetrieval);
	});

	afterAll(async () => {
		if (await collectionExists(client, collectionName))
			await dropCollection(client, collectionName);
	});

	it('scores above a never-hit baseline on the Valdoria Reach gold corpus, at the SPEC.md §11.4 defaults', async () => {
		const report = await runRetrievalEval(valdoriaReachRetrieval, qdrantRetriever, {
			topK: 8,
			threshold: 0.5,
			thresholdSweep: [0, 0.1, 0.25, 0.5, 0.75]
		});

		console.log(
			'[retrieval-eval] top-k=%d threshold=%s MRR=%s recallAtK=%o thresholdEffect=%o',
			report.topK,
			report.threshold,
			report.mrr.toFixed(3),
			report.recallAtK,
			report.thresholdEffect.map((e) => ({
				threshold: e.threshold,
				meanRecallAtTopK: Number(e.meanRecallAtTopK.toFixed(3)),
				meanResultCount: Number(e.meanResultCount.toFixed(2))
			}))
		);

		expect(report.mrr).toBeGreaterThan(0);
		expect(report.recallAtK[report.topK]).toBeGreaterThan(0);
	});
});
