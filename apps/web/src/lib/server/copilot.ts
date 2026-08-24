/**
 * The composition root for `@canonry/copilot`'s injected seams (issue #53/#54/#55): a real
 * Qdrant client, a real query embedder, and the real `createLanguageModel` factory from
 * `@canonry/ai`'s composition root. One instance per process, mirroring `$lib/server/db`.
 *
 * The embedder resolves `model_config`'s `'embedding'` row and calls it through the gateway
 * (issue #125), so an Italian question reaches an English chunk - the §17 promise that a
 * bag-of-words vectoriser structurally cannot keep. It falls back to `hashingEmbedder` only
 * when there is no gateway credential at all, and says so on every call rather than degrading
 * quietly: a silent fallback here looks exactly like working retrieval while answering from
 * token overlap, which is the failure mode that hid this gap for a month.
 *
 * `modelFactory` has a second, dev-only branch for the same reason: this box (and every
 * dev box like it) has no `AI_GATEWAY_*` credentials, so the real branch always throws
 * `MissingGatewayEnvError` the moment a purpose is resolved. A propagation/audit trigger
 * that can never be exercised end to end - real browser save, real background job, real
 * pending proposals in the queue - is a trigger nobody can trust, including whoever reads
 * this file next. `COPILOT_DEV_MOCK_MODEL=1` swaps `modelFactory` to a
 * `MockLanguageModelV4`, the same seam and the same test double
 * `packages/copilot/src/propagate.test.ts`/`audit.test.ts` already use for a live model
 * call, so the loop this file wires - `planPropagation`/`runAudit` writing real
 * `proposal_plan`/`proposal` rows through the real `createProposalPlan` transaction - is
 * the loop actually proven, not a stand-in for it. `routeModel` (models.ts) keeps the
 * *resolved* provider/model id (whatever `model_config` names for the purpose, e.g.
 * `anthropic`/`claude-3-5-haiku-...`) separate from the injected `LanguageModel` instance,
 * so every proposal/model_call row this mock produces carries the same real provider and
 * model id a real call would - the one field genuinely different is token/credit
 * accounting (`usage` on a `MockLanguageModelV4` response is invented, not a real
 * tokenizer's count), which is a property of mocking any language model, not something
 * this seam can paper over; do not trust `model_call.input_tokens`/`credits` rows produced
 * this way for the cost metrics SPEC.md §14 cares about.
 *
 * Double-gated on purpose: `import.meta.env.DEV` (false in a production build, however the
 * env var is set) *and* the explicit env var (so a plain dev boot without it still gets
 * the real, credentialed branch). A production build can never reach the mock branch even
 * if `COPILOT_DEV_MOCK_MODEL` leaks into its environment.
 */
import {
	createEmbeddingModel,
	createLanguageModel,
	MissingGatewayEnvError,
	readGatewayCredentials,
	resolveModel,
	type GatewayCredentials
} from '@canonry/ai';
import { createVectorClient, type QdrantClient } from '@canonry/vector';
import { createGatewayEmbedder, hashingEmbedder } from '@canonry/indexing';
import type { GatewayWrapper, ModelFactory, QueryEmbedder } from '@canonry/copilot';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';

let vectorClientHandle: QdrantClient | undefined;

export function vectorClient(): QdrantClient {
	if (!vectorClientHandle) vectorClientHandle = createVectorClient();
	return vectorClientHandle;
}

/** `createLanguageModel` already gateway-wraps internally, so the `gateway` seam
 * `routeModel` still asks for is identity here - see packages/ai/src/composition.ts's own
 * header comment for why that wrapping moved into the factory rather than staying a
 * second step. */
const realModelFactory: ModelFactory = (resolved) =>
	createLanguageModel(resolved.provider, resolved.modelId);

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function devMockUsage(inputTotal: number, outputTotal: number) {
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

const DEV_MOCK_ANSWER =
	'This is the dev mock model, not the Loremaster. COPILOT_DEV_MOCK_MODEL=1 is set, so no ' +
	'request left this process: the retrieval, the conversation rows and this stream are all ' +
	'real, and only the words are canned.';

function devMockTextStream(text: string): ReadableStream {
	const words = text.split(' ');
	return new ReadableStream({
		start(controller) {
			controller.enqueue({ type: 'stream-start', warnings: [] });
			controller.enqueue({ type: 'text-start', id: 'dev-mock' });
			// One word per part rather than one part: the SSE route, `$lib/ask/stream.ts` and
			// the typing the GM actually watches are only exercised by a stream that arrives in
			// pieces, which is the half of Ask a single-chunk answer would still not reach.
			for (const [i, word] of words.entries()) {
				controller.enqueue({
					type: 'text-delta',
					id: 'dev-mock',
					delta: i === 0 ? word : ` ${word}`
				});
			}
			controller.enqueue({ type: 'text-end', id: 'dev-mock' });
			controller.enqueue({
				type: 'finish',
				finishReason: { unified: 'stop', raw: undefined },
				usage: devMockUsage(400, 60)
			});
			controller.close();
		}
	});
}

/**
 * What this covers, stated exactly, because the version before this one claimed the
 * Loremaster and reached everything except its main surface (#700).
 *
 * `doGenerate` answers the two `cheap` calls `planPropagation` and `runAudit` make, by
 * sniffing the prompt for which one it is and reading the real candidate ids back out of it
 * (the technique `packages/copilot/src/propagate.test.ts`'s own `dynamicRankingModel` uses),
 * and the `premium` structured calls in both shapes they come in: `{ summary, after }` for
 * `diffs.ts`, `complete.ts` and `ask-propose.ts`'s edit drafting, and `newEntitySchema` for
 * its new-entry drafting. `usedSources` is empty on both, since a mock has drawn on nothing;
 * the two schemas that do not declare it drop it.
 *
 * `doStream` is Ask. `runAsk` calls `streamText`, so a mock with only a `doGenerate` failed
 * the one surface it was most wanted for. A question that reads like a request to write canon
 * gets a first step that calls `entry_propose`, so the nested `newEntitySchema` drafting call
 * and the real `proposal` write behind it are exercised too, and a second step that answers;
 * anything else gets one streamed answer and no tool call.
 *
 * What it does not cover, and cannot:
 *
 * - Import. `$lib/server/onboarding.ts` builds its own `GatewayDriver` over
 *   `createLanguageModel` rather than going through `modelFactory`, so this env var does
 *   nothing to it.
 * - Embeddings, media and audio. Retrieval falls back to `hashingEmbedder` on its own when
 *   there is no credential (see this file's header), and Replicate and ElevenLabs are called
 *   directly rather than through the gateway.
 * - Token and credit accounting, per this file's header: the `usage` numbers below are made
 *   up.
 * - Any response a real model gets wrong: a truncated answer, an unexpected finish reason, a
 *   malformed tool call, a schema the model violates. Every branch here is a well-formed
 *   success by construction, so nothing that only happens on the failure paths can be
 *   reproduced with it. That is what the stub-gateway recipe in `AGENTS.md` is for.
 */
function devMockModel(purpose: string): LanguageModel {
	// `routeModel` is called once per Ask turn, so this counts the steps of one loop: the
	// first may call a tool, the second answers. The nested drafting call `entry_propose`
	// makes routes again and therefore gets its own instance and its own counter.
	let streamStep = 0;
	return new MockLanguageModelV4({
		provider: 'dev-mock',
		modelId: `dev-mock-${purpose}`,
		doStream: async (options) => {
			streamStep += 1;
			const promptText = JSON.stringify(options.prompt);
			// The GM's question, read off `Question: `, the last thing `runAsk` puts in the
			// prompt. Deliberately not the whole prompt: its system half names both tools and
			// instructs the model about proposing, so a verb matched there matches every turn.
			// Asking for canon to be written is what a real model answers with a tool call, so
			// the mock decides the same way it decides everything else, by reading the prompt.
			const question = /Question: ([^"\\]*)/.exec(promptText)?.[1] ?? '';
			const asksForCanon =
				purpose === 'premium' && /\b(propose|create|add|draft|write|invent)\b/i.test(question);
			if (streamStep === 1 && asksForCanon) {
				return {
					stream: new ReadableStream({
						start(controller) {
							controller.enqueue({ type: 'stream-start', warnings: [] });
							controller.enqueue({
								type: 'tool-call',
								toolCallId: 'dev-mock-tool-call',
								toolName: 'entry_propose',
								input: JSON.stringify({
									// Two or more capitalised words in a row, which is the name in "create an
									// entry for Corvin Ashe": enough that the proposal a GM gets back is about
									// what they asked for rather than being titled with their whole sentence,
									// and it falls back rather than guessing when the question names nobody.
									name:
										/\b([A-Z][\p{L}']+(?: [A-Z][\p{L}']+)+)/u.exec(question)?.[1] ??
										'A dev-mock entry',
									instruction: 'Drafted by the dev mock model, from the question the GM asked.'
								})
							});
							controller.enqueue({
								type: 'finish',
								finishReason: { unified: 'tool-calls', raw: undefined },
								usage: devMockUsage(400, 20)
							});
							controller.close();
						}
					})
				};
			}
			return { stream: devMockTextStream(DEV_MOCK_ANSWER) };
		},
		doGenerate: async (options) => {
			const promptText = JSON.stringify(options.prompt);
			if (purpose === 'premium') {
				// `aliases` is in `newEntitySchema` and in none of the other premium schemas, so
				// the requested response format is what tells the two shapes apart. The prompt's
				// own wording is the fallback, for the same reason the cheap branch below reads
				// the prompt at all: it is the one thing a mock is always handed.
				const wantsNewEntity =
					JSON.stringify(options.responseFormat ?? '').includes('"aliases"') ||
					promptText.includes('brand new wiki entry');
				const object = wantsNewEntity
					? {
							type: 'character',
							name: /Name: ([^"\\\n]+)/.exec(promptText)?.[1]?.trim() ?? 'A dev-mock entry',
							aliases: [],
							body: 'Drafted by the dev mock model. No model call left this process.',
							summary: 'Drafted by the dev mock model.',
							usedSources: []
						}
					: {
							summary: 'Drafted by the dev mock model.',
							after: 'Dev-mock drafted body.',
							usedSources: []
						};
				return {
					content: [{ type: 'text', text: JSON.stringify(object) }],
					finishReason: { unified: 'stop', raw: undefined },
					usage: devMockUsage(300, 200),
					warnings: []
				};
			}
			if (promptText.includes('disagree')) {
				const object = { disagree: true, topic: 'this does not add up' };
				return {
					content: [{ type: 'text', text: JSON.stringify(object) }],
					finishReason: { unified: 'stop', raw: undefined },
					usage: devMockUsage(60, 20),
					warnings: []
				};
			}
			const ids = Array.from(new Set(Array.from(promptText.matchAll(UUID_RE)).map((m) => m[0])));
			const object = {
				summary: `This change touches ${ids.length} entries.`,
				candidates: ids.map((id) => ({ entityId: id, rationale: 'Because it is affected.' }))
			};
			return {
				content: [{ type: 'text', text: JSON.stringify(object) }],
				finishReason: { unified: 'stop', raw: undefined },
				usage: devMockUsage(80, 40),
				warnings: []
			};
		}
	}) as unknown as LanguageModel;
}

const devMockModelFactory: ModelFactory = (resolved) => devMockModel(resolved.purpose);

const useDevMockModel = import.meta.env.DEV && env.COPILOT_DEV_MOCK_MODEL === '1';
if (useDevMockModel) {
	console.warn(
		'*** COPILOT_DEV_MOCK_MODEL=1: every Loremaster model call in this process is a MockLanguageModelV4, not a real AI Gateway call. Dev-only; unreachable from a production build. ***'
	);
}

export const modelFactory: ModelFactory = useDevMockModel ? devMockModelFactory : realModelFactory;

export const identityGateway: GatewayWrapper = (model) => model;

/**
 * Ask's retrieval embedder, per request rather than per process: `createGatewayEmbedder` records
 * every call against the asking user through `withUsage`, so a memoised instance would attribute
 * one user's embeddings to whoever happened to boot the singleton (the same reason
 * `embeddingProviderFor` in `$lib/server/media` is built per request).
 *
 * The fallback is deliberately noisy and deliberately not silent-by-default. A dev box with no
 * `AI_GATEWAY_API_KEY` still gets working retrieval, which is why `hashingEmbedder` exists at
 * all, but it answers from token overlap: an Italian question will not find an English chunk,
 * and every §17 claim is false while it is in play. Saying so per call is the point.
 */
export function queryEmbedderFor(userId: string, universeId: string | null): QueryEmbedder {
	let credentials: GatewayCredentials;
	try {
		credentials = readGatewayCredentials(env);
	} catch (error) {
		if (!(error instanceof MissingGatewayEnvError)) throw error;
		return async (texts) => {
			console.warn(
				`*** no ${error.varName}: Ask retrieval is falling back to hashingEmbedder, a bag-of-words ` +
					`vectoriser. Cross-language retrieval (SPEC.md §17) does not work in this process. ***`
			);
			return hashingEmbedder(texts);
		};
	}

	return async (texts) => {
		const resolved = await resolveModel(db(), 'embedding');
		const embedder = createGatewayEmbedder({
			db: db(),
			model: {
				...resolved,
				model: createEmbeddingModel(resolved.provider, resolved.modelId, credentials)
			},
			userId,
			universeId
		});
		return embedder(texts);
	};
}
