import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, declareSessionContext, eq, latestArtifact } from '@canonry/db';
import { universe } from '@canonry/db/schema';
import { openTestDb } from './test-db.js';
import { createInMemoryWarmBudgetPort, type WarmBudgetPort } from './budget.js';
import { checkFreshness, regenerate, type WarmGenerator } from './store.js';
import {
	AiDisabledError,
	WriteDebounce,
	warmOnConsumption,
	warmOnPrep,
	warmOnTableOpen,
	warmOnWrite,
	warmNightly
} from './triggers.js';
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

function recordingGenerator(): { generator: WarmGenerator; kinds: string[] } {
	const kinds: string[] = [];
	const generator: WarmGenerator = async (candidate) => {
		kinds.push(candidate.kind);
		if (candidate.kind === 'npc_draft') {
			return {
				payload: { drafted: true },
				draftEntity: {
					name: `Draft for ${candidate.subjectEntityId}-${kinds.length}`,
					type: 'character',
					body: 'A warm-generated candidate.',
					aliases: [],
					evidence: {}
				}
			};
		}
		return { payload: { kind: candidate.kind, subject: candidate.subjectEntityId } };
	};
	return { generator, kinds };
}

function bigBudget(): WarmBudgetPort {
	return createInMemoryWarmBudgetPort(1_000_000);
}

async function seedUniverse(): Promise<{ userId: string; universeId: string }> {
	const userId = await createTestUser(db);
	const universeId = await createTestUniverse(db, userId);
	return { userId, universeId };
}

describe('trigger 1: warmOnWrite', () => {
	it('produces cheap text only - brief and context_pack - for the written entity', async () => {
		const { universeId } = await seedUniverse();
		const placeId = await createTestEntity(db, { universeId, type: 'place' });
		await createTestRevision(db, { universeId, entityId: placeId });

		const { generator, kinds } = recordingGenerator();
		const results = await warmOnWrite(
			db,
			{
				universeId,
				entityId: placeId,
				promptVersion: 'v1',
				modelId: 'm1',
				briefCredits: 1,
				contextPackCredits: 2,
				locale: 'en'
			},
			generator,
			bigBudget()
		);

		expect(results.every((r) => r.status === 'generated')).toBe(true);
		expect(kinds.sort()).toEqual(['brief', 'context_pack']);
	});
});

describe('WriteDebounce: ~60s coalescing', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fires once after 60s of quiet even with several edits in between', () => {
		const debounce = new WriteDebounce();
		let fires = 0;
		debounce.schedule('entity-1', () => (fires += 1));
		vi.advanceTimersByTime(30_000);
		debounce.schedule('entity-1', () => (fires += 1)); // resets the timer
		vi.advanceTimersByTime(30_000);
		expect(fires).toBe(0); // only 30s of quiet since the last edit
		vi.advanceTimersByTime(30_000);
		expect(fires).toBe(1);
	});

	it('tracks entities independently', () => {
		const debounce = new WriteDebounce();
		debounce.schedule('a', () => {});
		debounce.schedule('b', () => {});
		expect(debounce.pendingCount).toBe(2);
		debounce.cancel('a');
		expect(debounce.pendingCount).toBe(1);
	});
});

describe('trigger 2: warmOnPrep', () => {
	it('produces 3 npc drafts per expected place, an ambient pack per place, and portraits for pinned NPCs', async () => {
		const { universeId } = await seedUniverse();
		const placeA = await createTestEntity(db, { universeId, type: 'place' });
		const placeB = await createTestEntity(db, { universeId, type: 'place' });
		const npc = await createTestEntity(db, { universeId, type: 'character' });
		for (const id of [placeA, placeB, npc])
			await createTestRevision(db, { universeId, entityId: id });

		const { generator, kinds } = recordingGenerator();
		const results = await warmOnPrep(
			db,
			{
				universeId,
				expectedPlaceEntityIds: [placeA, placeB],
				pinnedNpcEntityIds: [npc],
				promptVersion: 'v1',
				modelId: 'm1',
				npcDraftCredits: 5,
				ambientPackCredits: 3,
				portraitCredits: 4,
				locale: 'en'
			},
			generator,
			bigBudget()
		);

		expect(kinds.filter((k) => k === 'npc_draft')).toHaveLength(6); // 3 per place x 2 places
		expect(kinds.filter((k) => k === 'ambient_pack')).toHaveLength(2);
		expect(kinds.filter((k) => k === 'portrait')).toHaveLength(1);

		const proposals = results.filter((r) => r.proposal);
		expect(proposals).toHaveLength(6); // one draft_entity proposal per npc_draft
		expect(proposals.every((r) => r.proposal?.outcome === 'pending')).toBe(true);
	});
});

describe('trigger 3: warmOnTableOpen', () => {
	it('warms ring 1 around the current place, and only if not already fresh', async () => {
		const { universeId } = await seedUniverse();
		const place = await createTestEntity(db, { universeId, type: 'place', name: 'Valdoria' });
		const faction = await createTestEntity(db, { universeId, type: 'faction' });
		const npc = await createTestEntity(db, { universeId, type: 'character' });
		for (const id of [place, faction, npc])
			await createTestRevision(db, { universeId, entityId: id });
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

		const { generator, kinds } = recordingGenerator();
		const budget = bigBudget();
		const input = {
			universeId,
			placeEntityId: place,
			promptVersion: 'v1',
			modelId: 'm1',
			briefCredits: 1,
			contextPackCredits: 2,
			locale: 'en' as const
		};

		const first = await warmOnTableOpen(db, input, generator, budget);
		// Ring 1 from `place` is only `faction` (npc is 2 hops away via faction), plus the
		// spanning context pack for the place itself.
		expect(kinds.sort()).toEqual(['brief', 'context_pack']);
		expect(first.every((r) => r.status === 'generated')).toBe(true);

		const second = await warmOnTableOpen(db, input, generator, budget);
		expect(second.every((r) => r.status === 'fresh')).toBe(true);
		expect(kinds).toHaveLength(2); // generator was not called again
	});
});

describe('trigger 4: warmOnConsumption', () => {
	it('warms only the next ring (hop 2) beyond the place just entered, cheap text only', async () => {
		const { universeId } = await seedUniverse();
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
		// adjacentPlace only reachable through the faction (hop 2), never hop 1.
		await createTestRelation(db, {
			universeId,
			fromEntityId: faction,
			toEntityId: adjacentPlace,
			label: 'located in'
		});

		const { generator, kinds } = recordingGenerator();
		const results = await warmOnConsumption(
			db,
			{
				universeId,
				enteredPlaceEntityId: place,
				promptVersion: 'v1',
				modelId: 'm1',
				briefCredits: 1,
				locale: 'en'
			},
			generator,
			bigBudget()
		);

		expect(kinds.every((k) => k === 'brief')).toBe(true);
		expect(kinds).toHaveLength(2); // npc and adjacentPlace, both at hop 2 - not faction (hop 1)
		expect(results.every((r) => r.status === 'generated')).toBe(true);
	});
});

describe('trigger 5: warmNightly', () => {
	it('recomposes stale artifacts only for universes active in the window, within budget', async () => {
		const activeUniverse = (await seedUniverse()).universeId;
		const inactiveUniverse = (await seedUniverse()).universeId;

		const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
		const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

		const activePlace = await createTestEntity(db, { universeId: activeUniverse, type: 'place' });
		const inactivePlace = await createTestEntity(db, {
			universeId: inactiveUniverse,
			type: 'place'
		});
		await createTestRevision(db, { universeId: activeUniverse, entityId: activePlace });
		// The inactive universe's whole history predates the 30-day nightly window - both its
		// initial revision and the edit that later makes it stale are backdated, so nothing
		// about this universe happened recently, which is the point being tested.
		await createTestRevision(db, {
			universeId: inactiveUniverse,
			entityId: inactivePlace,
			createdAt: sixtyDaysAgo
		});

		// A running session_context is this test's other "active in the last N days" signal.
		await declareSessionContext(db, { universeId: activeUniverse, placeEntityId: activePlace });

		const { generator } = recordingGenerator();
		const budget = bigBudget();

		// Warm both, then edit the source so both become stale.
		const activeCandidate = {
			universeId: activeUniverse,
			kind: 'brief' as const,
			subjectEntityId: activePlace,
			sourceEntityIds: [activePlace],
			promptVersion: 'v1',
			modelId: 'm1',
			credits: 1
		};
		const inactiveCandidate = {
			...activeCandidate,
			universeId: inactiveUniverse,
			subjectEntityId: inactivePlace,
			sourceEntityIds: [inactivePlace]
		};

		await regenerate(db, activeCandidate, generator, budget);
		await regenerate(db, inactiveCandidate, generator, budget);
		await createTestRevision(db, { universeId: activeUniverse, entityId: activePlace });
		await createTestRevision(db, {
			universeId: inactiveUniverse,
			entityId: inactivePlace,
			createdAt: fortyFiveDaysAgo
		});
		// Mark both stale the same way a trigger's checkFreshness would.
		await checkFreshness(db, activeCandidate);
		await checkFreshness(db, inactiveCandidate);

		const results = await warmNightly(
			db,
			{ sinceDays: 30, promptVersion: 'v1', modelId: 'm1', creditsFor: () => 1 },
			generator,
			budget
		);

		expect(results.has(activeUniverse)).toBe(true);
		expect(results.has(inactiveUniverse)).toBe(false);

		const activeArtifact = await latestArtifact(db, {
			universeId: activeUniverse,
			kind: 'brief',
			subjectEntityId: activePlace
		});
		expect(activeArtifact?.stale).toBe(false); // recomposed

		const inactiveArtifact = await latestArtifact(db, {
			universeId: inactiveUniverse,
			kind: 'brief',
			subjectEntityId: inactivePlace
		});
		expect(inactiveArtifact?.stale).toBe(true); // never touched - universe was not active
	});
});

describe('budget degradation across a trigger batch', () => {
	it('stops media first, then drafts, and keeps producing text - never overspends', async () => {
		const { universeId } = await seedUniverse();
		const place = await createTestEntity(db, { universeId, type: 'place' });
		const npc = await createTestEntity(db, { universeId, type: 'character' });
		for (const id of [place, npc]) await createTestRevision(db, { universeId, entityId: id });

		// A tight budget: one draft (5) and one portrait (5) together exceed it, but the
		// text candidates (1 each) always fit.
		const budget = createInMemoryWarmBudgetPort(10);
		const { generator } = recordingGenerator();

		const results = await warmOnPrep(
			db,
			{
				universeId,
				expectedPlaceEntityIds: [place],
				pinnedNpcEntityIds: [npc],
				promptVersion: 'v1',
				modelId: 'm1',
				npcDraftCredits: 5,
				ambientPackCredits: 5,
				portraitCredits: 5,
				locale: 'en'
			},
			generator,
			budget
		);

		const statusesByKind = new Map(results.map((r, i) => [i, r.status]));
		expect([...statusesByKind.values()].some((s) => s === 'degraded')).toBe(true);
		expect(budget.spent).toBeLessThanOrEqual(10);
	});
});

describe('AI switched off (guardrail 4, issue #107): warm triggers do not fire', () => {
	async function seedDisabledUniverse(): Promise<{ userId: string; universeId: string }> {
		const { userId, universeId } = await seedUniverse();
		await db.update(universe).set({ aiEnabled: false }).where(eq(universe.id, universeId));
		return { userId, universeId };
	}

	it('warmOnWrite refuses before building a single candidate', async () => {
		const { universeId } = await seedDisabledUniverse();
		const placeId = await createTestEntity(db, { universeId, type: 'place' });
		await createTestRevision(db, { universeId, entityId: placeId });
		const { generator, kinds } = recordingGenerator();

		await expect(
			warmOnWrite(
				db,
				{
					universeId,
					entityId: placeId,
					promptVersion: 'v1',
					modelId: 'm1',
					briefCredits: 1,
					contextPackCredits: 1,
					locale: 'en'
				},
				generator,
				bigBudget()
			)
		).rejects.toBeInstanceOf(AiDisabledError);
		expect(kinds).toHaveLength(0);
	});

	it('warmOnPrep refuses before building a single candidate', async () => {
		const { universeId } = await seedDisabledUniverse();
		const place = await createTestEntity(db, { universeId, type: 'place' });
		const { generator, kinds } = recordingGenerator();

		await expect(
			warmOnPrep(
				db,
				{
					universeId,
					expectedPlaceEntityIds: [place],
					pinnedNpcEntityIds: [],
					promptVersion: 'v1',
					modelId: 'm1',
					npcDraftCredits: 1,
					ambientPackCredits: 1,
					portraitCredits: 1,
					locale: 'en'
				},
				generator,
				bigBudget()
			)
		).rejects.toBeInstanceOf(AiDisabledError);
		expect(kinds).toHaveLength(0);
	});

	it('warmOnTableOpen refuses before building a single candidate', async () => {
		const { universeId } = await seedDisabledUniverse();
		const place = await createTestEntity(db, { universeId, type: 'place' });
		const { generator, kinds } = recordingGenerator();

		await expect(
			warmOnTableOpen(
				db,
				{
					universeId,
					placeEntityId: place,
					promptVersion: 'v1',
					modelId: 'm1',
					briefCredits: 1,
					contextPackCredits: 1,
					locale: 'en'
				},
				generator,
				bigBudget()
			)
		).rejects.toBeInstanceOf(AiDisabledError);
		expect(kinds).toHaveLength(0);
	});

	it('warmOnConsumption refuses before building a single candidate', async () => {
		const { universeId } = await seedDisabledUniverse();
		const place = await createTestEntity(db, { universeId, type: 'place' });
		const { generator, kinds } = recordingGenerator();

		await expect(
			warmOnConsumption(
				db,
				{
					universeId,
					enteredPlaceEntityId: place,
					promptVersion: 'v1',
					modelId: 'm1',
					briefCredits: 1,
					locale: 'en'
				},
				generator,
				bigBudget()
			)
		).rejects.toBeInstanceOf(AiDisabledError);
		expect(kinds).toHaveLength(0);
	});

	it('warmNightly drops a switched-off universe from the sweep and keeps an enabled one', async () => {
		const disabled = await seedDisabledUniverse();
		const enabled = await seedUniverse();
		const disabledPlace = await createTestEntity(db, {
			universeId: disabled.universeId,
			type: 'place'
		});
		const enabledPlace = await createTestEntity(db, {
			universeId: enabled.universeId,
			type: 'place'
		});
		await createTestRevision(db, { universeId: disabled.universeId, entityId: disabledPlace });
		await createTestRevision(db, { universeId: enabled.universeId, entityId: enabledPlace });

		const { generator } = recordingGenerator();
		const results = await warmNightly(
			db,
			{ sinceDays: 30, promptVersion: 'v2', modelId: 'm2', creditsFor: () => 1 },
			generator,
			bigBudget()
		);

		// The disabled universe never appears in the result map at all - not attempted,
		// not degraded, simply not run - while an equally "active" enabled universe does.
		expect(results.has(disabled.universeId)).toBe(false);
		expect(results.has(enabled.universeId)).toBe(true);
	});
});
