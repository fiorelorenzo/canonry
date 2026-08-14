import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq } from '@canonry/db';
import { entity } from '@canonry/db/schema';
import { openTestDb } from './test-db.js';
import { createInMemoryWarmBudgetPort } from './budget.js';
import type { WarmBudgetPort } from './budget.js';
import { checkFreshness, regenerate, type WarmCandidate, type WarmGenerator } from './store.js';
import {
	createTestEntity,
	createTestRevision,
	createTestUniverse,
	createTestUser
} from './test-helpers.js';

const db = openTestDb();

afterAll(async () => {
	await closeDb(db);
});

async function briefCandidate(
	universeId: string,
	entityId: string,
	credits = 2
): Promise<WarmCandidate> {
	return {
		universeId,
		kind: 'brief',
		subjectEntityId: entityId,
		sourceEntityIds: [entityId],
		promptVersion: 'brief-v1',
		modelId: 'test-model',
		credits
	};
}

function countingGenerator(): { generator: WarmGenerator; calls: () => number } {
	let calls = 0;
	const generator: WarmGenerator = async (candidate) => {
		calls += 1;
		return { payload: { text: `brief for ${candidate.subjectEntityId}`, call: calls } };
	};
	return { generator, calls: () => calls };
}

function bigBudget(): WarmBudgetPort {
	return createInMemoryWarmBudgetPort(1_000_000);
}

describe('checkFreshness and regenerate: fingerprint + lazy invalidation', () => {
	it('generates once, is fresh on a second check with no new revision, and does not call the generator again', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const placeId = await createTestEntity(db, { universeId, type: 'place' });
		await createTestRevision(db, { universeId, entityId: placeId });

		const candidate = await briefCandidate(universeId, placeId);
		const { generator, calls } = countingGenerator();
		const budget = bigBudget();

		const first = await regenerate(db, candidate, generator, budget);
		expect(first.status).toBe('generated');
		expect(calls()).toBe(1);

		const second = await regenerate(db, candidate, generator, budget);
		expect(second.status).toBe('fresh');
		expect(calls()).toBe(1); // never called again
		expect(second.artifact?.id).toBe(first.artifact?.id);
	});

	it('a fingerprint changes when the source revision changes, and not otherwise', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const placeId = await createTestEntity(db, { universeId, type: 'place' });
		await createTestRevision(db, { universeId, entityId: placeId });

		const candidateArgs = {
			universeId,
			kind: 'brief' as const,
			subjectEntityId: placeId,
			sourceEntityIds: [placeId],
			promptVersion: 'brief-v1',
			modelId: 'test-model'
		};

		const before = await checkFreshness(db, candidateArgs);
		// Repeating the check with nothing changed reproduces the same fingerprint.
		const beforeAgain = await checkFreshness(db, candidateArgs);
		expect(beforeAgain.fingerprint).toBe(before.fingerprint);

		await createTestRevision(db, { universeId, entityId: placeId });
		const after = await checkFreshness(db, candidateArgs);
		expect(after.fingerprint).not.toBe(before.fingerprint);
	});

	it('a stale artifact survives until a trigger regenerates it - editing does not regenerate on the spot', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const placeId = await createTestEntity(db, { universeId, type: 'place' });
		await createTestRevision(db, { universeId, entityId: placeId });

		const candidate = await briefCandidate(universeId, placeId);
		const { generator, calls } = countingGenerator();
		const budget = bigBudget();

		const generated = await regenerate(db, candidate, generator, budget);
		expect(generated.status).toBe('generated');
		const originalPayload = generated.artifact?.payload;

		// Simulate an edit: a new revision lands on the source entity. Nothing in this
		// package regenerates in response - only a `checkFreshness` call (which a trigger
		// would make) marks the row stale.
		await createTestRevision(db, { universeId, entityId: placeId });
		expect(calls()).toBe(1);

		const freshness = await checkFreshness(db, candidate);
		expect(freshness.fresh).toBe(false);
		expect(calls()).toBe(1); // checking freshness never regenerates

		expect(freshness.artifact?.stale).toBe(true);
		expect(freshness.artifact?.payload).toEqual(originalPayload); // still the old content

		// Only when a trigger actually calls `regenerate` does new material get produced.
		const regenerated = await regenerate(db, candidate, generator, budget);
		expect(regenerated.status).toBe('generated');
		expect(calls()).toBe(2);
		expect(regenerated.artifact?.fingerprint).not.toBe(generated.artifact?.fingerprint);
	});
});

describe('regenerate: npc_draft lands as a proposal, never as an entity', () => {
	it('creates a pending draft_entity proposal and no entity row', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const placeId = await createTestEntity(db, {
			universeId,
			type: 'place',
			name: 'The Salt Market'
		});
		await createTestRevision(db, { universeId, entityId: placeId });

		const candidate: WarmCandidate = {
			universeId,
			kind: 'npc_draft',
			subjectEntityId: placeId,
			sourceEntityIds: [placeId],
			promptVersion: 'npc-v1#slot-1',
			modelId: 'test-model',
			credits: 5,
			rationale: 'Prep drafted a candidate NPC for this place.'
		};
		const draftName = `Warm Draft NPC ${Date.now()}`;
		const generator: WarmGenerator = async () => ({
			payload: { name: draftName },
			draftEntity: {
				name: draftName,
				type: 'character',
				body: 'A dockhand who knows everyone at the market.',
				aliases: [],
				evidence: { subjectEntityId: placeId, span: 'generated for prep' }
			}
		});

		const result = await regenerate(db, candidate, generator, bigBudget());
		expect(result.status).toBe('generated');
		expect(result.proposal).toBeDefined();
		expect(result.proposal?.kind).toBe('draft_entity');
		expect(result.proposal?.trigger).toBe('table');
		expect(result.proposal?.outcome).toBe('pending');
		expect(result.proposal?.universeId).toBe(universeId);

		const patch = result.proposal?.patch as { name: string };
		expect(patch.name).toBe(draftName);

		const entityRows = await db.select().from(entity).where(eq(entity.name, draftName));
		expect(entityRows).toHaveLength(0);
	});
});

describe('regenerate: budget degradation', () => {
	it('refuses when the budget denies it, without calling the generator or persisting anything', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const placeId = await createTestEntity(db, { universeId, type: 'place' });
		await createTestRevision(db, { universeId, entityId: placeId });

		const candidate = await briefCandidate(universeId, placeId, 10);
		const { generator, calls } = countingGenerator();
		const refusingBudget: WarmBudgetPort = {
			allow: async () => false,
			spend: async () => false
		};

		const result = await regenerate(db, candidate, generator, refusingBudget);
		expect(result.status).toBe('degraded');
		expect(calls()).toBe(0);
		expect(result.artifact).toBeNull();
	});

	it('discards the generated result when spend fails after allow passed, rather than storing it unpaid', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const placeId = await createTestEntity(db, { universeId, type: 'place' });
		await createTestRevision(db, { universeId, entityId: placeId });

		const candidate = await briefCandidate(universeId, placeId, 10);
		const { generator } = countingGenerator();
		const raceBudget: WarmBudgetPort = {
			allow: async () => true,
			spend: async () => false
		};

		const result = await regenerate(db, candidate, generator, raceBudget);
		expect(result.status).toBe('degraded');
		expect(result.artifact).toBeNull();
	});
});
