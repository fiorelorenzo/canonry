/**
 * Issue #125 (SPEC.md §17: "an Italian question against an English canon must find the
 * English chunk... which makes the embedding model a multilingual choice rather than a
 * free one, and makes cross-lingual retrieval a test rather than a hope").
 *
 * Two things this file proves, against real Qdrant:
 *
 *  1. Today's only network-free embedding mechanism (`hashingEmbedder`, a literal
 *     bag-of-words vectoriser - see embedding.ts) cannot cross the language boundary. It
 *     is measured here, not assumed: `@canonry/eval`'s real Valdoria Reach retrieval
 *     corpus (issue #122's bilingual fixture additions - `la-casa-dei-mercanti`, an
 *     Italian faction, and `smugglers-ledger`, deliberately mixed EN/IT) runs through the
 *     real retrieval harness in both directions (Italian query against English content,
 *     English query against Italian content) and the actual MRR/rank numbers are
 *     asserted and logged, next to a same-language baseline that proves the harness and
 *     the corpus are not simply broken. This is real canon, not a corpus this file wrote
 *     for itself - the numbers below mean something to the eval harness rather than to a
 *     string invented for this test. This box has no AI Gateway credentials (see
 *     models.ts's own doc comment), so a real multilingual embedding model cannot be
 *     exercised here - see that file, and this suite's own header, for what a live
 *     credential would still need to confirm.
 *
 *  2. `LoreChunkPayload.language` (packages/vector/src/lore.ts) is metadata for a future
 *     ranking signal, never a filter: a query in one language must still return chunks
 *     written in the other. Proven at the production entry point (`scoreLoreHits`), not
 *     just at the payload layer (packages/vector/src/lore.test.ts already covers that).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, type Db } from '@canonry/db';
import { user, universe } from '@canonry/db/schema';
import {
	createVectorClient,
	dropCollection,
	ensureCollection,
	queryLore,
	upsertLoreChunks,
	type LoreChunk,
	type QdrantClient
} from '@canonry/vector';
import {
	runRetrievalEval,
	valdoriaReachRetrieval,
	type GoldQuestion,
	type RetrievalCorpus,
	type RetrievalHit,
	type Retriever
} from '@canonry/eval';
import { detectLanguage } from '@canonry/lang';
import { hashingEmbedder } from './embedding.js';
import { scoreLoreHits } from './retriever.js';
import { openTestDb } from './test-db.js';

const HASH_VECTOR_SIZE = 256;

async function insertUniverseWithOwner(db: Db) {
	const [owner] = await db
		.insert(user)
		.values({
			id: randomUUID(),
			name: 'Test Owner',
			email: `${randomUUID()}@canonry.invalid`,
			emailVerified: true
		})
		.returning();
	const [row] = await db
		.insert(universe)
		.values({ ownerUserId: owner!.id, name: 'Test Universe', slug: randomUUID(), kind: 'homebrew' })
		.returning();
	return { owner: owner!, universe: row! };
}

let db: Db;
let vectorClient: QdrantClient;
const createdCollections: string[] = [];

beforeAll(() => {
	db = openTestDb();
	vectorClient = createVectorClient();
});

afterAll(async () => {
	await closeDb(db);
});

afterEach(async () => {
	while (createdCollections.length > 0) {
		await dropCollection(vectorClient, createdCollections.pop()!).catch(() => undefined);
	}
});

function scratchCollection(): string {
	const name = `cross-lingual-test-${randomUUID()}`;
	createdCollections.push(name);
	return name;
}

// Issue #125's own cross-lingual gold questions, run over `@canonry/eval`'s real
// Valdoria Reach retrieval corpus (`valdoriaReachRetrieval.chunks`, all of it, chunked
// exactly as `packages/eval`'s own retrieval eval indexes it) rather than a corpus this
// file invents. Issue #122 added two bilingual entities there:
//
//  * `la-casa-dei-mercanti` ("La Casa dei Mercanti", alias "The Merchant House") -
//    genuinely Italian prose, `detectLanguage` -> 'it'.
//  * `smugglers-ledger` ("The Smugglers' Ledger") - deliberately mixed English and
//    Italian sentences, `detectLanguage` -> null (an honest "unknown", not a defect).
//
// `cross-it-to-en` asks in Italian, paraphrased so it shares no literal token with
// `the-gilded-rat#0`'s own English prose - the clean semantic-crossing test.
// `cross-en-to-it` asks in English about `la-casa-dei-mercanti#0`'s Italian content,
// again with no literal token shared with the Italian body (the query's "Merchant
// House" is the entity's own untranslated *alias*, SPEC.md §6.4's cheap channel, but
// aliases are metadata, not part of `text` - the embedding call never sees it, so this
// stays a clean test of the embeddings channel, never the aliases one).
const crossLingualQuestions: GoldQuestion[] = [
	{
		id: 'cross-it-to-en',
		// "Who runs the inn where nobody ever disturbs the corner table?"
		question: "Chi gestisce la locanda dove nessuno disturba mai il tavolo d'angolo?",
		relevantChunkIds: ['the-gilded-rat#0']
	},
	{
		id: 'cross-en-to-it',
		question: 'Where does the Merchant House keep its ledgers?',
		relevantChunkIds: ['la-casa-dei-mercanti#0']
	},
	{
		id: 'baseline-en-to-en',
		question: 'Who appointed Aldric Vane as captain?',
		relevantChunkIds: ['iselde-wrenn#0']
	},
	{
		id: 'baseline-it-to-it',
		// "Who does La Casa dei Mercanti consider a rival?"
		question: 'Chi considera La Casa dei Mercanti una concorrente?',
		relevantChunkIds: ['la-casa-dei-mercanti#1']
	},
	{
		id: 'mixed-language-chunk-still-reachable',
		question: "Who kept the smugglers' ledger after Aldric Vane stopped writing in it?",
		relevantChunkIds: ['smugglers-ledger#0']
	}
];

const crossLingualCorpus: RetrievalCorpus = {
	id: 'valdoria-reach-cross-lingual',
	name: 'Valdoria Reach, cross-lingually (issue #125)',
	chunks: valdoriaReachRetrieval.chunks,
	questions: crossLingualQuestions
};

describe("cross-lingual retrieval (SPEC.md §17, issue #125): today's hashing embedder, measured against the real Valdoria Reach fixture", () => {
	let client: QdrantClient;
	let collectionName: string;

	beforeAll(async () => {
		client = vectorClient;
		collectionName = scratchCollection();
		await ensureCollection(client, {
			name: collectionName,
			vectorSize: HASH_VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});

		const chunks = valdoriaReachRetrieval.chunks;
		const vectors = await hashingEmbedder(chunks.map((chunk) => chunk.text));
		const loreChunks: LoreChunk[] = chunks.map((chunk, i) => ({
			id: randomUUID(),
			vector: vectors[i]!,
			payload: {
				text: chunk.text,
				breadcrumb: chunk.breadcrumb,
				pageTitle: chunk.entitySlug,
				url: chunk.id, // round-tripped back to the gold chunk id, same trick as retrieval-eval.test.ts
				pageUpdatedAt: '2026-01-01T00:00:00.000Z',
				indexedAt: '2026-01-01T00:00:00.000Z',
				universeId: 'cross-lingual-universe',
				dataSourceId: 'cross-lingual-source',
				sectionSummary: chunk.text.slice(0, 120),
				questionsThisExcerptCanAnswer: [],
				excerptKeywords: chunk.keywords ?? [],
				pointKind: 'body',
				entityType: null,
				language: detectLanguage(chunk.text)
			}
		}));
		await upsertLoreChunks(client, collectionName, loreChunks);
	});

	const retriever: Retriever = async (question: GoldQuestion): Promise<RetrievalHit[]> => {
		const [vector] = await hashingEmbedder([question.question]);
		const hits = await queryLore(client, collectionName, {
			vector: vector!,
			universeId: 'cross-lingual-universe',
			limit: 200
		});
		return hits.map((hit) => ({ chunkId: hit.payload.url, score: hit.score }));
	};

	it('quotes the actual rank/MRR for both cross-lingual directions, next to a same-language baseline', async () => {
		// threshold: 0, topK: 3 (a fifth of this 15-chunk corpus) so a weak-but-real
		// signal is visible as a rank rather than erased by the production cutoff - that
		// comparison is the second assertion below.
		const raw = await runRetrievalEval(crossLingualCorpus, retriever, { topK: 3, threshold: 0 });
		const byId = new Map(raw.questions.map((q) => [q.questionId, q]));

		console.log(
			'[cross-lingual-retrieval] hashingEmbedder, real Valdoria Reach fixture, threshold=0, topK=3: %o',
			raw.questions.map((q) => ({
				question: q.questionId,
				rank: q.rank,
				reciprocalRank: Number(q.reciprocalRank.toFixed(3))
			}))
		);

		// The baselines (same-language query against same-language content) rank the gold
		// chunk first: the harness and the real fixture are not simply broken.
		expect(byId.get('baseline-en-to-en')!.rank).toBe(1);
		expect(byId.get('baseline-it-to-it')!.rank).toBe(1);

		// The clean cross-lingual cases (no shared literal token at all) never surface
		// the right chunk within top-3 of fifteen: this is the gap issue #125 exists to
		// close, quantified against real canon rather than assumed.
		expect(byId.get('cross-it-to-en')!.rank).toBeNull();
		expect(byId.get('cross-en-to-it')!.rank).toBeNull();

		// The deliberately mixed-language entity (issue #122's `smugglers-ledger`,
		// `detectLanguage` -> null) is still reachable at all - proof that "language
		// unknown" is not silently excluded either, the other half of §17's "must not
		// become a filter that hides a canon's other half".
		expect(byId.get('mixed-language-chunk-still-reachable')!.rank).not.toBeNull();

		// At the actual production defaults (retriever.ts's DEFAULT_TOP_K = 8,
		// DEFAULT_THRESHOLD = 0.5), report what a live Ask would get back today - the
		// number that matters, not a constructed edge case.
		const production = await runRetrievalEval(crossLingualCorpus, retriever, {
			topK: 8,
			threshold: 0.5
		});
		const productionById = new Map(production.questions.map((q) => [q.questionId, q]));
		console.log(
			'[cross-lingual-retrieval] hashingEmbedder, real Valdoria Reach fixture, threshold=0.5, topK=8 (production defaults): %o',
			production.questions.map((q) => ({
				question: q.questionId,
				rank: q.rank,
				hitCount: q.hitCount
			}))
		);
		// Neither cross-lingual direction clears the production threshold at all.
		expect(productionById.get('cross-it-to-en')!.hitCount).toBe(0);
		expect(productionById.get('cross-en-to-it')!.hitCount).toBe(0);
	});
});

describe('chunk language is metadata, never a retrieval filter (SPEC.md §17, issue #125)', () => {
	it('scoreLoreHits (the production retrieval entry point) returns chunks of every language present, for a query in either language', async () => {
		const { universe: u } = await insertUniverseWithOwner(db);
		const collectionName = scratchCollection();
		await ensureCollection(vectorClient, {
			name: collectionName,
			vectorSize: HASH_VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});

		// Deliberately near-identical vectors (both derived from the word "harbor" and
		// nothing else that would separate them) so nothing but a language filter could
		// keep one out - proof this is about the *filter*, not the ranking.
		const enText = 'harbor harbor harbor';
		const itText = 'porto porto harbor';
		const [enVector, itVector] = await hashingEmbedder([enText, itText]);

		const loreChunks: LoreChunk[] = [
			{
				id: randomUUID(),
				vector: enVector!,
				payload: {
					text: enText,
					breadcrumb: 'English harbor entry',
					pageTitle: 'English harbor entry',
					url: 'https://wiki.example.com/english-harbor',
					pageUpdatedAt: '2026-01-01T00:00:00.000Z',
					indexedAt: '2026-01-01T00:00:00.000Z',
					universeId: u.id,
					dataSourceId: 'cross-lingual-source',
					sectionSummary: enText,
					questionsThisExcerptCanAnswer: [],
					excerptKeywords: [],
					pointKind: 'body',
					entityType: null,
					language: 'en'
				}
			},
			{
				id: randomUUID(),
				vector: itVector!,
				payload: {
					text: itText,
					breadcrumb: 'Italian harbor entry',
					pageTitle: 'Italian harbor entry',
					url: 'https://wiki.example.com/italian-harbor',
					pageUpdatedAt: '2026-01-01T00:00:00.000Z',
					indexedAt: '2026-01-01T00:00:00.000Z',
					universeId: u.id,
					dataSourceId: 'cross-lingual-source',
					sectionSummary: itText,
					questionsThisExcerptCanAnswer: [],
					excerptKeywords: [],
					pointKind: 'body',
					entityType: null,
					language: 'it'
				}
			}
		];
		await upsertLoreChunks(vectorClient, collectionName, loreChunks);

		const [queryVector] = await hashingEmbedder(['harbor']);
		const hits = await scoreLoreHits({
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			queryVector: queryVector!,
			queryText: 'harbor',
			candidateLimit: 10
		});

		const languagesSeen = hits.map((hit) => hit.payload.language).sort();
		expect(languagesSeen).toEqual(['en', 'it']);
	});
});
