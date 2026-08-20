// O1 = C (#283): the world home's activity feed reads three existing dated rows and writes
// nothing. Two things are worth proving: the three sources really do interleave by time
// rather than arriving grouped by kind, and `author_kind` survives into the feed, since a
// line a human wrote and a line accepted from the copilot are not the same event
// (guardrail 2).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, recentActivity, weeklyChangeCounts, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType, relationTypeLabel } from '../src/schema/relation.js';
import { revision } from '../src/schema/revision.js';
import { work, workNode } from '../src/schema/work.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('recentActivity', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function world() {
		const u = await insertHomebrewUniverse(db);
		const [aldric] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Aldric Vane', slug: unique('aldric') })
			.returning();
		const [ledger] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'faction',
				name: 'The Ashen Ledger',
				slug: unique('ledger')
			})
			.returning();
		if (!aldric || !ledger) throw new Error('fixture setup failed');
		return { u, aldric, ledger };
	}

	it('interleaves revisions, relations and work nodes by when they happened', async () => {
		const { u, aldric, ledger } = await world();

		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'employs',
				inverseLabel: 'employed by',
				cardinality: 'one_to_many',
				allowedFrom: ['faction'],
				allowedTo: ['character']
			})
			.returning();
		if (!rt) throw new Error('relation type insert returned no row');

		await db.insert(revision).values({
			universeId: u.id,
			entityId: aldric.id,
			authorKind: 'human',
			name: aldric.name,
			aliases: [],
			body: 'Dismissed from the watch.',
			createdAt: new Date(Date.UTC(2026, 0, 3))
		});
		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: ledger.id,
			toEntityId: aldric.id,
			authorKind: 'ai_accepted',
			createdAt: new Date(Date.UTC(2026, 0, 2))
		});
		const [w] = await db
			.insert(work)
			.values({
				universeId: u.id,
				type: 'campaign',
				name: 'Debts of Valdoria',
				slug: unique('debts')
			})
			.returning();
		if (!w) throw new Error('work insert returned no row');
		await db.insert(workNode).values({
			workId: w.id,
			kind: 'scene',
			title: 'Session 7',
			updatedAt: new Date(Date.UTC(2026, 0, 1))
		});

		const items = await recentActivity(db, u.id);
		expect(items.map((item) => item.kind)).toEqual(['revision', 'relation', 'work']);

		const [rev, rel, node] = items;
		if (rev?.kind !== 'revision' || rel?.kind !== 'relation' || node?.kind !== 'work') {
			throw new Error('unexpected activity shape');
		}
		expect(rev).toMatchObject({ authorKind: 'human', entityName: 'Aldric Vane' });
		expect(rel).toMatchObject({
			authorKind: 'ai_accepted',
			label: 'employs',
			fromName: 'The Ashen Ledger',
			toName: 'Aldric Vane'
		});
		expect(node).toMatchObject({ workName: 'Debts of Valdoria', nodeTitle: 'Session 7' });
	});

	it('honours the limit across the three sources together, not per source', async () => {
		const { u, aldric } = await world();
		for (let i = 0; i < 5; i += 1) {
			await db.insert(revision).values({
				universeId: u.id,
				entityId: aldric.id,
				authorKind: 'human',
				name: aldric.name,
				aliases: [],
				body: `Take ${i}`,
				createdAt: new Date(Date.UTC(2026, 0, 1 + i))
			});
		}
		const items = await recentActivity(db, u.id, { limit: 2 });
		expect(items).toHaveLength(2);
	});

	it('reads a per-locale relation label when one is saved, and the authored one otherwise', async () => {
		const { u, aldric, ledger } = await world();
		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'employs',
				inverseLabel: 'employed by',
				cardinality: 'one_to_many',
				allowedFrom: ['faction'],
				allowedTo: ['character']
			})
			.returning();
		if (!rt) throw new Error('relation type insert returned no row');
		await db.insert(relationTypeLabel).values({
			relationTypeId: rt.id,
			locale: 'it',
			label: 'assume',
			inverseLabel: 'assunto da',
			authorKind: 'human'
		});
		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: ledger.id,
			toEntityId: aldric.id,
			authorKind: 'human'
		});

		const italian = await recentActivity(db, u.id, { locale: 'it' });
		expect(italian.find((item) => item.kind === 'relation')).toMatchObject({ label: 'assume' });

		const english = await recentActivity(db, u.id, { locale: 'en' });
		expect(english.find((item) => item.kind === 'relation')).toMatchObject({ label: 'employs' });
	});

	it('never reads another world’s activity', async () => {
		const mine = await world();
		const theirs = await world();
		await db.insert(revision).values({
			universeId: theirs.u.id,
			entityId: theirs.aldric.id,
			authorKind: 'human',
			name: theirs.aldric.name,
			aliases: [],
			body: 'Not mine.'
		});
		const items = await recentActivity(db, mine.u.id);
		expect(items).toEqual([]);
	});
});

// #348: the world home's masthead. The pulse reads the feed's three sources plus entity
// creation, which the feed does not carry and this cannot do without: `createEntity` writes
// no revision, so a world whose entries were created and not yet edited would otherwise read
// as untouched. It also has to bucket by rolling seven-day windows rather than by calendar
// week, since the copy beside it says "the last seven days" and means it. The fixtures below
// create their entities outside the window on purpose, so each test measures the source it
// names rather than its own setup.
describe('weeklyChangeCounts', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	const DAY_MS = 24 * 60 * 60 * 1000;
	const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

	async function worldWithEntry() {
		const u = await insertHomebrewUniverse(db);
		const [aldric] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'character',
				name: 'Aldric Vane',
				slug: unique('aldric'),
				createdAt: daysAgo(200)
			})
			.returning();
		if (!aldric) throw new Error('fixture setup failed');
		return { u, aldric };
	}

	async function addRevision(universeId: string, entityId: string, at: Date) {
		await db.insert(revision).values({
			universeId,
			entityId,
			authorKind: 'human',
			name: 'Aldric Vane',
			aliases: [],
			body: 'Take.',
			createdAt: at
		});
	}

	it('buckets every source into rolling weeks, newest bucket first', async () => {
		const { u, aldric } = await worldWithEntry();
		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'employs',
				inverseLabel: 'employed by',
				cardinality: 'one_to_many',
				allowedFrom: ['faction'],
				allowedTo: ['character']
			})
			.returning();
		const [ledger] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'faction',
				name: 'The Ashen Ledger',
				slug: unique('ledger'),
				createdAt: daysAgo(200)
			})
			.returning();
		if (!rt || !ledger) throw new Error('fixture setup failed');

		await addRevision(u.id, aldric.id, daysAgo(1));
		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: ledger.id,
			toEntityId: aldric.id,
			authorKind: 'ai_accepted',
			createdAt: daysAgo(9)
		});
		const [w] = await db
			.insert(work)
			.values({
				universeId: u.id,
				type: 'campaign',
				name: 'Debts of Valdoria',
				slug: unique('debts')
			})
			.returning();
		if (!w) throw new Error('work insert returned no row');
		await db
			.insert(workNode)
			.values({ workId: w.id, kind: 'scene', title: 'Session 7', updatedAt: daysAgo(20) });

		expect(await weeklyChangeCounts(db, u.id)).toEqual([
			{ weeksAgo: 0, count: 1 },
			{ weeksAgo: 1, count: 1 },
			{ weeksAgo: 2, count: 1 }
		]);
	});

	it('sums a busy week into one bucket and leaves a silent week out entirely', async () => {
		const { u, aldric } = await worldWithEntry();
		await addRevision(u.id, aldric.id, daysAgo(1));
		await addRevision(u.id, aldric.id, daysAgo(2));
		await addRevision(u.id, aldric.id, daysAgo(3));
		await addRevision(u.id, aldric.id, daysAgo(16));

		expect(await weeklyChangeCounts(db, u.id)).toEqual([
			{ weeksAgo: 0, count: 3 },
			{ weeksAgo: 2, count: 1 }
		]);
	});

	it('counts an entry that was created and never edited, which writes no revision', async () => {
		const u = await insertHomebrewUniverse(db);
		await db.insert(entity).values({
			universeId: u.id,
			type: 'character',
			name: 'Corvin Ashe',
			slug: unique('corvin'),
			createdAt: daysAgo(2)
		});
		expect(await weeklyChangeCounts(db, u.id)).toEqual([{ weeksAgo: 0, count: 1 }]);
	});

	it('stops at the window, so an old world with nothing recent reads as quiet', async () => {
		const { u, aldric } = await worldWithEntry();
		await addRevision(u.id, aldric.id, daysAgo(100));
		expect(await weeklyChangeCounts(db, u.id, { weeks: 12 })).toEqual([]);
		expect(await weeklyChangeCounts(db, u.id, { weeks: 20 })).toEqual([{ weeksAgo: 14, count: 1 }]);
	});

	it('never counts another world’s changes', async () => {
		const mine = await worldWithEntry();
		const theirs = await worldWithEntry();
		await addRevision(theirs.u.id, theirs.aldric.id, daysAgo(1));
		expect(await weeklyChangeCounts(db, mine.u.id)).toEqual([]);
	});
});
