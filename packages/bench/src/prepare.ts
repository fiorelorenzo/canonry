/**
 * Everything a benchmark or an end-to-end run needs to exist before it starts: the bench
 * user with credits, the bench universe, the corpus world seeded as canon, and that canon
 * indexed into Qdrant.
 *
 *   pnpm --filter @canonry/bench seed
 *
 * Split out of the runners so the premium model sweep and the Loremaster end-to-end run
 * measure the same world without one of them having to build it, and so a sweep that dies
 * halfway can be restarted without paying to embed thirty entries again.
 */
import { closeDb, createDb } from '@canonry/db';
import { resolveModel } from '@canonry/ai';
import { loadEnv, requireEnv } from './env.js';
import { benchFixture, topUpCredits } from './fixture.js';
import { seedWorld } from './corpus/seed.js';
import { indexCorpus } from './index-corpus.js';
import { worldV1 } from './corpus/valdoria-reach.js';

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	requireEnv('QDRANT_URL');

	const db = createDb(url, { max: 4, quiet: true });
	try {
		const fixture = await benchFixture(db);
		await topUpCredits(db);
		const seeded = await seedWorld(db, fixture.universeId, worldV1);
		const embedding = await resolveModel(db, 'embedding');
		const indexed = await indexCorpus(db, fixture.universeId);
		console.log(
			`universe ${fixture.universeId}: ${seeded.entities} entities, ${seeded.relations} relations`
		);
		if (seeded.droppedRelations.length > 0) {
			console.log(
				`  ${seeded.droppedRelations.length} relations the catalogue cannot express: ` +
					seeded.droppedRelations.join(', ')
			);
		}
		console.log(
			`indexed ${indexed.chunks} chunks at ${indexed.vectorSize} dimensions into ` +
				`${indexed.collection} with ${embedding.provider}/${embedding.modelId}`
		);
	} finally {
		await closeDb(db);
	}
}

await main();
