/**
 * SPEC.md §4.3, issue #20, decision B5 = A. Covers the tree (creation, ordering,
 * breadcrumb), the auto-linked "Uses" freshness signal, the reverse lookup B5's own
 * "what this locks in" names explicitly, and reordering without two siblings ever
 * landing on the same position.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	ancestorsOf,
	closeDb,
	createWork,
	createWorkNode,
	type Db,
	listWorksForUniverse,
	moveWorkNode,
	scenesUsingEntity,
	setWorkNodeEntities,
	updateWorkNode,
	usesForNode,
	workNodeById,
	workNodeTree
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { workNode } from '../src/schema/work.js';
import { insertHomebrewUniverse, unique, testDb } from './helpers.js';

describe('work and work_node queries', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function insertEntity(universeId: string, name?: string) {
		const slug = unique('character');
		const [row] = await db
			.insert(entity)
			.values({ universeId, type: 'character', name: name ?? slug, slug })
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		return row;
	}

	it('createWork slugifies the name and disambiguates a collision within the universe', async () => {
		const universe = await insertHomebrewUniverse(db);
		const first = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: 'Debts of Valdoria'
		});
		expect(first.slug).toBe('debts-of-valdoria');

		const second = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: 'Debts of Valdoria'
		});
		expect(second.slug).toBe('debts-of-valdoria-2');
		expect(second.id).not.toBe(first.id);
	});

	it("listWorksForUniverse only returns that universe's works", async () => {
		const universeA = await insertHomebrewUniverse(db);
		const universeB = await insertHomebrewUniverse(db);
		await createWork(db, { universeId: universeA.id, type: 'oneshot', name: unique('a') });
		await createWork(db, { universeId: universeB.id, type: 'oneshot', name: unique('b') });

		const rows = await listWorksForUniverse(db, universeA.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.universeId).toBe(universeA.id);
	});

	it('createWorkNode assigns sequential positions per parent, restarting under a new parent', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});

		const act1 = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'act',
			title: 'Act 1'
		});
		const act2 = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'act',
			title: 'Act 2'
		});
		expect(act1.position).toBe(0);
		expect(act2.position).toBe(1);

		const scene1 = await createWorkNode(db, {
			workId: work.id,
			parentId: act1.id,
			kind: 'scene',
			title: 'Scene 1'
		});
		expect(scene1.position).toBe(0);
	});

	it('workNodeTree flattens into pre-order with correct depth', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});

		const act = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'act',
			title: 'Act 1'
		});
		const chapter = await createWorkNode(db, {
			workId: work.id,
			parentId: act.id,
			kind: 'chapter',
			title: 'Chapter 1'
		});
		const scene = await createWorkNode(db, {
			workId: work.id,
			parentId: chapter.id,
			kind: 'scene',
			title: 'Scene 1'
		});
		// A second act after the first, to prove pre-order does not interleave siblings.
		const act2 = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'act',
			title: 'Act 2'
		});

		const tree = await workNodeTree(db, work.id);
		expect(tree.map((n) => [n.title, n.depth])).toEqual([
			['Act 1', 0],
			['Chapter 1', 1],
			['Scene 1', 2],
			['Act 2', 0]
		]);
		expect(tree.map((n) => n.id)).toEqual([act.id, chapter.id, scene.id, act2.id]);
	});

	it('ancestorsOf returns the breadcrumb from root to (not including) the node itself', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});
		const act = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'act',
			title: 'Act 2'
		});
		const chapter = await createWorkNode(db, {
			workId: work.id,
			parentId: act.id,
			kind: 'chapter',
			title: 'Chapter 2: The Lantern Quarter'
		});
		const scene = await createWorkNode(db, {
			workId: work.id,
			parentId: chapter.id,
			kind: 'scene',
			title: 'Scene 3'
		});

		const chain = await ancestorsOf(db, scene.id);
		expect(chain).toEqual([
			{ id: act.id, title: 'Act 2' },
			{ id: chapter.id, title: 'Chapter 2: The Lantern Quarter' }
		]);
	});

	it('updateWorkNode saves title and body and bumps updated_at', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});
		const scene = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'scene',
			title: 'Draft',
			body: ''
		});

		const updated = await updateWorkNode(db, scene.id, {
			title: 'A drink with the ex-captain',
			body: 'The party finds [[Aldric Vane]] at his corner table.'
		});
		expect(updated.title).toBe('A drink with the ex-captain');
		expect(updated.body).toContain('Aldric Vane');
		expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(scene.updatedAt.getTime());
	});

	it('setWorkNodeEntities links, unlinks and stays idempotent for entities still present', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});
		const scene = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'scene',
			title: 'S'
		});
		const aldric = await insertEntity(universe.id, 'Aldric Vane');
		const rat = await insertEntity(universe.id, 'The Gilded Rat');
		const sennah = await insertEntity(universe.id, 'Mother Sennah');

		await setWorkNodeEntities(db, scene.id, [aldric.id, rat.id]);
		let uses = await usesForNode(db, scene.id);
		expect(uses.map((u) => u.entityId).sort()).toEqual([aldric.id, rat.id].sort());

		// Drop the rat, add Sennah: aldric survives the diff, rat is removed, sennah is added.
		await setWorkNodeEntities(db, scene.id, [aldric.id, sennah.id]);
		uses = await usesForNode(db, scene.id);
		expect(uses.map((u) => u.entityId).sort()).toEqual([aldric.id, sennah.id].sort());

		// Re-applying the same set is a no-op, not a duplicate-key error.
		await expect(
			setWorkNodeEntities(db, scene.id, [aldric.id, sennah.id])
		).resolves.toBeUndefined();
	});

	it('usesForNode marks an entity fresh only when it changed after the scene was last saved', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});
		const scene = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'scene',
			title: 'S'
		});
		const aldric = await insertEntity(universe.id, 'Aldric Vane');
		const stale = await insertEntity(universe.id, 'The Gilded Rat');
		await setWorkNodeEntities(db, scene.id, [aldric.id, stale.id]);

		// Aldric changes after the scene's own updated_at; the tavern's own updated_at is
		// backdated to before the scene was last saved, since it was inserted after the
		// scene by this test and would otherwise always read as "changed since".
		await db
			.update(entity)
			.set({ updatedAt: new Date(scene.updatedAt.getTime() - 60_000) })
			.where(eq(entity.id, stale.id));
		await db
			.update(entity)
			.set({ updatedAt: new Date(Date.now() + 60_000) })
			.where(eq(entity.id, aldric.id));

		const uses = await usesForNode(db, scene.id);
		const byId = new Map(uses.map((u) => [u.entityId, u]));
		expect(byId.get(aldric.id)?.fresh).toBe(true);
		expect(byId.get(stale.id)?.fresh).toBe(false);
	});

	it('scenesUsingEntity is the reverse of usesForNode, across every work in the universe', async () => {
		const universe = await insertHomebrewUniverse(db);
		const workA = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('a')
		});
		const workB = await createWork(db, {
			universeId: universe.id,
			type: 'oneshot',
			name: unique('b')
		});
		const sceneA = await createWorkNode(db, {
			workId: workA.id,
			parentId: null,
			kind: 'scene',
			title: 'A'
		});
		const sceneB = await createWorkNode(db, {
			workId: workB.id,
			parentId: null,
			kind: 'scene',
			title: 'B'
		});
		const aldric = await insertEntity(universe.id, 'Aldric Vane');
		await setWorkNodeEntities(db, sceneA.id, [aldric.id]);
		await setWorkNodeEntities(db, sceneB.id, [aldric.id]);

		const rows = await scenesUsingEntity(db, aldric.id);
		expect(rows.map((r) => r.nodeId).sort()).toEqual([sceneA.id, sceneB.id].sort());
	});

	it('moveWorkNode swaps position with the previous sibling and persists the new order', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});
		const first = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'scene',
			title: 'Scene 1'
		});
		const second = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'scene',
			title: 'Scene 2'
		});

		const result = await moveWorkNode(db, second.id, 'up');
		expect(result.moved).toBe(true);

		const reloadedFirst = await workNodeById(db, first.id);
		const reloadedSecond = await workNodeById(db, second.id);
		expect(reloadedSecond?.position).toBe(0);
		expect(reloadedFirst?.position).toBe(1);

		// The unique index (work_id, parent_id, position) never saw a duplicate: both rows
		// read back at distinct positions straight from the table, not from the query layer.
		const rows = await db
			.select({ id: workNode.id, position: workNode.position })
			.from(workNode)
			.where(and(eq(workNode.workId, work.id)));
		const positions = rows.map((r) => r.position).sort();
		expect(positions).toEqual([0, 1]);
	});

	it('moveWorkNode is a no-op at either end of the sibling list', async () => {
		const universe = await insertHomebrewUniverse(db);
		const work = await createWork(db, {
			universeId: universe.id,
			type: 'campaign',
			name: unique('w')
		});
		const first = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'scene',
			title: 'Scene 1'
		});
		const second = await createWorkNode(db, {
			workId: work.id,
			parentId: null,
			kind: 'scene',
			title: 'Scene 2'
		});

		expect((await moveWorkNode(db, first.id, 'up')).moved).toBe(false);
		expect((await moveWorkNode(db, second.id, 'down')).moved).toBe(false);

		const reloadedFirst = await workNodeById(db, first.id);
		const reloadedSecond = await workNodeById(db, second.id);
		expect(reloadedFirst?.position).toBe(0);
		expect(reloadedSecond?.position).toBe(1);
	});
});
