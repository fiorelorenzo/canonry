/**
 * SPEC.md §4.1, issue #19. `supersede` records that a derived universe's own entry
 * replaces a specific page from its base universe's indexed corpus - `the user's canon
 * always wins`, so `supersededUrlsForUniverse` is the flat list `packages/indexing`'s
 * retriever merges into its existing exclusion filter (issue #62).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	createDataSource,
	createSupersede,
	type Db,
	listSupersedesForUniverse,
	removeSupersede,
	SupersedeAlreadyExistsError,
	supersededUrlsForUniverse
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { insertHomebrewUniverse, unique, testDb } from './helpers.js';

describe('supersede queries', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function insertEntity(universeId: string, name: string) {
		const [row] = await db
			.insert(entity)
			.values({ universeId, type: 'place', name, slug: unique('place') })
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		return row;
	}

	it('createSupersede records a declaration and supersededUrlsForUniverse returns it', async () => {
		const base = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: base.id,
			type: 'wiki',
			name: 'Forgotten Realms'
		});
		const derived = await insertHomebrewUniverse(db);
		const waterdeep = await insertEntity(derived.id, 'Waterdeep');
		const url = `https://forgottenrealms.example.com/${unique('waterdeep')}`;

		await createSupersede(db, {
			universeId: derived.id,
			entityId: waterdeep.id,
			dataSourceId: source.id,
			sourceUrl: url,
			note: 'Ours diverges: the Masked Lords are a fiction the guilds maintain.'
		});

		expect(await supersededUrlsForUniverse(db, derived.id)).toEqual([url]);
	});

	it('a second universe superseding the same url as one already declared is unaffected', async () => {
		const base = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: base.id,
			type: 'wiki',
			name: 'Forgotten Realms'
		});
		const derivedA = await insertHomebrewUniverse(db);
		const derivedB = await insertHomebrewUniverse(db);
		const entityA = await insertEntity(derivedA.id, 'Waterdeep');
		const entityB = await insertEntity(derivedB.id, 'Waterdeep');
		const url = `https://forgottenrealms.example.com/${unique('waterdeep')}`;

		await createSupersede(db, {
			universeId: derivedA.id,
			entityId: entityA.id,
			dataSourceId: source.id,
			sourceUrl: url
		});
		await createSupersede(db, {
			universeId: derivedB.id,
			entityId: entityB.id,
			dataSourceId: source.id,
			sourceUrl: url
		});

		expect(await supersededUrlsForUniverse(db, derivedA.id)).toEqual([url]);
		expect(await supersededUrlsForUniverse(db, derivedB.id)).toEqual([url]);
	});

	it('declaring the same url twice for the same universe throws SupersedeAlreadyExistsError', async () => {
		const base = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: base.id,
			type: 'wiki',
			name: 'Forgotten Realms'
		});
		const derived = await insertHomebrewUniverse(db);
		const first = await insertEntity(derived.id, 'Waterdeep');
		const second = await insertEntity(derived.id, 'New Waterdeep');
		const url = `https://forgottenrealms.example.com/${unique('waterdeep')}`;

		await createSupersede(db, {
			universeId: derived.id,
			entityId: first.id,
			dataSourceId: source.id,
			sourceUrl: url
		});

		await expect(
			createSupersede(db, {
				universeId: derived.id,
				entityId: second.id,
				dataSourceId: source.id,
				sourceUrl: url
			})
		).rejects.toBeInstanceOf(SupersedeAlreadyExistsError);
	});

	it('listSupersedesForUniverse carries the entity and data source names for the precedence panel', async () => {
		const base = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: base.id,
			type: 'wiki',
			name: 'Forgotten Realms'
		});
		const derived = await insertHomebrewUniverse(db);
		const waterdeep = await insertEntity(derived.id, 'Waterdeep');
		const url = `https://forgottenrealms.example.com/${unique('waterdeep')}`;
		await createSupersede(db, {
			universeId: derived.id,
			entityId: waterdeep.id,
			dataSourceId: source.id,
			sourceUrl: url
		});

		const rows = await listSupersedesForUniverse(db, derived.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			entityName: 'Waterdeep',
			dataSourceName: 'Forgotten Realms',
			sourceUrl: url
		});
	});

	it('removeSupersede is scoped to the universe that owns the row', async () => {
		const base = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: base.id,
			type: 'wiki',
			name: 'Forgotten Realms'
		});
		const derived = await insertHomebrewUniverse(db);
		const other = await insertHomebrewUniverse(db);
		const waterdeep = await insertEntity(derived.id, 'Waterdeep');
		const url = `https://forgottenrealms.example.com/${unique('waterdeep')}`;
		const row = await createSupersede(db, {
			universeId: derived.id,
			entityId: waterdeep.id,
			dataSourceId: source.id,
			sourceUrl: url
		});

		// A different universe's id cannot delete a row it does not own.
		await removeSupersede(db, other.id, row.id);
		expect(await supersededUrlsForUniverse(db, derived.id)).toEqual([url]);

		await removeSupersede(db, derived.id, row.id);
		expect(await supersededUrlsForUniverse(db, derived.id)).toEqual([]);
	});
});
