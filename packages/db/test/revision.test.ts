import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, historyFor, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { revision } from '../src/schema/revision.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('revision', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('returns mixed human and ai_accepted revisions newest first', async () => {
		const u = await insertHomebrewUniverse(db);
		const [e] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Aldric', slug: unique('aldric') })
			.returning();
		if (!e) throw new Error('no entity');

		// Explicit, well-separated timestamps: historyFor orders by created_at, and relying
		// on wall-clock inserts in a fast test run risks ties.
		const base = new Date('2026-01-01T00:00:00Z').getTime();
		const seeded = [
			{ createdAt: new Date(base), authorKind: 'human' as const, body: 'v1' },
			{ createdAt: new Date(base + 1000), authorKind: 'ai_accepted' as const, body: 'v2' },
			{ createdAt: new Date(base + 2000), authorKind: 'human' as const, body: 'v3' }
		];
		for (const s of seeded) {
			await db.insert(revision).values({
				universeId: u.id,
				entityId: e.id,
				authorKind: s.authorKind,
				name: e.name,
				aliases: [],
				body: s.body,
				createdAt: s.createdAt
			});
		}

		const history = await historyFor(db, e.id);
		expect(history.map((r) => r.body)).toEqual(['v3', 'v2', 'v1']);
		expect(history.map((r) => r.authorKind)).toEqual(['human', 'ai_accepted', 'human']);
	});
});
