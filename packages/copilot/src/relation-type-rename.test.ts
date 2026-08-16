/**
 * Decision L1, issue #195's own acceptance test: a relation type can be renamed without
 * changing its identity. Before this issue, `relation_type.label` was the identity, so
 * `renameRelationType` rewrote it out from under everything that had ever pointed at the
 * type by its words - its own `relation` rows still resolved (they hold `relation_type_id`,
 * a real foreign key), but a candidate's evidence path and a rejection history entry, both
 * of which used to carry the label as a bare string, would have gone stale the instant a
 * GM renamed anything. This test renames a type and shows all three - its relations, a
 * freshly-built candidate's evidence, and a *prior* rejection's resemblance to that
 * candidate - still resolve to it afterwards, because all three now compare `key`, which
 * `renameRelationType` never touches.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { closeDb, relationsFor, renameRelationType, type Db } from '@canonry/db';
import { loadCandidateGraph } from './db-graph.js';
import { buildCandidatePool, graphNeighbors } from './candidates.js';
import { rejectPenaltyFor, type RejectionRecord } from './reject-signal.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertRelation,
	insertRelationType,
	insertUser
} from './test-helpers.js';
import { openTestDb } from './test-db.js';

describe('renaming a relation type does not orphan it from its own history (#195)', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('keeps the relation, a fresh evidence path, and a prior rejection all resolving to the same key', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const rt = await insertRelationType(db, universe.id, {
			label: 'commands',
			inverseLabel: 'commanded by'
		});
		const general = await insertEntity(db, universe.id, { type: 'character', name: 'General' });
		const soldier = await insertEntity(db, universe.id, { type: 'character', name: 'Soldier' });
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: general.id,
			toEntityId: soldier.id
		});

		// Recorded before the rename: a candidate's evidence path (candidates.ts's
		// RelationEvidence.path) and a rejection history entry both carry rt.key.
		const graphBefore = await loadCandidateGraph(db, universe.id);
		expect(graphNeighbors(graphBefore, general.id, 1).get(soldier.id)?.path).toEqual([rt.key]);

		const priorRejection: RejectionRecord = {
			targetEntityId: 'some-other-entity-from-an-earlier-plan',
			relationKeys: [rt.key],
			reason: 'wrong'
		};

		// The rename itself: only the display words move.
		const renamed = await renameRelationType(db, universe.id, rt.id, {
			label: 'leads',
			inverseLabel: 'led by'
		});
		expect(renamed.key).toBe(rt.key);
		expect(renamed.label).toBe('leads');
		expect(renamed.inverseLabel).toBe('led by');

		// 1. Its relations still resolve to it: the same stored row, the new wording, from
		// both perspectives - nothing about the FK or the row identity moved.
		const fromGeneral = await relationsFor(db, general.id);
		expect(fromGeneral).toContainEqual(
			expect.objectContaining({
				key: rt.key,
				label: 'leads',
				other: expect.objectContaining({ id: soldier.id })
			})
		);
		const fromSoldier = await relationsFor(db, soldier.id);
		expect(fromSoldier).toContainEqual(
			expect.objectContaining({
				key: rt.key,
				label: 'led by',
				other: expect.objectContaining({ id: general.id })
			})
		);

		// 2. Its evidence still resolves to it: a graph loaded fresh after the rename
		// produces the exact same key for the exact same edge - a candidate found today
		// carries the identity a candidate found yesterday would have too.
		const graphAfter = await loadCandidateGraph(db, universe.id);
		expect(graphNeighbors(graphAfter, general.id, 1).get(soldier.id)?.path).toEqual([rt.key]);

		// 3. Its rejection history still resolves to it: a rejection recorded under the old
		// wording still resembles a fresh candidate reached through the renamed type,
		// because `resemblance` (reject-signal.ts) compares `relationKeys`, never `label`.
		const pool = buildCandidatePool(graphAfter, general.id, [
			{ kind: 'added', statement: 'Something about the General changed.' }
		]);
		const soldierCandidate = pool.find((c) => c.entityId === soldier.id);
		expect(soldierCandidate).toBeDefined();
		expect(rejectPenaltyFor(soldierCandidate!, [priorRejection])).toBeLessThan(0);
	});
});
