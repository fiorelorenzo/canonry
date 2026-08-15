/**
 * Issue #130, SPEC.md §17: "The Ask half is the same shape [as propagation]: a question
 * in Italian whose answer requires an English source, asserting that the answer is
 * Italian, the sources are shown in their own language, and the quoted span still matches
 * the source byte for byte."
 *
 * Runs `runAsk` (ask.ts) against a real database, real entity bodies copied verbatim from
 * `packages/db/src/seed-fixture.ts` (Corvin Ashe's English body, La Casa dei Mercanti's
 * Italian one, issue #122's real bilingual canon - built on rather than invented), and a
 * genuinely Italian question. `searchOwnCanon` is a deterministic word-overlap match over
 * `entity.body` (diff.ts's `jaccard`/`tokenize`, ASCII-only, no language awareness at
 * all): it finds Corvin Ashe's English sentence because the question names "the Ashen
 * Ledger" by its own untranslated proper noun (SPEC.md §17: "Names are not translated,
 * ever"), the same mechanism that carries every cross-language propagation case in
 * `eval.test.ts`. This is deliberately *not* a test of layer 2 (indexed/Qdrant, real
 * embeddings): `packages/indexing/src/cross-lingual-retrieval.test.ts` already measures,
 * honestly, that today's network-free `hashingEmbedder` cannot cross the language boundary
 * on its own - there is no live embedding credential on this box to prove that layer here
 * either, so this file does not pretend to.
 *
 * The synthesized answer's own Italian text comes from a *scripted* `MockLanguageModelV4`
 * (`italianAnswerModel` below), never a real model call - this box has no AI Gateway
 * credentials. What is actually proven is the contract: `runAsk` builds a system prompt
 * that instructs Italian regardless of the sources' own language (asserted directly on the
 * captured prompt, exactly as ask.test.ts's own issue #123 test does) and returns whatever
 * the model sends back unmodified. It is not, and cannot be on this box, proof that a real
 * model would obey that instruction and actually write fluent Italian - that obedience is
 * a live-model question this harness has no credential to ask.
 */
import { closeDb, eq, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
import { createVectorClient, type QdrantClient } from '@canonry/vector';
import { hashingEmbedder } from '@canonry/indexing';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import { runAsk } from './ask.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
	insertUser,
	systemPromptOf
} from './test-helpers.js';
import { openTestDb } from './test-db.js';

/** Same shape as ask.test.ts's own `capturingStreamingModel`, duplicated rather than
 * imported: it is local test infrastructure, not shared package code, and this file is
 * meant to stand alone. Streams a fixed, scripted Italian sentence and hands the real call
 * `options` to `capture` first, so the test can assert on the prompt `runAsk` actually
 * sent, not only on the text that comes back. */
function italianAnswerModel(
	text: string,
	capture: (options: { prompt: Array<{ role: string; content: unknown }> }) => void
): LanguageModel {
	const words = text.split(' ');
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-premium',
		doStream: async (options) => {
			capture(options);
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: 'stream-start', warnings: [] });
						controller.enqueue({ type: 'text-start', id: '1' });
						words.forEach((word, i) => {
							controller.enqueue({
								type: 'text-delta',
								id: '1',
								delta: i === 0 ? word : ` ${word}`
							});
						});
						controller.enqueue({ type: 'text-end', id: '1' });
						controller.enqueue({
							type: 'finish',
							finishReason: { unified: 'stop', raw: undefined },
							usage: {
								inputTokens: {
									total: 140,
									noCache: 140,
									cacheRead: undefined,
									cacheWrite: undefined
								},
								outputTokens: { total: 70, text: 70, reasoning: undefined }
							}
						});
						controller.close();
					}
				})
			};
		}
	}) as unknown as LanguageModel;
}

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

function modelFactoryFor(model: LanguageModel): ModelFactory {
	return (_resolved: ResolvedModel) => model;
}

// Bodies copied verbatim from packages/db/src/seed-fixture.ts (issue #122's real bilingual
// canon) rather than invented: Corvin Ashe's English body already names "The Ashen Ledger"
// inline, and La Casa dei Mercanti's Italian body already names it back - the same two
// sentences 'ashen-ledger-undercuts-mercanti' and 'mercanti-buys-ashen-ledger-debt' in
// @canonry/eval's propagation corpus build on for the propagation half of this issue.
const CORVIN_ASHE_BODY =
	"Factor of [[The Ashen Ledger]]. He holds most of the Lantern Quarter's debt and none of its affection.";
const LA_CASA_DEI_MERCANTI_BODY =
	'La Casa dei Mercanti tiene i suoi registri nel Quartiere della Lanterna, non lontano dal porto di [[Valdoria]]. Nessuno entra senza un debito da saldare o una lettera di credito da mostrare, e il vecchio Contabile non dimentica mai un nome.\n\n## Il libro nero\n\nOgni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa. [[The Ashen Ledger]] la considera una concorrente, mai un’alleata, e i loro uomini non bevono mai allo stesso tavolo.';

describe('runAsk crosses the language boundary (issue #130, SPEC.md §17)', () => {
	let db: Db;
	let vectorClient: QdrantClient;

	beforeAll(async () => {
		db = openTestDb();
		vectorClient = createVectorClient();
		try {
			await insertModelConfig(db, 'premium');
		} catch {
			/* another file in this run already provided one */
		}
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('an Italian question naming an untranslated proper noun finds the English source, answers in Italian, and quotes every source byte-for-byte in its own language', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Valdoria Reach (cross-language)'
		});
		const corvinAshe = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: CORVIN_ASHE_BODY,
			language: 'en',
			languageSource: 'detected'
		});
		const laCasaDeiMercanti = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'La Casa dei Mercanti',
			aliases: ['The Merchant House'],
			body: LA_CASA_DEI_MERCANTI_BODY,
			language: 'it',
			languageSource: 'detected'
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			// Genuinely Italian, sharing no content word with either entity's body except the
			// untranslated proper noun "Ashen Ledger" - the question a GM working in Italian
			// would actually type about an English-language faction they imported.
			question: 'Chi lavora per la Ashen Ledger?',
			detailLevel: 'normal',
			locale: 'it',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				italianAnswerModel(
					'Corvin Ashe è il fattore della Ashen Ledger nel Quartiere della Lanterna.',
					(options) => {
						captured = options;
					}
				)
			),
			gateway: IDENTITY_GATEWAY
		});

		// The answer is Italian: the system prompt states the target language explicitly
		// (SPEC.md §17 rule two, speech.ts's `speechInstruction`) and the text `runAsk`
		// returns is exactly what the scripted model sent back - proof of the wiring, not of
		// a real model's obedience to that instruction (see this file's own doc comment).
		const system = systemPromptOf(captured!);
		expect(system).toContain('Italiano');
		expect(system).toContain('locale "it"');
		expect(result.answer).toBe(
			'Corvin Ashe è il fattore della Ashen Ledger nel Quartiere della Lanterna.'
		);

		// The answer requires an English source: without Corvin Ashe's English sentence
		// naming "The Ashen Ledger", nothing in this universe answers who works there.
		const corvinSource = result.sources.find(
			(s) => s.kind === 'own_canon' && s.entityId === corvinAshe.id
		);
		expect(corvinSource).toBeDefined();
		expect(corvinSource).toMatchObject({ kind: 'own_canon', entityName: 'Corvin Ashe' });

		// Sources are listed in their own language, never translated into the reader's
		// interface locale: Corvin Ashe's quoted statement is still the literal English
		// sentence, word for word.
		if (corvinSource?.kind !== 'own_canon') throw new Error('expected an own_canon source');
		expect(corvinSource.statement).toBe('Factor of [[The Ashen Ledger]].');

		// The quoted span matches its source byte for byte: the exact substring
		// `entity.body` was sliced at reproduces the quoted statement with no drift, which is
		// what makes the quotation checkable at all (SPEC.md §17: "a translated quotation...
		// cannot be found in the entry, and the GM cannot check it").
		expect(CORVIN_ASHE_BODY.slice(corvinSource.spanStart, corvinSource.spanEnd)).toBe(
			corvinSource.statement
		);

		// La Casa dei Mercanti's own body also mentions "The Ashen Ledger" by name (issue
		// #122's rivalry line), so it scores too and is returned as a second source - still
		// in Italian, still byte-identical to its own body, proving the same "own language,
		// own byte-for-byte span" contract holds for the Italian side as well, not only the
		// English one.
		const mercantiSource = result.sources.find(
			(s) => s.kind === 'own_canon' && s.entityId === laCasaDeiMercanti.id
		);
		expect(mercantiSource).toBeDefined();
		if (mercantiSource?.kind !== 'own_canon') throw new Error('expected an own_canon source');
		expect(mercantiSource.statement).toBe(
			'[[The Ashen Ledger]] la considera una concorrente, mai un’alleata, e i loro uomini non bevono mai allo stesso tavolo.'
		);
		expect(LA_CASA_DEI_MERCANTI_BODY.slice(mercantiSource.spanStart, mercantiSource.spanEnd)).toBe(
			mercantiSource.statement
		);

		// The English source outranks the Italian one - it is the more relevant answer to
		// "who works there", not merely the first one inserted.
		expect(result.sources.indexOf(corvinSource!)).toBeLessThan(
			result.sources.indexOf(mercantiSource!)
		);

		const calls = await db.select().from(modelCall).where(eq(modelCall.operation, 'ask.answer'));
		expect(calls.filter((c) => c.userId === owner.id)).toHaveLength(1);
	});
});
