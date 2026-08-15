/**
 * The real embedding path, wired the way `apps/web/src/lib/server/copilot.ts` wires it,
 * minus the one thing that file does and the bench must not: falling back to
 * `hashingEmbedder` when no gateway credential is present.
 *
 * That fallback is right in the app (Ask still has to answer with layer one) and wrong
 * here. A bench that quietly swapped a 2560-dimension multilingual embedder for a 256-bin
 * bag of words would still produce a table, and every number in it would be about the
 * fallback. So this throws instead, and the failure names the reason.
 */
import {
	createEmbeddingModel,
	readGatewayCredentials,
	resolveModel,
	type ModelPurpose
} from '@canonry/ai';
import type { Db } from '@canonry/db';
import { createGatewayEmbedder } from '@canonry/indexing';
import type { QueryEmbedder } from '@canonry/copilot';
import { loadEnv, requireEnv } from './env.js';
import { BENCH_USER_ID } from './fixture.js';

const EMBEDDING: ModelPurpose = 'embedding';

export async function benchEmbedder(
	db: Db,
	universeId: string | null = null
): Promise<QueryEmbedder> {
	loadEnv();
	requireEnv('AI_GATEWAY_API_KEY');
	const credentials = readGatewayCredentials(process.env);
	const resolved = await resolveModel(db, EMBEDDING);

	return async (texts: string[]) => {
		const embedder = createGatewayEmbedder({
			db,
			model: {
				...resolved,
				model: createEmbeddingModel(resolved.provider, resolved.modelId, credentials)
			},
			userId: BENCH_USER_ID,
			universeId
		});
		return embedder(texts);
	};
}
