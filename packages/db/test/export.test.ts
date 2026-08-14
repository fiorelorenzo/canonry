import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	countEntitiesForExport,
	streamEntitiesForExport,
	universeForExport,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('export query', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('universeForExport finds a universe by slug and is undefined for a slug that does not exist', async () => {
		const u = await insertHomebrewUniverse(db, { name: 'Valdoria Reach' });
		const found = await universeForExport(db, u.slug);
		expect(found).toEqual({ id: u.id, name: 'Valdoria Reach', slug: u.slug });
		expect(await universeForExport(db, unique('no-such-slug'))).toBeUndefined();
	});

	it('streams every entity in the universe, ordered by slug, and leaves other universes out', async () => {
		const target = await insertHomebrewUniverse(db);
		const other = await insertHomebrewUniverse(db);

		const created = await db
			.insert(entity)
			.values([
				{
					universeId: target.id,
					type: 'character',
					name: 'Zeta Watch',
					slug: 'zeta-watch',
					aliases: ['the Zeta'],
					body: 'Mentions [[Aldric Vane]] once.',
					visibility: 'revealable'
				},
				{
					universeId: target.id,
					type: 'faction',
					name: 'Ashen Ledger',
					slug: 'ashen-ledger',
					body: 'GM secret: it is a front.',
					visibility: 'gm_only'
				},
				// Belongs to a different universe entirely, must not leak into the stream.
				{ universeId: other.id, type: 'place', name: 'Elsewhere', slug: 'elsewhere' }
			])
			.returning();
		expect(created).toHaveLength(3);
		expect(await countEntitiesForExport(db, target.id)).toBe(2);

		const rows = [];
		for await (const row of streamEntitiesForExport(db, target.id)) rows.push(row);

		expect(rows.map((r) => r.slug)).toEqual(['ashen-ledger', 'zeta-watch']);

		const zeta = rows.find((r) => r.slug === 'zeta-watch');
		expect(zeta).toMatchObject({
			name: 'Zeta Watch',
			type: 'character',
			aliases: ['the Zeta'],
			visibility: 'revealable',
			body: 'Mentions [[Aldric Vane]] once.'
		});
		expect(zeta?.createdAt).toBeInstanceOf(Date);
		expect(zeta?.updatedAt).toBeInstanceOf(Date);

		// A GM-only entry still comes out, carrying its own visibility rather than being
		// dropped or silently relabelled - it is the GM's own copy, per F4.
		const ashenLedger = rows.find((r) => r.slug === 'ashen-ledger');
		expect(ashenLedger?.visibility).toBe('gm_only');
		expect(ashenLedger?.body).toBe('GM secret: it is a front.');
	});

	it('yields nothing for a universe with no entities', async () => {
		const u = await insertHomebrewUniverse(db);
		const rows = [];
		for await (const row of streamEntitiesForExport(db, u.id)) rows.push(row);
		expect(rows).toEqual([]);
	});
});
