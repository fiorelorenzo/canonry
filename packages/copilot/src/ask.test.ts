/**
 * Integration tests for Ask (issues #53/#60, SPEC.md §5/§7) against the real database and
 * a real Qdrant collection, with a fake model for the answer text only - retrieval is
 * never faked (this box has no AI Gateway credentials, so `hashingEmbedder` stands in for
 * a real embedding model, exactly as packages/indexing's own retrieval-eval.test.ts does).
 */
import { randomUUID } from 'node:crypto';
import { closeDb, eq, type Db } from '@canonry/db';
import { dataSource, modelCall, universe as universeTable } from '@canonry/db/schema';
import { createDataSource, recordLicenceReview } from '@canonry/db';
import {
	collectionExists,
	createVectorClient,
	dropCollection,
	ensureCollection,
	loreCollectionNameForModel,
	upsertLoreChunks,
	type LoreChunk,
	type QdrantClient
} from '@canonry/vector';
import { hashingEmbedder } from '@canonry/indexing';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import { resolveModel } from '@canonry/ai';
import { runAsk } from './ask.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
	insertUser
} from './test-helpers.js';
import { openTestDb } from './test-db.js';

const HASH_VECTOR_SIZE = 256;

function usage(inputTotal: number, outputTotal: number) {
	return {
		inputTokens: {
			total: inputTotal,
			noCache: inputTotal,
			cacheRead: undefined,
			cacheWrite: undefined
		},
		outputTokens: { total: outputTotal, text: outputTotal, reasoning: undefined }
	};
}

/** Streams a fixed sentence, one word per chunk, so a test can assert both the final text
 * and that `onToken` really received it incrementally. */
function streamingModel(text: string): LanguageModel {
	const words = text.split(' ');
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-premium',
		doStream: async () => ({
			stream: new ReadableStream({
				start(controller) {
					controller.enqueue({ type: 'stream-start', warnings: [] });
					controller.enqueue({ type: 'text-start', id: '1' });
					words.forEach((word, i) => {
						controller.enqueue({ type: 'text-delta', id: '1', delta: i === 0 ? word : ` ${word}` });
					});
					controller.enqueue({ type: 'text-end', id: '1' });
					controller.enqueue({
						type: 'finish',
						finishReason: { unified: 'stop', raw: undefined },
						usage: usage(120, 60)
					});
					controller.close();
				}
			})
		})
	}) as unknown as LanguageModel;
}

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

function modelFactoryFor(model: LanguageModel): ModelFactory {
	return (_resolved: ResolvedModel) => model;
}

describe('runAsk (issues #53/#60, SPEC.md §5/§7)', () => {
	let db: Db;
	let vectorClient: QdrantClient;
	const collectionNames: string[] = [];

	beforeAll(async () => {
		db = openTestDb();
		vectorClient = createVectorClient();
		try {
			await insertModelConfig(db, 'premium');
		} catch {
			/* another file in this run already provided one */
		}
		try {
			await insertModelConfig(db, 'embedding');
		} catch {
			/* another file in this run already provided one */
		}
	});

	afterAll(async () => {
		for (const name of collectionNames) {
			if (await collectionExists(vectorClient, name)) await dropCollection(vectorClient, name);
		}
		await closeDb(db);
	});

	async function fixture() {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Valdoria Reach'
		});
		const aldric = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			aliases: ['Captain Vane'],
			body:
				'Dismissed from the watch in the thaw after the Sable Winter, he now answers to ' +
				'the Ashen Ledger.'
		});
		return { owner, universe, aldric };
	}

	it('answers from own canon at zero cost with AI off, sources attached, no model call made', async () => {
		const { owner, universe } = await fixture();
		await db
			.update(universeTable)
			.set({ aiEnabled: false })
			.where(eq(universeTable.id, universe.id));

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed?',
			detailLevel: 'normal',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('should never be called')),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.generated).toBe(false);
		expect(result.credits).toBe(0);
		expect(result.sources.length).toBeGreaterThan(0);
		expect(result.sources[0]).toMatchObject({ kind: 'own_canon', entityName: 'Aldric Vane' });
		expect(result.answer).toContain('Dismissed from the watch');

		const calls = await db.select().from(modelCall).where(eq(modelCall.operation, 'ask.answer'));
		expect(calls.filter((c) => c.userId === owner.id)).toHaveLength(0);
	});

	it('streams a real synthesized answer over real own-canon retrieval with AI on, charging ask.answer', async () => {
		const { owner, universe } = await fixture();

		let streamed = '';
		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed?',
			detailLevel: 'normal',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				streamingModel('He was dismissed after the Sable Winter and now serves the Ashen Ledger.')
			),
			gateway: IDENTITY_GATEWAY,
			onToken: (delta) => {
				streamed += delta;
			}
		});

		expect(result.generated).toBe(true);
		expect(result.credits).toBeGreaterThan(0);
		expect(result.answer).toBe(
			'He was dismissed after the Sable Winter and now serves the Ashen Ledger.'
		);
		expect(streamed).toBe(result.answer);
		expect(
			result.sources.some((s) => s.kind === 'own_canon' && s.entityName === 'Aldric Vane')
		).toBe(true);
		expect(result.followUps.length).toBeGreaterThan(0);

		const calls = await db.select().from(modelCall).where(eq(modelCall.operation, 'ask.answer'));
		const matching = calls.filter((c) => c.userId === owner.id);
		expect(matching).toHaveLength(1);
		expect(matching[0]?.agent).toBe('loremaster');
	});

	it('retrieves real hits from a real Qdrant collection for the derived/indexed layer, with attribution and licence', async () => {
		const { owner, universe } = await fixture();
		// The same call `runAsk`'s `searchIndexed` makes internally - the collection name has
		// to be built from the *actual* resolved row `insertModelConfig` wrote in `beforeAll`,
		// not a fabricated one, or this seeds a Qdrant collection `runAsk` never looks at.
		const embeddingModel = await resolveModel(db, 'embedding');
		const collectionName = loreCollectionNameForModel(embeddingModel, universe.id);
		collectionNames.push(collectionName);
		await ensureCollection(vectorClient, { name: collectionName, vectorSize: HASH_VECTOR_SIZE });

		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: 'Sample Indexed Wiki',
			url: 'https://wiki.example.com/'
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
			reviewedBy: owner.id
		});
		await db
			.update(dataSource)
			.set({ attribution: 'Sample Indexed Wiki, CC BY-SA 3.0' })
			.where(eq(dataSource.id, source.id));

		const text =
			'Waterdeep is a port city bank quarter that lends against reputation as much as coin.';
		const [vector] = await hashingEmbedder([text]);
		const chunk: LoreChunk = {
			id: randomUUID(),
			vector: vector!,
			payload: {
				text,
				breadcrumb: 'Waterdeep',
				pageTitle: 'Waterdeep',
				url: 'https://wiki.example.com/Waterdeep',
				pageUpdatedAt: new Date().toISOString(),
				indexedAt: new Date().toISOString(),
				universeId: universe.id,
				dataSourceId: source.id,
				sectionSummary: 'Waterdeep overview',
				questionsThisExcerptCanAnswer: ['What is Waterdeep?'],
				excerptKeywords: ['waterdeep', 'bank']
			}
		};
		await upsertLoreChunks(vectorClient, collectionName, [chunk]);

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'What is Waterdeep, the port city bank quarter that lends against reputation?',
			detailLevel: 'normal',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('Waterdeep is a port city bank quarter.')),
			gateway: IDENTITY_GATEWAY
		});

		const indexedSource = result.sources.find((s) => s.kind === 'indexed');
		expect(indexedSource).toBeDefined();
		expect(indexedSource).toMatchObject({
			kind: 'indexed',
			pageTitle: 'Waterdeep',
			url: 'https://wiki.example.com/Waterdeep',
			attribution: 'Sample Indexed Wiki, CC BY-SA 3.0',
			licence: 'CC BY-SA 3.0'
		});
	});
});
