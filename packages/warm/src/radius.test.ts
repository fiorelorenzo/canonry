/**
 * Issue #102's acceptance criterion: "prove the radius governor with a test: below the
 * threshold it shrinks, above it it does not." `warmRadiusFor` is tested as a pure
 * function first (the actual decision boundary), then `warmOnConsumption` end to end
 * against a real universe with a seeded warm hit rate, since the governor only matters if
 * the trigger it feeds actually changes what it warms.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, type Db } from '@canonry/db';
import { warmArtifact } from '@canonry/db/schema';
import { openTestDb } from './test-db.js';
import { createInMemoryWarmBudgetPort, type WarmBudgetPort } from './budget.js';
import type { WarmGenerator } from './store.js';
import { warmOnConsumption } from './triggers.js';
import { currentWarmRadius, warmRadiusFor, WARM_RADIUS_HIT_RATE_THRESHOLD } from './radius.js';
import {
	createTestEntity,
	createTestRelation,
	createTestRevision,
	createTestUniverse,
	createTestUser
} from './test-helpers.js';

const db = openTestDb();

afterAll(async () => {
	await closeDb(db);
});

function bigBudget(): WarmBudgetPort {
	return createInMemoryWarmBudgetPort(1_000_000);
}

function recordingGenerator(): { generator: WarmGenerator; kinds: string[] } {
	const kinds: string[] = [];
	const generator: WarmGenerator = async (candidate) => {
		kinds.push(candidate.kind);
		return { payload: { kind: candidate.kind, subject: candidate.subjectEntityId } };
	};
	return { generator, kinds };
}

async function seedUniverse(): Promise<{ universeId: string }> {
	const userId = await createTestUser(db);
	const universeId = await createTestUniverse(db, userId);
	return { universeId };
}

/** Inserts `generated` warm_artifact rows for a universe, `consumed` of them carrying one
 * consumption each, so the resulting hit rate is `consumed / generated` exactly. Bypasses
 * `regenerate`/a generator entirely - this test controls the hit rate directly rather than
 * simulating the consumption events that would produce it. */
async function seedWarmHitRate(
	db: Db,
	universeId: string,
	input: { generated: number; consumed: number }
): Promise<void> {
	const rows = Array.from({ length: input.generated }, (_, index) => ({
		universeId,
		kind: 'brief' as const,
		subjectEntityId: null,
		payload: {},
		fingerprint: `radius-test-${universeId}-${index}`,
		consumedCount: index < input.consumed ? 1 : 0
	}));
	await db.insert(warmArtifact).values(rows);
}

/** Same graph shape as triggers.test.ts's trigger 4 case: place -> faction (hop 1) ->
 * {npc, adjacentPlace} (hop 2), so hop-1 and hop-2 candidate sets are unambiguous and
 * disjoint. */
async function seedRingGraph(universeId: string): Promise<{ placeId: string }> {
	const place = await createTestEntity(db, { universeId, type: 'place' });
	const faction = await createTestEntity(db, { universeId, type: 'faction' });
	const adjacentPlace = await createTestEntity(db, { universeId, type: 'place' });
	const npc = await createTestEntity(db, { universeId, type: 'character' });
	for (const id of [place, faction, adjacentPlace, npc]) {
		await createTestRevision(db, { universeId, entityId: id });
	}
	await createTestRelation(db, {
		universeId,
		fromEntityId: faction,
		toEntityId: place,
		label: 'located in'
	});
	await createTestRelation(db, {
		universeId,
		fromEntityId: npc,
		toEntityId: faction,
		label: 'member of'
	});
	await createTestRelation(db, {
		universeId,
		fromEntityId: faction,
		toEntityId: adjacentPlace,
		label: 'located in'
	});
	return { placeId: place };
}

describe('warmRadiusFor (pure decision)', () => {
	it('shrinks to ring 1 below the threshold', () => {
		expect(warmRadiusFor(WARM_RADIUS_HIT_RATE_THRESHOLD - 0.01)).toBe(1);
		expect(warmRadiusFor(0)).toBe(1);
	});

	it('stays at ring 2 at or above the threshold', () => {
		expect(warmRadiusFor(WARM_RADIUS_HIT_RATE_THRESHOLD)).toBe(2);
		expect(warmRadiusFor(WARM_RADIUS_HIT_RATE_THRESHOLD + 0.01)).toBe(2);
		expect(warmRadiusFor(1)).toBe(2);
	});

	it('stays at ring 2 with no data yet, rather than punishing a universe with no history', () => {
		expect(warmRadiusFor(null)).toBe(2);
	});
});

describe('currentWarmRadius (reads the real hit rate)', () => {
	it('reports ring 1 and the hit rate that chose it, below threshold', async () => {
		const { universeId } = await seedUniverse();
		await seedWarmHitRate(db, universeId, { generated: 10, consumed: 1 }); // 10%

		const decision = await currentWarmRadius(db, universeId);

		expect(decision.hitRate).toBeCloseTo(0.1, 5);
		expect(decision.radius).toBe(1);
		expect(decision.generated).toBe(10);
		expect(decision.consumed).toBe(1);
	});

	it('reports ring 2 at or above threshold', async () => {
		const { universeId } = await seedUniverse();
		await seedWarmHitRate(db, universeId, { generated: 10, consumed: 5 }); // 50%

		const decision = await currentWarmRadius(db, universeId);

		expect(decision.hitRate).toBeCloseTo(0.5, 5);
		expect(decision.radius).toBe(2);
	});

	it('reports ring 2 with a null hit rate for a universe with nothing generated yet', async () => {
		const { universeId } = await seedUniverse();

		const decision = await currentWarmRadius(db, universeId);

		expect(decision.hitRate).toBeNull();
		expect(decision.radius).toBe(2);
	});
});

describe('warmOnConsumption honours the governed radius', () => {
	it('warms only ring 2 (hop 2) when the hit rate is at or above threshold', async () => {
		const { universeId } = await seedUniverse();
		const { placeId } = await seedRingGraph(universeId);
		await seedWarmHitRate(db, universeId, { generated: 10, consumed: 5 }); // 50%, above threshold

		const { generator, kinds } = recordingGenerator();
		const results = await warmOnConsumption(
			db,
			{
				universeId,
				enteredPlaceEntityId: placeId,
				promptVersion: 'v1',
				modelId: 'm1',
				briefCredits: 1
			},
			generator,
			bigBudget()
		);

		// npc and adjacentPlace, both hop 2 - not faction (hop 1).
		expect(kinds).toHaveLength(2);
		expect(results.every((r) => r.status === 'generated')).toBe(true);
	});

	it('shrinks to ring 1 (hop 1) when the hit rate is below threshold', async () => {
		const { universeId } = await seedUniverse();
		const { placeId } = await seedRingGraph(universeId);
		await seedWarmHitRate(db, universeId, { generated: 10, consumed: 1 }); // 10%, below threshold

		const { generator, kinds } = recordingGenerator();
		const results = await warmOnConsumption(
			db,
			{
				universeId,
				enteredPlaceEntityId: placeId,
				promptVersion: 'v1',
				modelId: 'm1',
				briefCredits: 1
			},
			generator,
			bigBudget()
		);

		// Only faction, hop 1 - the governor pulled the reach in from hop 2.
		expect(kinds).toEqual(['brief']);
		expect(results).toHaveLength(1);
	});
});
