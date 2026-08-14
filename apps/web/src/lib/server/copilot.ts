/**
 * The composition root for `@canonry/copilot`'s injected seams (issue #53/#54/#55): a real
 * Qdrant client, a real query embedder, and the real `createLanguageModel` factory from
 * `@canonry/ai`'s composition root. One instance per process, mirroring `$lib/server/db`.
 *
 * The embedder uses `hashingEmbedder` from `@canonry/indexing` rather than a real
 * gateway-backed embedding model: this deploys without `AI_GATEWAY_*` credentials
 * configured (dev boxes, this one included), and `hashingEmbedder` is exactly what
 * packages/indexing's own retrieval-eval test uses for the same reason - a real,
 * deterministic bag-of-words vectoriser, not a stub standing in for missing behaviour.
 * Swapping to `createGatewayEmbedder` once real credentials exist changes nothing else,
 * since both satisfy the same `Embedder` seam.
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
import { createLanguageModel } from '@canonry/ai';
import { createVectorClient, type QdrantClient } from '@canonry/vector';
import { hashingEmbedder } from '@canonry/indexing';
import type { GatewayWrapper, ModelFactory, QueryEmbedder } from '@canonry/copilot';
import { env } from '$env/dynamic/private';
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

/** Answers every `cheap`-purpose call `planPropagation`/`runAudit` make by sniffing the
 * prompt text for which one it is (same technique
 * `packages/copilot/src/propagate.test.ts`'s own `dynamicRankingModel` uses: read the real
 * candidate ids back out of the prompt rather than hand-picking an answer), and a
 * `premium`-purpose call with a fixed drafted body in case the plan page's own "Generate
 * diffs" action gets exercised too. */
function devMockModel(purpose: string): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'dev-mock',
		modelId: `dev-mock-${purpose}`,
		doGenerate: async (options) => {
			const promptText = JSON.stringify(options.prompt);
			if (purpose === 'premium') {
				const object = {
					summary: 'Drafted by the dev mock model.',
					after: 'Dev-mock drafted body.'
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

export const queryEmbedder: QueryEmbedder = hashingEmbedder;
