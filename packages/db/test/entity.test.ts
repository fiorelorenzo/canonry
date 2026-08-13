import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { expectConstraintViolation, insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('entity', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('round-trips aliases and finds an entity by alias containment', async () => {
		const u = await insertHomebrewUniverse(db);
		const aliases = ['Il Ratto Dorato', 'Gilded Rat Tavern'];
		const [inn] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'place',
				name: 'the Gilded Rat',
				slug: unique('gilded-rat'),
				aliases
			})
			.returning();
		if (!inn) throw new Error('no entity');
		expect(inn.aliases).toEqual(aliases);

		const found = await db
			.select()
			.from(entity)
			.where(sql`${entity.aliases} @> ARRAY['Il Ratto Dorato']::text[]`);
		expect(found).toHaveLength(1);
		expect(found[0]?.id).toBe(inn.id);
	});

	it('defaults aliases to an empty array', async () => {
		const u = await insertHomebrewUniverse(db);
		const [row] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Nobody', slug: unique('nobody') })
			.returning();
		expect(row?.aliases).toEqual([]);
	});

	it('has a GIN index available to answer alias containment queries without a seq scan', async () => {
		// Force the planner to use an index if one exists, instead of a seq scan it would
		// otherwise pick on a small table - this is what actually proves the GIN index is
		// usable for alias lookups, not just present. SET LOCAL only holds for the
		// enclosing transaction, so both statements have to run inside one.
		const planText = await db.transaction(async (tx) => {
			await tx.execute(sql`set local enable_seqscan = off`);
			const plan = await tx.execute<{ 'QUERY PLAN': string }>(
				sql`explain select id from entity where aliases @> ARRAY['whoever']::text[]`
			);
			return plan.map((row) => row['QUERY PLAN']).join('\n');
		});
		expect(planText).toMatch(/entity_aliases_gin_idx/);
	});

	it('scopes slug uniqueness to the universe, not globally', async () => {
		const u1 = await insertHomebrewUniverse(db);
		const u2 = await insertHomebrewUniverse(db);
		const slug = unique('shared-entity-slug');

		await db.insert(entity).values({ universeId: u1.id, type: 'place', name: 'A', slug });
		// Same slug, different universe: allowed.
		await expect(
			db.insert(entity).values({ universeId: u2.id, type: 'place', name: 'B', slug })
		).resolves.not.toThrow();
		// Same slug, same universe again: rejected.
		await expectConstraintViolation(
			db.insert(entity).values({ universeId: u1.id, type: 'place', name: 'A2', slug }),
			'entity_universe_slug_key'
		);
	});
});
