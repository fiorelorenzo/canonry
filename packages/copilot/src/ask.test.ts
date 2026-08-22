/**
 * Integration tests for Ask (issues #53/#60, SPEC.md §5/§7) against the real database and
 * a real Qdrant collection, with a fake model for the answer text only - retrieval is
 * never faked (this box has no AI Gateway credentials, so `hashingEmbedder` stands in for
 * a real embedding model, exactly as packages/indexing's own retrieval-eval.test.ts does).
 */
import { randomUUID } from 'node:crypto';
import { closeDb, eq, type Db } from '@canonry/db';
import { dataSource, modelCall, proposal, universe as universeTable } from '@canonry/db/schema';
import {
	createDataSource,
	listNarrationStylePresets,
	recordLicenceReview,
	selectUniverseNarrationStylePreset,
	upsertUniverseNarrationStyle
} from '@canonry/db';
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
import {
	runAsk,
	MAX_HISTORY_TURNS,
	MAX_HISTORY_TURN_CHARS,
	CARRIED_FORWARD_LIMIT,
	mergeCarriedForwardOwnCanon,
	quotedSentenceFromChunk
} from './ask.js';
import type {
	AskContext,
	AskDetailLevel,
	AskHistoryTurn,
	AskSource,
	OwnCanonSource
} from './ask.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { READING_ONLY_FALLBACK } from './speech.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
	insertRelation,
	insertRelationType,
	insertUser,
	systemPromptOf,
	userPromptOf
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

/** Same shape as `streamingModel`, but hands the real call `options` to `capture` first -
 * for asserting on "the prompt actually sent" (SPEC.md §17, issues #123/#124) rather than
 * only on the text that comes back. */
function capturingStreamingModel(
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
							usage: usage(120, 60)
						});
						controller.close();
					}
				})
			};
		}
	}) as unknown as LanguageModel;
}

/** Streams a tool call on the first step, then plain text on the second - the shape a
 * real multi-step Ask turn takes once a proposal tool fires. `doGenerate` (the nested
 * `generateObject` call `entryPropose`/`entryEditPropose` make internally) always
 * throws, standing in for the real-gateway failure this model reproduces: OpenAI's
 * structured-output mode rejected `ask-propose.ts`'s original `newEntitySchema`
 * (`z.array(z.string()).default([])` on `aliases`), confirmed against the real gateway
 * (gpt-5.4/openai) before that schema was fixed - see this file's own regression test
 * below and `ask-propose.ts`'s comment on `newEntitySchema`. `onSecondStep` captures
 * the prompt the model actually receives for its second step, which is what proves the
 * failed tool call reached the model as an explicit result rather than silence. */
function toolCallThenTextModel(input: {
	toolName: 'entry_propose' | 'entry_edit_propose';
	toolInput: Record<string, unknown>;
	finalText: string;
	failureMessage: string;
	onSecondStep?: (options: { prompt: Array<{ role: string; content: unknown }> }) => void;
}): LanguageModel {
	let step = 0;
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-premium',
		doStream: async (options) => {
			step += 1;
			if (step === 1) {
				return {
					stream: new ReadableStream({
						start(controller) {
							controller.enqueue({ type: 'stream-start', warnings: [] });
							controller.enqueue({
								type: 'tool-call',
								toolCallId: 't1',
								toolName: input.toolName,
								input: JSON.stringify(input.toolInput)
							});
							controller.enqueue({
								type: 'finish',
								finishReason: { unified: 'tool-calls', raw: undefined },
								usage: usage(80, 20)
							});
							controller.close();
						}
					})
				};
			}
			input.onSecondStep?.(options);
			const words = input.finalText.split(' ');
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: 'stream-start', warnings: [] });
						controller.enqueue({ type: 'text-start', id: '2' });
						words.forEach((word, i) => {
							controller.enqueue({
								type: 'text-delta',
								id: '2',
								delta: i === 0 ? word : ` ${word}`
							});
						});
						controller.enqueue({ type: 'text-end', id: '2' });
						controller.enqueue({
							type: 'finish',
							finishReason: { unified: 'stop', raw: undefined },
							usage: usage(100, 40)
						});
						controller.close();
					}
				})
			};
		},
		doGenerate: async () => {
			throw new Error(input.failureMessage);
		}
	}) as unknown as LanguageModel;
}

/** Two creates, each failing its first drafting attempt and succeeding on a model-driven
 * retry - five steps total (propose-fail, propose-retry-ok, per entity, then closing
 * text), one more than the old `stepCountIs(4)` cap could ever reach. `doStream` scripts
 * `runAsk`'s own outer tool-call loop; `doGenerate` scripts the nested `generateObject`
 * call each `entry_propose` execution makes inside `ask-propose.ts`, throwing on the
 * first attempt for each entity (the same failure shape `toolCallThenTextModel` exercises
 * above) and returning a valid draft on the second. */
function twoCreatesWithRetriesModel(): LanguageModel {
	let step = 0;
	let draftCall = 0;
	const toolStep = (toolCallId: string, name: string) => ({
		stream: new ReadableStream({
			start(controller) {
				controller.enqueue({ type: 'stream-start', warnings: [] });
				controller.enqueue({
					type: 'tool-call',
					toolCallId,
					toolName: 'entry_propose',
					input: JSON.stringify({ name, instruction: `Make a card for ${name}.` })
				});
				controller.enqueue({
					type: 'finish',
					finishReason: { unified: 'tool-calls', raw: undefined },
					usage: usage(80, 20)
				});
				controller.close();
			}
		})
	});
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-premium',
		doStream: async () => {
			step += 1;
			if (step === 1 || step === 2) return toolStep(`t${step}`, 'Blacksmith');
			if (step === 3 || step === 4) return toolStep(`t${step}`, 'Herbalist');
			const text = 'Proposed a blacksmith and a herbalist, both pending review.';
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: 'stream-start', warnings: [] });
						controller.enqueue({ type: 'text-start', id: '5' });
						controller.enqueue({ type: 'text-delta', id: '5', delta: text });
						controller.enqueue({ type: 'text-end', id: '5' });
						controller.enqueue({
							type: 'finish',
							finishReason: { unified: 'stop', raw: undefined },
							usage: usage(100, 40)
						});
						controller.close();
					}
				})
			};
		},
		doGenerate: async () => {
			draftCall += 1;
			if (draftCall % 2 === 1) throw new Error('synthetic drafting failure');
			const name = draftCall <= 2 ? 'Blacksmith' : 'Herbalist';
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							type: 'character',
							name,
							aliases: [],
							body: `${name} works the trade quietly and well.`,
							summary: `A ${name.toLowerCase()} drafted from the GM's instruction.`,
							usedSources: []
						})
					}
				],
				finishReason: { unified: 'stop', raw: undefined },
				usage: usage(60, 20),
				warnings: []
			};
		}
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
			locale: 'en',
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
			locale: 'en',
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
		await ensureCollection(vectorClient, {
			name: collectionName,
			vectorSize: HASH_VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});

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
				excerptKeywords: ['waterdeep', 'bank'],
				language: 'en'
			}
		};
		await upsertLoreChunks(vectorClient, collectionName, [chunk]);

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'What is Waterdeep, the port city bank quarter that lends against reputation?',
			detailLevel: 'normal',
			locale: 'en',
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

	it('SPEC.md §17 rule two (issue #123): an Italian locale states the language in the system prompt, streams an Italian answer over English canon, and derives Italian follow-ups - never translating the source entity name', async () => {
		const { owner, universe } = await fixture();

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed?',
			detailLevel: 'normal',
			locale: 'it',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel(
					'È stato congedato dopo il Sable Winter e ora serve la Ashen Ledger.',
					(options) => {
						captured = options;
					}
				)
			),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain('Italiano');
		expect(system).toContain('locale "it"');
		expect(system).toContain('never translate a proper noun');
		expect(system).toContain('never translate a quoted sentence');

		expect(result.answer).toBe(
			'È stato congedato dopo il Sable Winter e ora serve la Ashen Ledger.'
		);
		// The English source entity's name is never translated into the Italian follow-up.
		expect(result.followUps).toContain('Dimmi di più su Aldric Vane.');
	});

	it('issue #378, decision R3, amended by issue #451, decision U2: a custom Loremaster voice reaches the system prompt beside the locale rule, and no voice chosen adds no clause', async () => {
		const { owner, universe } = await fixture();
		const voice = 'Wry, understated, never more than a sentence at a time.';
		await upsertUniverseNarrationStyle(db, {
			universeId: universe.id,
			name: 'Custom',
			promptClause: voice
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel('placeholder answer', (options) => {
					captured = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain(voice);
		expect(system).toContain('how their Loremaster sounds');
		expect(system).toContain('Let it shape your tone and word choice only');

		// No voice chosen at all (a fresh fixture's `narrationStyleId` is null) adds no
		// clause - not an empty one - to a universe nobody has set one for.
		const silent = await fixture();
		let silentCaptured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await runAsk({
			db,
			userId: silent.owner.id,
			universeId: silent.universe.id,
			question: 'Why was Aldric Vane dismissed?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel('placeholder answer', (options) => {
					silentCaptured = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});

		const silentSystem = systemPromptOf(silentCaptured!);
		expect(silentSystem).not.toContain('how their Loremaster sounds');
		expect(silentSystem).not.toContain('Let it shape your tone');
	});

	it('issue #451, decision U2: a chosen shipped narration preset reaches the system prompt the same way a custom voice does', async () => {
		const { owner, universe } = await fixture();
		const [preset] = await listNarrationStylePresets(db, 'en');
		if (!preset) throw new Error('no seeded narration preset to test against');
		await selectUniverseNarrationStylePreset(db, universe.id, preset.id);

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel('placeholder answer', (options) => {
					captured = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain(preset.promptClause);
		expect(system).toContain('how their Loremaster sounds');
	});

	it('SPEC.md §17 rule two (issue #123): the reading-only fallback speaks the interface locale too, with AI off and no model call', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Otherworld',
			aiEnabled: false
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'Dismissed from the watch in the thaw after the Sable Winter.'
		});

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			// Shares no words with the fixture's own body, so layer 1 finds nothing (own-canon
			// scoring requires a positive word-overlap score) and layer 2 has no collection for
			// this fresh universe either - the fallback branch is the only one reachable.
			question: 'Quanti gattini colorati saltano sopra recinzioni dorate?',
			detailLevel: 'normal',
			locale: 'it',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('should never be called')),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.generated).toBe(false);
		expect(result.sources).toEqual([]);
		expect(result.answer).toBe(
			'Il tuo canone non contiene ancora nulla che risponda a questa domanda.'
		);

		const calls = await db.select().from(modelCall).where(eq(modelCall.operation, 'ask.answer'));
		expect(calls.filter((c) => c.userId === owner.id)).toHaveLength(0);
	});

	it('SPEC.md §5 / issue #167: the five detail-level instructions form one length scale, with "full" naming "detailed" as included', async () => {
		const { owner, universe } = await fixture();
		const levels: AskDetailLevel[] = ['1_line', 'short', 'normal', 'detailed', 'full'];
		const systemPrompts: string[] = [];

		for (const detailLevel of levels) {
			let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
			await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Why was Aldric Vane dismissed?',
				detailLevel,
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(
					capturingStreamingModel('placeholder answer', (options) => {
						captured = options;
					})
				),
				gateway: IDENTITY_GATEWAY
			});
			systemPrompts.push(systemPromptOf(captured!));
		}

		// The bug (#167) was "detailed" and "full" reading as two different shapes rather
		// than two points on one scale, so nothing enforced that any two levels even asked
		// for something different. A mock model cannot measure a real answer's length, so
		// this pins the instruction text the levels compile to instead: it catches the
		// instructions collapsing or reordering, not a regression in what a real model does
		// with them - that needs the bench e2e run, not a unit test.
		expect(new Set(systemPrompts).size).toBe(levels.length);

		// "full" has to name "detailed"'s scope as included, or a model has no textual
		// reason to treat "full" as the longer of the two - which is exactly how the bug
		// happened (full measured 29% shorter than detailed on a real model, issue #167).
		const fullPrompt = systemPrompts[levels.indexOf('full')]!;
		const detailedPrompt = systemPrompts[levels.indexOf('detailed')]!;
		expect(fullPrompt).toContain('a "detailed" answer');
		expect(fullPrompt).not.toBe(detailedPrompt);
	});

	it('issue #256 real-gateway regression: a tool-call whose drafting call fails never reads as a completed proposal', async () => {
		const { owner, universe } = await fixture();
		let secondStepPrompt: { prompt: Array<{ role: string; content: unknown }> } | undefined;

		const model = toolCallThenTextModel({
			toolName: 'entry_propose',
			toolInput: { name: 'A new blacksmith', instruction: 'Make them gruff but fair.' },
			finalText: 'placeholder answer',
			failureMessage: 'synthetic drafting failure',
			onSecondStep: (options) => {
				secondStepPrompt = options;
			}
		});

		const proposalEvents: unknown[] = [];
		const failureEvents: Array<{ tool: string; message: string }> = [];

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Create a card for a new blacksmith.',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			onProposal: (p) => proposalEvents.push(p),
			onProposalFailure: (f) => failureEvents.push(f)
		});

		// Neither the result nor the callback ever claims a proposal was created.
		expect(result.proposals).toHaveLength(0);
		expect(proposalEvents).toHaveLength(0);

		// The failure reached the caller through both channels the surface can use.
		expect(result.failures).toEqual([
			{ tool: 'entry_propose', message: 'synthetic drafting failure' }
		]);
		expect(failureEvents).toEqual([
			{ tool: 'entry_propose', message: 'synthetic drafting failure' }
		]);

		// The model's own second step actually received an explicit, unambiguous failure
		// result - not silence, and not a raw thrown error it could disregard - which is
		// what makes it possible for the system prompt's "ok: false" instruction to work.
		const secondPromptText = JSON.stringify(secondStepPrompt);
		expect(secondPromptText).toContain('"ok":false');
		expect(secondPromptText).toContain('synthetic drafting failure');
		expect(secondPromptText).toContain('Never say you created or proposed anything');

		// Guardrail 1: nothing reached the database - no proposal, and by construction
		// (ask-propose.ts never calls acceptProposal) no revision either.
		const askProposals = await db
			.select()
			.from(proposal)
			.where(eq(proposal.universeId, universe.id));
		expect(askProposals.filter((p) => p.trigger === 'ask')).toHaveLength(0);
	});

	it("SPEC.md §7/guardrail 3 (issue #270): more than three relevant entities all cite, not just OWN_CANON_LIMIT's old cap of three", async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Watch Reach'
		});
		// Five entities, each sharing several words with the question below, so layer 1's
		// Jaccard search scores all five above zero - the fixture the demo question ("why
		// was Aldric Vane dismissed, and who put him back?") actually hit, generalised to
		// more than OWN_CANON_LIMIT's old value of 3 so the assertion below is meaningful.
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'Dismissed from the watch after the Sable Winter, he now answers to the Ashen Ledger.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Bryn Oswald',
			body: 'Bryn Oswald commands the watch now, having replaced Aldric Vane after his dismissal.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corwin Ashe',
			body: 'Corwin Ashe once served the watch and was dismissed alongside Aldric Vane.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Dessa Marlow',
			body: 'Dessa Marlow now oversees who commands the city watch.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Elyan Voss',
			body: 'Elyan Voss was dismissed from the watch long before Aldric Vane arrived.'
		});
		await db
			.update(universeTable)
			.set({ aiEnabled: false })
			.where(eq(universeTable.id, universe.id));

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed from the watch, and who commands it now?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('should never be called')),
			gateway: IDENTITY_GATEWAY
		});

		const ownCanonSources = result.sources.filter((s) => s.kind === 'own_canon');
		expect(ownCanonSources.length).toBeGreaterThan(3);
	});

	it('issue #270 follow-up: more than three relevant entities produce more than two follow-ups', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Watch Reach Two'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'Dismissed from the watch after the Sable Winter, he now answers to the Ashen Ledger.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Bryn Oswald',
			body: 'Bryn Oswald commands the watch now, having replaced Aldric Vane after his dismissal.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corwin Ashe',
			body: 'Corwin Ashe once served the watch and was dismissed alongside Aldric Vane.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Dessa Marlow',
			body: 'Dessa Marlow now oversees who commands the city watch.'
		});
		await db
			.update(universeTable)
			.set({ aiEnabled: false })
			.where(eq(universeTable.id, universe.id));

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed from the watch, and who commands it now?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('should never be called')),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.followUps.length).toBeGreaterThan(2);
	});

	it('stepCountIs(6): two proposals, each needing a model-driven retry after a failed drafting call, both still land - five steps, one more than the old cap of four could reach', async () => {
		const { owner, universe } = await fixture();
		const proposalEvents: unknown[] = [];

		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Create a card for a blacksmith and one for a herbalist.',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(twoCreatesWithRetriesModel()),
			gateway: IDENTITY_GATEWAY,
			onProposal: (p) => proposalEvents.push(p)
		});

		// Both entities made it through despite each needing a retry - four tool-call
		// steps plus the closing text step the old cap of 4 had no room left for.
		expect(result.proposals).toHaveLength(2);
		expect(proposalEvents).toHaveLength(2);
		expect(result.proposals.map((p) => p.entityName).sort()).toEqual(['Blacksmith', 'Herbalist']);
		// The closing text step actually ran and reached the GM - the failure mode this
		// cap exists to avoid is the loop stopping on step 4 (a tool-call step) with
		// proposals written but nothing ever said about them.
		expect(result.answer).toBe('Proposed a blacksmith and a herbalist, both pending review.');
	});

	it('issue #346: a broad question that shares only function words with the canon cites nothing, where a targeted question still cites the entry', async () => {
		const { owner, universe } = await fixture();

		// Shares `in`, `the` and `now` with the fixture's own body ("Dismissed from the watch
		// in the thaw after the Sable Winter, he now answers to the Ashen Ledger."), which is
		// exactly the overlap that used to be enough: `score > 0` was the whole condition, so
		// Aldric Vane came back as a source for a question that is not about him. It is a real
		// question a GM asks, and it is #346's own report ("general questions about the
		// universe... answers by taking from particular pages apparently at random").
		const broad = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'What is going on in the world now?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('Nothing here matches that question.')),
			gateway: IDENTITY_GATEWAY
		});
		expect(broad.sources.filter((s) => s.kind === 'own_canon')).toEqual([]);
		// And nothing is offered to click on either: the follow-ups are derived from the
		// sources, so a coincidence used to become a "tell me more about Aldric Vane" button.
		expect(broad.followUps).toEqual([]);

		// The same canon, a question that names it: unchanged.
		const targeted = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed from the watch?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('After the Sable Winter.')),
			gateway: IDENTITY_GATEWAY
		});
		expect(
			targeted.sources.some((s) => s.kind === 'own_canon' && s.entityName === 'Aldric Vane')
		).toBe(true);
	});

	it('issue #346: the same rule holds for an Italian question, whose function words are its own', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Valdoria Reach'
		});
		await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'La Casa dei Mercanti',
			body: 'La Casa dei Mercanti tiene i suoi registri nel Quartiere della Lanterna.'
		});

		// `di`, `i`, `e` and `questo` are what this used to match on, which is why an Italian
		// GM asking a general question got the Casa's bookkeeping sentence back.
		const broad = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Che tipo di mondo e questo?',
			detailLevel: 'normal',
			locale: 'it',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('Non trovo nulla.')),
			gateway: IDENTITY_GATEWAY
		});
		expect(broad.sources).toEqual([]);

		const targeted = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Chi tiene i registri della Casa dei Mercanti?',
			detailLevel: 'normal',
			locale: 'it',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(streamingModel('Il vecchio Contabile.')),
			gateway: IDENTITY_GATEWAY
		});
		expect(
			targeted.sources.some(
				(s) => s.kind === 'own_canon' && s.entityName === 'La Casa dei Mercanti'
			)
		).toBe(true);
	});

	it('issue #346: with nothing retrieved, the answer is told to say why rather than to ask the GM for canon they already have', async () => {
		const { owner, universe } = await fixture();

		let emptyPrompt: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'What is going on in the world now?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel('placeholder answer', (options) => {
					emptyPrompt = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});
		// Against a real gateway, `(none found)` alone produced "if you share canon text or
		// world notes, I can identify the most important people" to a GM with seventeen
		// entries. The instruction exists so the refusal names the real reason.
		const emptySystem = systemPromptOf(emptyPrompt!);
		expect(emptySystem).toContain('no sources at all');
		expect(emptySystem).toContain('Never suggest they share, paste or provide canon');

		let sourcedPrompt: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'Why was Aldric Vane dismissed from the watch?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel('placeholder answer', (options) => {
					sourcedPrompt = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});
		// And an ordinary answer carries no instruction about a case it is not in.
		expect(systemPromptOf(sourcedPrompt!)).not.toContain('no sources at all');
	});

	it('issue #439 (T12): a genuinely unestablished specific fact still gets the refusal, even though a canon shape is available', async () => {
		const { owner, universe } = await fixture();

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			// Shares no content word with the fixture's own entity (`Aldric`, `Vane`,
			// `dismissed`, `watch`, `thaw`, `Sable`, `Winter`, `Ashen`, `Ledger`), and names a
			// specific missing fact (who governs the continent) rather than asking broadly
			// about the world as a whole - the T12 exception below must not apply here.
			question: 'Who governs the whole continent?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			context: { kind: 'world', name: universe.name },
			modelFactory: modelFactoryFor(
				capturingStreamingModel(
					'Your canon does not establish who governs the continent yet.',
					(options) => {
						captured = options;
					}
				)
			),
			gateway: IDENTITY_GATEWAY
		});

		// Guardrail 3's other half (#346): nothing retrieved means nothing cited.
		expect(result.sources).toEqual([]);
		// Guardrail 7: a model that actually follows the instruction below refuses honestly
		// rather than inventing a ruler - `result.answer` is what the reader sees, not only
		// what the prompt told the model to do.
		expect(result.answer).toBe('Your canon does not establish who governs the continent yet.');
		expect(result.generated).toBe(true);

		const system = systemPromptOf(captured!);
		expect(system).toContain('no sources at all');
		// #535 reverses #346's "never answer from general knowledge": with a real floor the
		// empty state is common, so the model says plainly that nothing in their canon
		// supports the question and then answers anyway, from general knowledge, labelled as
		// such. The AI-off path's own sentence is the wording it is told to open with, so a
		// GM meets one vocabulary for this fact and not two.
		expect(system).toContain(READING_ONLY_FALLBACK.en);
		expect(system).toContain('from your own general knowledge');
		expect(system).toContain('Never present a general-knowledge claim as canon');
		// The T12 exception is offered (the fixture has one real entry, so a shape exists)
		// but never forces the model away from refusing a specific missing fact - it is
		// conditioned on the question, not on whether a shape happens to be available.
		expect(system).toContain('describing the shape of the canon, not quoting it');

		const user = userPromptOf(captured!);
		expect(user).toContain(`The GM is looking at the world "${universe.name}".`);
		expect(user.indexOf('The GM is looking at the world')).toBeLessThan(user.indexOf('Question:'));
	});

	it('issue #439 (T12): a question with no lexical target gets the canon\u2019s real shape instead of a blank refusal', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Valdoria Reach Shape'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Mira Thorne',
			body: 'A quiet blacksmith who keeps to herself.'
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Rook Talvane',
			body: 'A wandering trader who deals in rare maps.'
		});
		await insertEntity(db, universe.id, {
			type: 'place',
			name: 'The Hollow Vale',
			body: 'A misty valley south of the old road.'
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const result = await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			// Shares no content word with any of the three fixture bodies above.
			question: 'What is the shape of this world so far?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel(
					'Three entries so far, two characters and a place, all quiet this season.',
					(options) => {
						captured = options;
					}
				)
			),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.sources).toEqual([]);

		const system = systemPromptOf(captured!);
		expect(system).toContain('One exception (issue #439)');
		expect(system).toContain('describing the shape of the canon, not quoting it');

		// Built from `entityCountsByType`, `weeklyChangeCounts` and `entityBrowserPage`'s own
		// `facts` sort - real numbers computed directly, not searched for and not invented.
		const user = userPromptOf(captured!);
		expect(user).toContain('Canon shape, computed directly rather than searched');
		expect(user).toContain('3 entries');
		expect(user).toContain('2 character');
		expect(user).toContain('1 place');
		// All three entries were created moments ago in this test and none has a fact or a
		// relation, so "what changed recently" and "what is thin" both resolve to the same
		// real, deterministic numbers rather than a guess.
		expect(user).toContain('3 changes in the last 12 weeks, 3 of them in the last seven days');
		expect(user).toContain('Least documented:');
		expect(user).toContain('Mira Thorne (0 facts, 0 relations)');
		expect(user).toContain('Rook Talvane (0 facts, 0 relations)');
		expect(user).toContain('The Hollow Vale (0 facts, 0 relations)');
		expect(user.indexOf('Canon shape')).toBeLessThan(user.indexOf('Question:'));
	});

	it('issue #439 (T12): a genuinely unwritten universe still gets the plain refusal - there is no shape to claim yet', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, {
			ownerUserId: owner.id,
			name: 'Unwritten Reach'
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await runAsk({
			db,
			userId: owner.id,
			universeId: universe.id,
			question: 'What is the shape of this world so far?',
			detailLevel: 'normal',
			locale: 'en',
			vectorClient,
			embedder: hashingEmbedder,
			modelFactory: modelFactoryFor(
				capturingStreamingModel('placeholder answer', (options) => {
					captured = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain('no sources at all');
		expect(system).not.toContain('One exception (issue #439)');
		expect(userPromptOf(captured!)).not.toContain('Canon shape');
	});

	describe('issue #380, decision R5: prior turns and the GM\u2019s context reach the prompt', () => {
		it('renders every turn above the question, oldest first, in the role given', async () => {
			const { owner, universe } = await fixture();
			const history: AskHistoryTurn[] = [
				{ role: 'gm', text: 'What happened to the old watch commander?' },
				{ role: 'loremaster', text: 'Aldric Vane was dismissed after the Sable Winter.' }
			];

			let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
			await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Who commands the watch now?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				history,
				modelFactory: modelFactoryFor(
					capturingStreamingModel('placeholder answer', (options) => {
						captured = options;
					})
				),
				gateway: IDENTITY_GATEWAY
			});

			const prompt = userPromptOf(captured!);
			const gmIndex = prompt.indexOf('GM: What happened to the old watch commander?');
			const loremasterIndex = prompt.indexOf(
				'Loremaster: Aldric Vane was dismissed after the Sable Winter.'
			);
			const questionIndex = prompt.indexOf('Question: Who commands the watch now?');
			expect(gmIndex).toBeGreaterThanOrEqual(0);
			expect(loremasterIndex).toBeGreaterThan(gmIndex);
			expect(questionIndex).toBeGreaterThan(loremasterIndex);
		});

		it('names the context in one line above the question, for an entry and for the world', async () => {
			const { owner, universe } = await fixture();
			const entryContext: AskContext = {
				kind: 'entry',
				name: 'Aldric Vane',
				entityType: 'character'
			};

			let entryCaptured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
			await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Why was he dismissed?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				context: entryContext,
				modelFactory: modelFactoryFor(
					capturingStreamingModel('placeholder answer', (options) => {
						entryCaptured = options;
					})
				),
				gateway: IDENTITY_GATEWAY
			});
			const entryPrompt = userPromptOf(entryCaptured!);
			expect(entryPrompt).toContain('The GM is reading the entry Aldric Vane, a character.');
			expect(entryPrompt.indexOf('The GM is reading')).toBeLessThan(
				entryPrompt.indexOf('Question:')
			);

			const worldContext: AskContext = { kind: 'world', name: 'Valdoria Reach' };
			let worldCaptured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
			await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'What is going on?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				context: worldContext,
				modelFactory: modelFactoryFor(
					capturingStreamingModel('placeholder answer', (options) => {
						worldCaptured = options;
					})
				),
				gateway: IDENTITY_GATEWAY
			});
			expect(userPromptOf(worldCaptured!)).toContain(
				'The GM is looking at the world "Valdoria Reach".'
			);
		});

		it('clamps more turns than the cap and a longer-than-cap turn, rather than refusing the request', async () => {
			const { owner, universe } = await fixture();
			const totalTurns = MAX_HISTORY_TURNS + 4;
			const longTurn = 'x'.repeat(MAX_HISTORY_TURN_CHARS + 500);
			const history: AskHistoryTurn[] = [];
			for (let i = 0; i < totalTurns; i++) {
				history.push({
					role: i % 2 === 0 ? 'gm' : 'loremaster',
					text: i === totalTurns - 1 ? longTurn : `turn ${i}`
				});
			}

			let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Who commands the watch now?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				history,
				modelFactory: modelFactoryFor(
					capturingStreamingModel('placeholder answer', (options) => {
						captured = options;
					})
				),
				gateway: IDENTITY_GATEWAY
			});
			expect(result.answer).toBe('placeholder answer');

			const prompt = userPromptOf(captured!);
			// Oldest dropped first: everything before the newest MAX_HISTORY_TURNS turns is gone.
			for (let i = 0; i < totalTurns - MAX_HISTORY_TURNS; i++) {
				expect(prompt).not.toContain(`turn ${i}`);
			}
			// The newest MAX_HISTORY_TURNS - 1 ordinary turns all survive.
			for (let i = totalTurns - MAX_HISTORY_TURNS; i < totalTurns - 1; i++) {
				expect(prompt).toContain(`turn ${i}`);
			}
			// The over-long final turn is kept (never refused) but truncated at the cap, not
			// one character more.
			expect(prompt).toContain('x'.repeat(MAX_HISTORY_TURN_CHARS));
			expect(prompt).not.toContain('x'.repeat(MAX_HISTORY_TURN_CHARS + 1));
		});

		it("issue #439 (T12): a follow-up's retrieval query joins the prior GM turn, recovering an entity a bare pronoun alone cannot find", async () => {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Watch Reach Three'
			});
			await insertEntity(db, universe.id, {
				type: 'character',
				name: 'Aldric Vane',
				body: 'Dismissed from the watch after the Sable Winter.'
			});
			// Cross-references Aldric Vane by name, the way a real sample-world entry does -
			// this is the source turn one's own question actually surfaces (verified: its own
			// body shares zero words with the bare follow-up below, only with the GM's prior
			// turn), and exactly the one the real #439 transcript's turn two needed back.
			await insertEntity(db, universe.id, {
				type: 'faction',
				name: 'The Ashen Ledger',
				body: 'The Ashen Ledger keeps Aldric Vane on its books despite his dismissal from the watch.'
			});
			await db
				.update(universeTable)
				.set({ aiEnabled: false })
				.where(eq(universeTable.id, universe.id));

			// Control: the bare follow-up alone, no history - this is the pre-fix behaviour,
			// and it still finds nothing, which is exactly the bug report (#439's own comment:
			// "the second turn throws away what the first one found").
			const withoutHistory = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'And who does he answer to now?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});
			expect(withoutHistory.sources.filter((s) => s.kind === 'own_canon')).toEqual([]);

			// The fix: the same bare follow-up, now with the GM's own preceding turn in
			// history - joining it into the retrieval query recovers The Ashen Ledger, the
			// entity that actually answers "who does he answer to now".
			const withHistory = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'And who does he answer to now?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				history: [
					{ role: 'gm', text: 'Who is Aldric Vane and what happened to him?' },
					{
						role: 'loremaster',
						text: 'He was dismissed from the watch after the Sable Winter.'
					}
				],
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});
			const names = withHistory.sources
				.filter((s) => s.kind === 'own_canon')
				.map((s) => s.entityName);
			expect(names).toContain('The Ashen Ledger');
		});

		it('issue #439 (T12): only the immediately preceding GM turn ever joins retrieval - an earlier turn\u2019s own words do not resurface two turns later', async () => {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Watch Reach Four'
			});
			await insertEntity(db, universe.id, {
				type: 'character',
				name: 'Harlan Voss',
				// Shares words with the *older* GM turn below (`harbor`, `tariffs`), not with
				// the immediately preceding one or the current question - verified (jaccard
				// simulation) to score 0 against both, and 0.25 against the older turn alone,
				// so this can only come back as a source if a turn more than one back leaks.
				body: 'Harlan Voss negotiates harbor tariffs with the merchants each spring.'
			});
			await db
				.update(universeTable)
				.set({ aiEnabled: false })
				.where(eq(universeTable.id, universe.id));

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'And what happened after that?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				history: [
					{ role: 'gm', text: 'What happened with the harbor tariffs?' },
					{ role: 'loremaster', text: 'The merchants raised tariffs again this spring.' },
					{ role: 'gm', text: 'Is the city watch doing anything about crime?' },
					{ role: 'loremaster', text: 'Nothing in your canon addresses that yet.' }
				],
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});

			expect(result.sources.filter((s) => s.kind === 'own_canon')).toEqual([]);
		});

		it('issue #439 (T12): a carried-forward own-canon source survives even when the joined query alone would have ranked it out of OWN_CANON_LIMIT, and keeps its own entity attribution', async () => {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Watch Reach Five'
			});
			// The prior turn's own topic - shares `harbor`/`bell` with the GM's preceding turn
			// only, never with the current question below.
			await insertEntity(db, universe.id, {
				type: 'place',
				name: 'The Harbor Bell',
				body: 'The harbor bell rang once at the founding and has stayed silent since the flood.'
			});
			// Six unrelated entities the *current* question's own words score higher against
			// (jaccard-simulated: each 0.105-0.111 against the joined query, versus The Harbor
			// Bell's 0.095) - enough to fill `OWN_CANON_LIMIT` (6) and rank The Harbor Bell out
			// of the joined-query result on its own, so this only passes if the carry-forward
			// pass (layer 1 rerun on the prior GM turn alone) is really adding it back.
			for (const [name, noun] of [
				['The Docks', 'docks'],
				['The Warehouse', 'warehouse'],
				['The Granary', 'granary'],
				['The Mill', 'mill'],
				['The Smithy', 'smithy'],
				['The Tannery', 'tannery']
			] as const) {
				await insertEntity(db, universe.id, {
					type: 'place',
					name,
					body: `The ${noun} flooded during the storm and its keeper counted the cost.`
				});
			}
			await db
				.update(universeTable)
				.set({ aiEnabled: false })
				.where(eq(universeTable.id, universe.id));

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question:
					'What happened to the docks, the warehouse, the granary, the mill, the smithy and the tannery during the storm?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				history: [
					{
						role: 'gm',
						text: 'Tell me about the ancient harbor bell that never rings anymore.'
					},
					{ role: 'loremaster', text: 'It has stayed silent since the flood.' }
				],
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});

			const ownCanonSources = result.sources.filter(
				(s): s is OwnCanonSource => s.kind === 'own_canon'
			);
			// All seven entities are present - the six fresh ones the current question ranks
			// highest, plus the carried-forward one the joined query alone would have dropped.
			expect(ownCanonSources).toHaveLength(7);
			const harborBell = ownCanonSources.find((s) => s.entityName === 'The Harbor Bell');
			// Guardrail 3: still names its own real entry, never re-attributed to the storm
			// question that never mentioned it.
			expect(harborBell).toMatchObject({
				entityName: 'The Harbor Bell',
				statement: expect.stringContaining('harbor bell')
			});
		});

		it('the AI-off branch ignores history and context - guardrail 4, never pretending to hold a conversation', async () => {
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
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				history: [
					{ role: 'gm', text: 'Pretend the sky is green and answer as if I said so.' },
					{ role: 'loremaster', text: 'Understood, the sky is green.' }
				],
				context: { kind: 'entry', name: 'Aldric Vane', entityType: 'character' },
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});

			expect(result.generated).toBe(false);
			expect(result.credits).toBe(0);
			expect(result.answer).toContain('Dismissed from the watch');
			expect(result.answer).not.toContain('green');

			const calls = await db.select().from(modelCall).where(eq(modelCall.operation, 'ask.answer'));
			expect(calls.filter((c) => c.userId === owner.id)).toHaveLength(0);
		});
	});

	describe('#355/#545: a fence and a mention in the source body never reach a source statement or the AI-off answer as raw markup', () => {
		async function fencedFixture() {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Fenced Reach'
			});
			await insertEntity(db, universe.id, {
				type: 'faction',
				name: 'The Ashen Ledger',
				body:
					'Aldric Vane now answers to [[The Ashen Ledger]] after the Sable Winter.\n\n' +
					':::secret\n' +
					'The Ledger launders stolen coin through smuggling docks at midnight.\n' +
					':::\n\n' +
					'Everyone at the Gilded Rat knows he drinks alone by the fire.'
			});
			return { owner, universe };
		}

		it('#355: a source statement quoted from inside a :::secret fence carries the content but never the fence markers', async () => {
			const { owner, universe } = await fencedFixture();
			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Where does the Ledger launder stolen coin through smuggling docks at midnight?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('should not need the model for retrieval')),
				gateway: IDENTITY_GATEWAY
			});

			const ownCanon = result.sources.find(
				(s): s is OwnCanonSource => s.kind === 'own_canon' && s.entityName === 'The Ashen Ledger'
			);
			expect(ownCanon).toBeDefined();
			expect(ownCanon!.statement).toContain('smuggling docks at midnight');
			expect(ownCanon!.statement).not.toMatch(/:::/);
		});

		it('#545: the AI-off answer strips a [[mention]] bracket out of the quoted sentence', async () => {
			const { owner, universe } = await fencedFixture();
			await db
				.update(universeTable)
				.set({ aiEnabled: false })
				.where(eq(universeTable.id, universe.id));

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Who does Aldric Vane answer to?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});

			expect(result.generated).toBe(false);
			expect(result.answer).toContain('The Ashen Ledger');
			expect(result.answer).not.toMatch(/\[\[|\]\]/);
		});

		it('#545: the AI-off answer strips the :::secret fence markers out of a quoted sentence, keeping the GM-visible content', async () => {
			const { owner, universe } = await fencedFixture();
			await db
				.update(universeTable)
				.set({ aiEnabled: false })
				.where(eq(universeTable.id, universe.id));

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Where does the Ledger launder stolen coin through smuggling docks at midnight?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});

			expect(result.generated).toBe(false);
			expect(result.answer).toContain('smuggling docks at midnight');
			expect(result.answer).not.toMatch(/:::/);
		});
	});

	describe('issue #535: the floor, and the sentence as the unit of a citation', () => {
		/** Three entries whose bodies never repeat their own titles, which is how a wiki is
		 * actually written and the case the floor has to survive. One carries a `:::secret`
		 * fence and a `[[mention]]` so the quote's cleanliness is checked under the new shape
		 * rather than only under the old one. */
		async function world() {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Floored Reach'
			});
			await insertEntity(db, universe.id, {
				type: 'character',
				name: 'Aldric Vane',
				aliases: ['Captain Vane'],
				body:
					'Dismissed from the watch in the thaw after [[The Sable Winter]].\n\n' +
					':::secret\n' +
					'He kept a second ledger of every bribe he ever took.\n' +
					':::\n\n' +
					'He still drinks at [[The Gilded Rat]], in the corner seat.'
			});
			await insertEntity(db, universe.id, {
				type: 'place',
				name: 'The Gilded Rat',
				body: 'An inn in the Lantern Quarter. [[Mother Sennah]] keeps it.'
			});
			await insertEntity(db, universe.id, {
				type: 'character',
				name: 'Mother Sennah',
				body: 'She was a field surgeon once, and she was kind about it.'
			});
			return { owner, universe };
		}

		it('a question this world answers keeps its sources, and each one is the sentence rather than the entry', async () => {
			const { owner, universe } = await world();
			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Which corner seat does Aldric Vane take?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('At the Gilded Rat.')),
				gateway: IDENTITY_GATEWAY
			});

			const aldric = result.sources.find(
				(s): s is OwnCanonSource => s.kind === 'own_canon' && s.entityName === 'Aldric Vane'
			);
			expect(aldric).toBeDefined();
			// The quote is the sentence that answers the question, not the entry's first line
			// and not the whole body. The entry's own body never says "Aldric Vane", so this
			// also pins the name-aware half of the bar: without it the floor would answer a
			// question about a character with nothing from that character's own page.
			expect(aldric!.statement).toBe('He still drinks at The Gilded Rat, in the corner seat.');
			expect(result.followUps.length).toBeGreaterThan(0);
		});

		it('a question this world has nothing to say about cites nothing at all, where the old top-six returned a full list', async () => {
			const { owner, universe } = await world();
			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				// One content word lands anywhere in this canon, `kind`, and it lands on Mother
				// Sennah in the other sense of the word. That is the shape of every coincidence
				// left after #346's content-word gate, and it is exactly what the bar removes.
				question: 'What kind of world is this?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('Nothing here answers that.')),
				gateway: IDENTITY_GATEWAY
			});

			expect(result.sources).toEqual([]);
			expect(result.followUps).toEqual([]);
		});

		it('the no-sources prompt says nothing supports the question and then allows general knowledge, in the AI-off path’s own words', async () => {
			const { owner, universe } = await world();
			let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
			await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'How far is the nearest dragon?',
				detailLevel: 'normal',
				locale: 'it',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(
					capturingStreamingModel('Niente nel tuo canone.', (options) => {
						captured = options;
					})
				),
				gateway: IDENTITY_GATEWAY
			});

			const system = systemPromptOf(captured!);
			// One vocabulary for the fact, in the asker's language, not a second one invented
			// for the AI-on branch.
			expect(system).toContain(READING_ONLY_FALLBACK.it);
			expect(system).toContain('from your own general knowledge');
			// Guardrail 7: the separation is instructed explicitly, not left to the model.
			expect(system).toContain('Never present a general-knowledge claim as canon');
		});

		it('a quoted sentence carries neither a [[mention]] nor a :::secret marker, and the AI-off answer quotes it as it stands', async () => {
			const { owner, universe } = await world();
			await db
				.update(universeTable)
				.set({ aiEnabled: false })
				.where(eq(universeTable.id, universe.id));

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'What second ledger of every bribe did Aldric Vane keep?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('should never be called')),
				gateway: IDENTITY_GATEWAY
			});

			const aldric = result.sources.find(
				(s): s is OwnCanonSource => s.kind === 'own_canon' && s.entityName === 'Aldric Vane'
			);
			expect(aldric).toBeDefined();
			expect(aldric!.statement).toBe('He kept a second ledger of every bribe he ever took.');
			for (const source of result.sources) {
				const quote = source.statement;
				expect(quote).not.toMatch(/\[\[|\]\]/);
				expect(quote).not.toMatch(/:::/);
			}
			expect(result.answer).not.toMatch(/\[\[|\]\]|:::/);
		});

		it('no similarity figure reaches the payload the UI renders, on either kind of source', async () => {
			const { owner, universe } = await world();
			let handed: AskSource[] = [];
			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Which corner seat does Aldric Vane take?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('At the Gilded Rat.')),
				gateway: IDENTITY_GATEWAY,
				onSources: (sources) => {
					handed = sources;
				}
			});

			// Guardrail 3 and D6: a number on the wire is a number a component can render, and
			// this is the one place it can be kept off the wire for good. Checked on both the
			// streamed payload and the returned result, because they are two separate reads of
			// the same array and a future change could diverge them.
			expect(handed.length).toBeGreaterThan(0);
			for (const source of [...handed, ...result.sources]) {
				expect(Object.keys(source)).not.toContain('score');
				expect(Object.values(source).every((v) => typeof v !== 'number')).toBe(true);
			}
			expect(JSON.stringify(result.sources)).not.toMatch(/"score"|"similarity"|"confidence"/);
		});
	});

	describe('issue #577: a possessive and its plain form are the same word to layer 1', () => {
		it('cites the entry whose own name carries the apostrophe when the GM types it without one', async () => {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Valdoria Reach'
			});
			// The sample world's own entry, verbatim. Its body never says "Smugglers", so the
			// name is the only place that word appears and `sharedWithQuestion`'s name-aware
			// half is the whole of the match: before #577 the question's `smugglers` and the
			// name's `smugglers'` were two unrelated tokens, the entry answered one content
			// word (`ledger`), and #535's floor of two dropped it.
			await insertEntity(db, universe.id, {
				type: 'item',
				name: "The Smugglers' Ledger",
				body: 'A ledger nobody at the table has read yet, kept by whoever is running goods through the Lantern Quarter that week.'
			});

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Tell me about the Smugglers Ledger.',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('Nobody admits to owning it.')),
				gateway: IDENTITY_GATEWAY
			});

			const source = result.sources.find(
				(s): s is OwnCanonSource =>
					s.kind === 'own_canon' && s.entityName === "The Smugglers' Ledger"
			);
			expect(source).toBeDefined();
			expect(source!.statement).toBe(
				'A ledger nobody at the table has read yet, kept by whoever is running goods through the Lantern Quarter that week.'
			);
		});

		it('and the other way round, when the apostrophe is in the question and not in the canon', async () => {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Valdoria Reach'
			});
			await insertEntity(db, universe.id, {
				type: 'item',
				name: 'The Smugglers Ledger',
				body: 'A ledger nobody at the table has read yet, kept by whoever is running goods that week.'
			});

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: "Tell me about the Smugglers' Ledger.",
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('Nobody admits to owning it.')),
				gateway: IDENTITY_GATEWAY
			});

			expect(
				result.sources.some(
					(s) => s.kind === 'own_canon' && s.entityName === 'The Smugglers Ledger'
				)
			).toBe(true);
		});

		it('ranks the entry that answers the question first, where a straight apostrophe used to lose to a typographic one', async () => {
			const owner = await insertUser(db);
			const universe = await insertHomebrewUniverse(db, {
				ownerUserId: owner.id,
				name: 'Valdoria Reach'
			});
			// Both of these sentences are the sample world's, and the difference between them
			// is punctuation a GM cannot see: Corvin Ashe's entry writes `Quarter's` with a
			// straight apostrophe, which the token pattern kept, and Session 3's recap writes
			// `Quarter\u2019s` with a typographic one, which was outside the pattern and so
			// already split into `quarter`. So the session recap answered four of the
			// question's content words and the entry that actually holds the debt answered
			// three, and the recap ranked first.
			await insertEntity(db, universe.id, {
				type: 'character',
				name: 'Corvin Ashe',
				body: "Factor of the Ashen Ledger. He holds most of the Lantern Quarter's debt and none of its affection."
			});
			await insertEntity(db, universe.id, {
				type: 'session',
				name: 'Session 2',
				body: 'Corvin Ashe was waiting on the steps afterwards, which is how the party learned who holds the Lantern Quarter\u2019s debt, and that La Casa dei Mercanti keeps its own book of the same loans.'
			});

			const result = await runAsk({
				db,
				userId: owner.id,
				universeId: universe.id,
				question: 'Who holds the debt of the Lantern Quarter?',
				detailLevel: 'normal',
				locale: 'en',
				vectorClient,
				embedder: hashingEmbedder,
				modelFactory: modelFactoryFor(streamingModel('Corvin Ashe.')),
				gateway: IDENTITY_GATEWAY
			});

			const own = result.sources.filter((s) => s.kind === 'own_canon');
			expect(own.map((s) => (s.kind === 'own_canon' ? s.entityName : ''))).toEqual([
				'Corvin Ashe',
				'Session 2'
			]);
		});
	});

	describe('quotedSentenceFromChunk (issue #535, the indexed half)', () => {
		const chunk =
			'The Ashen Ledger is a merchant bank in the Lantern Quarter. ' +
			'It lends at knife point and keeps better records than the magistrate. ' +
			'Its factor is a man nobody in the quarter will name aloud.';

		it('quotes the one sentence the question touched, never the whole chunk', () => {
			expect(quotedSentenceFromChunk(chunk, 'Who keeps records in the quarter?', 'en')).toBe(
				'It lends at knife point and keeps better records than the magistrate.'
			);
		});

		it('falls back to the chunk’s opening sentence when nothing in it shares a content word', () => {
			// The ordinary case for an embedding hit, which is the whole reason layer 2 exists:
			// it matched on meaning, not on words. An opening sentence names what the chunk is
			// about, and it is still a sentence, which the chunk is not.
			expect(quotedSentenceFromChunk(chunk, 'Quanto costa un cavallo?', 'it')).toBe(
				'The Ashen Ledger is a merchant bank in the Lantern Quarter.'
			);
		});

		it('never returns fence markup or mention syntax', () => {
			const fenced = ':::secret\nHe kept [[a second ledger]] of every bribe.\n:::';
			const quote = quotedSentenceFromChunk(fenced, 'What second ledger of bribes?', 'en');
			expect(quote).toBe('He kept a second ledger of every bribe.');
			expect(quote).not.toMatch(/\[\[|\]\]|:::/);
		});
	});
});

describe('mergeCarriedForwardOwnCanon (issue #439, T12)', () => {
	function source(entityId: string, entityName: string): OwnCanonSource {
		return {
			kind: 'own_canon',
			entityId,
			entityName,
			entitySlug: entityName.toLowerCase().replace(/\s+/g, '-'),
			statement: `${entityName}'s own statement.`
		};
	}

	it('appends carried-forward sources the fresh list is missing, each keeping its own entity attribution', () => {
		const fresh = [source('a', 'Aldric Vane')];
		const carried = [source('b', 'The Ashen Ledger'), source('c', 'Iselde Wrenn')];

		const merged = mergeCarriedForwardOwnCanon(fresh, carried);

		expect(merged.map((s) => s.entityName)).toEqual([
			'Aldric Vane',
			'The Ashen Ledger',
			'Iselde Wrenn'
		]);
		// Guardrail 3: a carried-forward source keeps naming its own real entry - nothing
		// about it is rewritten toward the question that triggered this turn.
		expect(merged[1]).toMatchObject({ entityId: 'b', entityName: 'The Ashen Ledger' });
		expect(merged[1]).toEqual(carried[0]);
	});

	it('never duplicates an entity the fresh list already found', () => {
		const fresh = [source('a', 'Aldric Vane')];
		const carried = [source('a', 'Aldric Vane'), source('b', 'The Ashen Ledger')];

		const merged = mergeCarriedForwardOwnCanon(fresh, carried);

		expect(merged.map((s) => s.entityId)).toEqual(['a', 'b']);
	});

	it('caps how many carried-forward sources ride along, however many the prior turn found', () => {
		const carried = ['b', 'c', 'd', 'e', 'f'].map((id) => source(id, id));

		const merged = mergeCarriedForwardOwnCanon([], carried);

		expect(merged).toHaveLength(CARRIED_FORWARD_LIMIT);
		expect(merged.map((s) => s.entityId)).toEqual(
			carried.slice(0, CARRIED_FORWARD_LIMIT).map((s) => s.entityId)
		);
	});

	it('returns the fresh array unchanged (same reference) when there is nothing to carry forward', () => {
		const fresh = [source('a', 'Aldric Vane')];

		expect(mergeCarriedForwardOwnCanon(fresh, [])).toBe(fresh);
	});
});
