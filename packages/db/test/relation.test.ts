import { and, eq, inArray, isNull } from 'drizzle-orm';
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

describe('shipped relation_type catalogue (issue #165)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('ships `part of` and `protects` alongside the original eight labels', async () => {
		const rows = await db
			.select({
				label: relationType.label,
				inverseLabel: relationType.inverseLabel,
				cardinality: relationType.cardinality,
				allowedFrom: relationType.allowedFrom,
				allowedTo: relationType.allowedTo
			})
			.from(relationType)
			.where(
				and(isNull(relationType.universeId), inArray(relationType.label, ['part of', 'protects']))
			);
		const byLabel = new Map(rows.map((r) => [r.label, r]));

		expect(byLabel.get('part of')).toEqual({
			label: 'part of',
			inverseLabel: 'contains',
			cardinality: 'many_to_one',
			allowedFrom: ['place', 'faction'],
			allowedTo: ['place', 'faction']
		});
		expect(byLabel.get('protects')).toEqual({
			label: 'protects',
			inverseLabel: 'protected by',
			cardinality: 'many_to_many',
			allowedFrom: ['character', 'faction'],
			allowedTo: ['character', 'faction']
		});
	});

	it('lets a place be part of a place, which `located in` cannot express', async () => {
		const u = await insertHomebrewUniverse(db);
		const [partOf] = await db
			.select()
			.from(relationType)
			.where(and(isNull(relationType.universeId), eq(relationType.label, 'part of')));
		if (!partOf) throw new Error('migration 0029 did not seed the "part of" relation type');

		const [quarter] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'place', name: 'Quarter', slug: unique('quarter') })
			.returning();
		const [city] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'place', name: 'City', slug: unique('city') })
			.returning();
		if (!quarter || !city) throw new Error('fixture setup failed');

		await expect(
			db.insert(relation).values({
				universeId: u.id,
				relationTypeId: partOf.id,
				fromEntityId: quarter.id,
				toEntityId: city.id,
				authorKind: 'human'
			})
		).resolves.not.toThrow();

		const views = await relationsFor(db, quarter.id);
		expect(views).toContainEqual(
			expect.objectContaining({ label: 'part of', other: expect.objectContaining({ id: city.id }) })
		);
	});
});
