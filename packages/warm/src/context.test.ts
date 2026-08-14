/**
 * #72's acceptance criterion: "the instant-lane query for Valdoria returns its pinned
 * characters in a time you measure and quote." Builds the relevant slice of the Valdoria
 * fixture (docs/ux/SAMPLE-WORLD.md / packages/db/src/seed-fixture.ts: Valdoria, the Watch,
 * the Gilded Rat, Aldric Vane, Mother Sennah) through this package's own test helpers
 * rather than importing `seedFixture` across the package boundary - `seed-fixture.ts` does
 * not export its entity/relation arrays, and @canonry/eval's own Valdoria Reach corpus
 * follows the same "duplicated, not imported" rule for the same reason (see
 * packages/eval/src/propagation/corpus/valdoria-reach.ts). The full fixture-seeded
 * database is exercised separately for this same query - see the PR notes for the real
 * measurement against `pnpm --filter @canonry/db seed`'s output.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, pinnedNeighbors, runningSessionContext } from '@canonry/db';
import { sessionContext } from '@canonry/db/schema';
import { openTestDb } from './test-db.js';
import { declareContextAndPin } from './context.js';
import {
	createTestEntity,
	createTestRelation,
	createTestUniverse,
	createTestUser
} from './test-helpers.js';

const db = openTestDb();

// SPEC §8's instant lane budget.
const INSTANT_LANE_BUDGET_MS = 100;

afterAll(async () => {
	await closeDb(db);
});

async function seedValdoria(): Promise<{
	universeId: string;
	valdoriaId: string;
	cairnmouthId: string;
}> {
	const userId = await createTestUser(db);
	const universeId = await createTestUniverse(db, userId);

	const valdoriaId = await createTestEntity(db, { universeId, type: 'place', name: 'Valdoria' });
	const cairnmouthId = await createTestEntity(db, {
		universeId,
		type: 'place',
		name: 'Cairnmouth'
	});
	const gildedRatId = await createTestEntity(db, {
		universeId,
		type: 'place',
		name: 'The Gilded Rat'
	});
	const watchId = await createTestEntity(db, {
		universeId,
		type: 'faction',
		name: 'The Valdoria Watch'
	});
	const aldricId = await createTestEntity(db, {
		universeId,
		type: 'character',
		name: 'Aldric Vane'
	});
	const sennahId = await createTestEntity(db, {
		universeId,
		type: 'character',
		name: 'Mother Sennah'
	});

	await createTestRelation(db, {
		universeId,
		fromEntityId: watchId,
		toEntityId: valdoriaId,
		label: 'located in'
	});
	await createTestRelation(db, {
		universeId,
		fromEntityId: gildedRatId,
		toEntityId: valdoriaId,
		label: 'located in'
	});
	await createTestRelation(db, {
		universeId,
		fromEntityId: aldricId,
		toEntityId: watchId,
		label: 'member of'
	});
	await createTestRelation(db, {
		universeId,
		fromEntityId: sennahId,
		toEntityId: gildedRatId,
		label: 'owns'
	});

	return { universeId, valdoriaId, cairnmouthId };
}

describe('instant lane: pinnedNeighbors for Valdoria', () => {
	it("pins Valdoria's characters within the instant lane budget - timed and quoted", async () => {
		const { valdoriaId } = await seedValdoria();

		const started = performance.now();
		const pinned = await pinnedNeighbors(db, valdoriaId);
		const elapsedMs = performance.now() - started;

		console.log(
			`pinnedNeighbors(Valdoria) took ${elapsedMs.toFixed(3)}ms for ${pinned.length} neighbors`
		);

		expect(elapsedMs).toBeLessThan(INSTANT_LANE_BUDGET_MS);

		const characterNames = pinned
			.filter((n) => n.entity.type === 'character')
			.map((n) => n.entity.name)
			.sort();
		expect(characterNames).toEqual(['Aldric Vane', 'Mother Sennah']);

		const placeNames = pinned.filter((n) => n.entity.type === 'place').map((n) => n.entity.name);
		expect(placeNames).toEqual(['The Gilded Rat']);
	});
});

describe('declareContextAndPin', () => {
	it('sets session_context and pins in one call, with exactly one running context per universe', async () => {
		const { universeId, valdoriaId, cairnmouthId } = await seedValdoria();

		const first = await declareContextAndPin(db, {
			universeId,
			placeEntityId: valdoriaId,
			moment: 'dusk, the tide is out'
		});
		expect(first.context.placeEntityId).toBe(valdoriaId);
		expect(first.pinned.map((n) => n.entity.name).sort()).toEqual([
			'Aldric Vane',
			'Mother Sennah',
			'The Gilded Rat',
			'The Valdoria Watch'
		]);

		// Declaring a second context (the party moved) ends the first rather than stacking.
		const second = await declareContextAndPin(db, { universeId, placeEntityId: cairnmouthId });
		expect(second.context.id).not.toBe(first.context.id);

		const running = await runningSessionContext(db, universeId);
		expect(running?.id).toBe(second.context.id);

		const stillRunningRows = await db
			.select()
			.from(sessionContext)
			.where(and(eq(sessionContext.universeId, universeId), isNull(sessionContext.endedAt)));
		expect(stillRunningRows).toHaveLength(1); // the schema-enforced invariant, held
	});

	it('pins nothing (but still declares) when no place is given', async () => {
		const { universeId } = await seedValdoria();
		const result = await declareContextAndPin(db, { universeId, situation: 'between scenes' });
		expect(result.context.placeEntityId).toBeNull();
		expect(result.pinned).toEqual([]);
	});
});
