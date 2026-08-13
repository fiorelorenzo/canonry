import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, relationsFor, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType } from '../src/schema/relation.js';
import { expectConstraintViolation, insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('relation', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function commandsPair() {
		const u = await insertHomebrewUniverse(db);
		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'commands',
				inverseLabel: 'commanded by',
				cardinality: 'one_to_many',
				allowedFrom: ['character'],
				allowedTo: ['character']
			})
			.returning();
		const [general] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'General', slug: unique('general') })
			.returning();
		const [soldier] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Soldier', slug: unique('soldier') })
			.returning();
		if (!rt || !general || !soldier) throw new Error('fixture setup failed');
		return { u, rt, general, soldier };
	}

	it('rejects inserting the same relationship twice', async () => {
		const { u, rt, general, soldier } = await commandsPair();
		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: general.id,
			toEntityId: soldier.id,
			authorKind: 'human'
		});
		await expectConstraintViolation(
			db.insert(relation).values({
				universeId: u.id,
				relationTypeId: rt.id,
				fromEntityId: general.id,
				toEntityId: soldier.id,
				authorKind: 'human'
			}),
			'relation_type_from_to_key'
		);
	});

	it('rejects a relation from an entity to itself', async () => {
		const { u, rt, general } = await commandsPair();
		await expectConstraintViolation(
			db.insert(relation).values({
				universeId: u.id,
				relationTypeId: rt.id,
				fromEntityId: general.id,
				toEntityId: general.id,
				authorKind: 'human'
			}),
			'relation_from_ne_to'
		);
	});

	it('renders "commands" from one end and "commanded by" from the other, from one stored row', async () => {
		const { u, rt, general, soldier } = await commandsPair();
		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: general.id,
			toEntityId: soldier.id,
			authorKind: 'human'
		});

		const fromGeneral = await relationsFor(db, general.id);
		expect(fromGeneral).toContainEqual({
			label: 'commands',
			other: { id: soldier.id, name: soldier.name, type: soldier.type, slug: soldier.slug },
			direction: 'from'
		});

		const fromSoldier = await relationsFor(db, soldier.id);
		expect(fromSoldier).toContainEqual({
			label: 'commanded by',
			other: { id: general.id, name: general.name, type: general.type, slug: general.slug },
			direction: 'to'
		});
	});

	it('orders results by label, then the other entity name, so the panel never reshuffles', async () => {
		const { u, rt, general } = await commandsPair();
		const [zed] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Zed', slug: unique('zed') })
			.returning();
		const [amy] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Amy', slug: unique('amy') })
			.returning();
		if (!zed || !amy) throw new Error('fixture setup failed');

		// Inserted out of name order, on purpose.
		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: general.id,
			toEntityId: zed.id,
			authorKind: 'human'
		});
		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: general.id,
			toEntityId: amy.id,
			authorKind: 'human'
		});

		const result = await relationsFor(db, general.id);
		expect(result).toEqual([
			{
				label: 'commands',
				other: { id: amy.id, name: amy.name, type: amy.type, slug: amy.slug },
				direction: 'from'
			},
			{
				label: 'commands',
				other: { id: zed.id, name: zed.name, type: zed.type, slug: zed.slug },
				direction: 'from'
			}
		]);
	});

	it('rejects a second global relation type with a label already in the shipped catalogue', async () => {
		// "commands" is seeded by migrations/0001 with universe_id null. A nulls-not-distinct
		// constraint is what makes this a real conflict instead of two silently coexisting
		// global types with the same label.
		await expectConstraintViolation(
			db.insert(relationType).values({
				universeId: null,
				label: 'commands',
				inverseLabel: 'led by',
				cardinality: 'one_to_many',
				allowedFrom: ['character'],
				allowedTo: ['character']
			}),
			'relation_type_universe_label_key'
		);
	});

	it('allows a universe-scoped relation type to reuse a label from the shipped catalogue', async () => {
		const u = await insertHomebrewUniverse(db);
		await expect(
			db.insert(relationType).values({
				universeId: u.id,
				label: 'commands',
				inverseLabel: 'led by',
				cardinality: 'one_to_many',
				allowedFrom: ['character'],
				allowedTo: ['character']
			})
		).resolves.not.toThrow();
	});
});
