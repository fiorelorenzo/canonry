// O1 = C (#283): the entry browser's own query. What is worth proving here is the part the
// old page got wrong rather than the part it got right: a page is a real window over a
// counted total (`+page.server.ts` used to take 500 rows and draw no pages at all), the two
// counts each read their own table, and the order is whatever the header says and nothing
// else.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, entityBrowserPage, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { fact } from '../src/schema/fact.js';
import { relation, relationType } from '../src/schema/relation.js';
import { revision } from '../src/schema/revision.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('entityBrowserPage', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function insertEntity(
		universeId: string,
		name: string,
		overrides: Partial<typeof entity.$inferInsert> = {}
	) {
		const [row] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name,
				slug: unique(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
				...overrides
			})
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		return row;
	}

	it('pages a world larger than one page, with the total behind it', async () => {
		const u = await insertHomebrewUniverse(db);
		// Distinct `updatedAt` per row so the default recency order is total, not a tie the
		// secondary name key has to break - this test is about the window, not about ties.
		for (let i = 0; i < 7; i += 1) {
			await insertEntity(u.id, `Entry ${String(i).padStart(2, '0')}`, {
				updatedAt: new Date(Date.UTC(2026, 0, 1 + i))
			});
		}

		const first = await entityBrowserPage(db, u.id, { limit: 3, offset: 0 });
		expect(first.total).toBe(7);
		expect(first.rows.map((r) => r.name)).toEqual(['Entry 06', 'Entry 05', 'Entry 04']);

		const second = await entityBrowserPage(db, u.id, { limit: 3, offset: 3 });
		expect(second.total).toBe(7);
		expect(second.rows.map((r) => r.name)).toEqual(['Entry 03', 'Entry 02', 'Entry 01']);

		const last = await entityBrowserPage(db, u.id, { limit: 3, offset: 6 });
		expect(last.rows.map((r) => r.name)).toEqual(['Entry 00']);
	});

	it('reports the true total for an offset past the end, rather than zero', async () => {
		const u = await insertHomebrewUniverse(db);
		await insertEntity(u.id, 'Only One');

		const beyond = await entityBrowserPage(db, u.id, { limit: 25, offset: 25 });
		expect(beyond.rows).toEqual([]);
		// The footer divides this into pages, so a wrong answer here is what makes a page
		// count a lie: "page 2 of 0" instead of a page the caller can clamp back to 1.
		expect(beyond.total).toBe(1);
	});

	it('counts relations from both ends and facts on their own entity', async () => {
		const u = await insertHomebrewUniverse(db);
		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'employs',
				inverseLabel: 'employed by',
				cardinality: 'one_to_many',
				allowedFrom: ['character'],
				allowedTo: ['character']
			})
			.returning();
		if (!rt) throw new Error('relation type insert returned no row');

		const aldric = await insertEntity(u.id, 'Aldric Vane');
		const iselde = await insertEntity(u.id, 'Iselde Wrenn');
		const corvin = await insertEntity(u.id, 'Corvin Ashe');

		// Aldric is the `from` end of one and the `to` end of another: two relationships,
		// read from either side, which is what the relations panel itself shows.
		await db.insert(relation).values([
			{
				universeId: u.id,
				relationTypeId: rt.id,
				fromEntityId: aldric.id,
				toEntityId: iselde.id,
				authorKind: 'human'
			},
			{
				universeId: u.id,
				relationTypeId: rt.id,
				fromEntityId: corvin.id,
				toEntityId: aldric.id,
				authorKind: 'human'
			}
		]);

		const body = 'He drinks at the Gilded Rat. Nobody asks him to leave.';
		const [rev] = await db
			.insert(revision)
			.values({
				universeId: u.id,
				entityId: aldric.id,
				authorKind: 'human',
				name: aldric.name,
				aliases: [],
				body
			})
			.returning();
		if (!rev) throw new Error('revision insert returned no row');
		await db.insert(fact).values([
			{
				universeId: u.id,
				entityId: aldric.id,
				statement: 'Aldric drinks at the Gilded Rat.',
				sourceRevisionId: rev.id,
				spanStart: 0,
				spanEnd: 28,
				authorKind: 'human'
			},
			{
				universeId: u.id,
				entityId: aldric.id,
				statement: 'Nobody asks Aldric to leave.',
				sourceRevisionId: rev.id,
				spanStart: 29,
				spanEnd: body.length,
				authorKind: 'ai_accepted'
			}
		]);

		const page = await entityBrowserPage(db, u.id, { sort: 'name', direction: 'asc' });
		const byName = new Map(page.rows.map((row) => [row.name, row]));
		expect(byName.get('Aldric Vane')).toMatchObject({ relationCount: 2, factCount: 2 });
		expect(byName.get('Iselde Wrenn')).toMatchObject({ relationCount: 1, factCount: 0 });
		expect(byName.get('Corvin Ashe')).toMatchObject({ relationCount: 1, factCount: 0 });
	});

	it('sorts by any column the table draws, in both directions', async () => {
		const u = await insertHomebrewUniverse(db);
		await insertEntity(u.id, 'Beta', { type: 'place', updatedAt: new Date(Date.UTC(2026, 0, 3)) });
		await insertEntity(u.id, 'alpha', {
			type: 'faction',
			updatedAt: new Date(Date.UTC(2026, 0, 1))
		});
		await insertEntity(u.id, 'Gamma', {
			type: 'character',
			updatedAt: new Date(Date.UTC(2026, 0, 2))
		});

		const byName = await entityBrowserPage(db, u.id, { sort: 'name', direction: 'asc' });
		// Case-insensitive, or a lowercase name sorts after every capitalised one.
		expect(byName.rows.map((r) => r.name)).toEqual(['alpha', 'Beta', 'Gamma']);

		const byNameDesc = await entityBrowserPage(db, u.id, { sort: 'name', direction: 'desc' });
		expect(byNameDesc.rows.map((r) => r.name)).toEqual(['Gamma', 'Beta', 'alpha']);

		const byType = await entityBrowserPage(db, u.id, { sort: 'type', direction: 'asc' });
		expect(byType.rows.map((r) => r.type)).toEqual(['character', 'place', 'faction']);

		const byChanged = await entityBrowserPage(db, u.id, { sort: 'changed', direction: 'asc' });
		expect(byChanged.rows.map((r) => r.name)).toEqual(['alpha', 'Gamma', 'Beta']);
	});

	it('narrows by type and by a name or alias substring, and the total narrows with it', async () => {
		const u = await insertHomebrewUniverse(db);
		await insertEntity(u.id, 'Aldric Vane');
		await insertEntity(u.id, 'The Gilded Rat', {
			type: 'place',
			aliases: ['The Gilded Rat Tavern']
		});
		await insertEntity(u.id, 'Cairnmouth', { type: 'place' });

		const places = await entityBrowserPage(db, u.id, { type: 'place' });
		expect(places.total).toBe(2);

		const byName = await entityBrowserPage(db, u.id, { query: 'aldric' });
		expect(byName.total).toBe(1);
		expect(byName.rows[0]?.name).toBe('Aldric Vane');

		const byAlias = await entityBrowserPage(db, u.id, { query: 'tavern' });
		expect(byAlias.total).toBe(1);
		expect(byAlias.rows[0]?.name).toBe('The Gilded Rat');

		// Filters compose: a query plus a type that excludes its only hit is honestly empty.
		const composed = await entityBrowserPage(db, u.id, { query: 'aldric', type: 'place' });
		expect(composed.total).toBe(0);
		expect(composed.rows).toEqual([]);
	});

	it('never reads another world’s entries', async () => {
		const mine = await insertHomebrewUniverse(db);
		const theirs = await insertHomebrewUniverse(db);
		await insertEntity(mine.id, 'Mine');
		await insertEntity(theirs.id, 'Theirs');

		const page = await entityBrowserPage(db, mine.id, {});
		expect(page.total).toBe(1);
		expect(page.rows.map((r) => r.name)).toEqual(['Mine']);
	});
});
