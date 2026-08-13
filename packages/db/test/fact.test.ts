import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, factWithSource, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { fact } from '../src/schema/fact.js';
import { revision } from '../src/schema/revision.js';
import { expectConstraintViolation, insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('fact', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('resolves a span to the exact sentence it was extracted from', async () => {
		const u = await insertHomebrewUniverse(db);
		const [wizard] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Old Wizard', slug: unique('wizard') })
			.returning();
		if (!wizard) throw new Error('no entity');

		const body =
			'The old wizard lives in the tower. He guards an ancient tome. Nobody has seen him in years.';
		const sentence = 'He guards an ancient tome.';
		const spanStart = body.indexOf(sentence);
		const spanEnd = spanStart + sentence.length;
		expect(spanStart).toBeGreaterThan(-1);

		const [rev] = await db
			.insert(revision)
			.values({
				universeId: u.id,
				entityId: wizard.id,
				authorKind: 'human',
				name: wizard.name,
				aliases: [],
				body
			})
			.returning();
		if (!rev) throw new Error('no revision');

		const [f] = await db
			.insert(fact)
			.values({
				universeId: u.id,
				entityId: wizard.id,
				statement: 'The wizard guards an ancient tome.',
				sourceRevisionId: rev.id,
				spanStart,
				spanEnd,
				authorKind: 'human'
			})
			.returning();
		if (!f) throw new Error('no fact');

		const resolved = await factWithSource(db, f.id);
		expect(resolved?.sourceExcerpt).toBe(sentence);
	});

	it('rejects a span where the end does not come after the start', async () => {
		const u = await insertHomebrewUniverse(db);
		const [e] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'X', slug: unique('x') })
			.returning();
		if (!e) throw new Error('no entity');
		const [rev] = await db
			.insert(revision)
			.values({
				universeId: u.id,
				entityId: e.id,
				authorKind: 'human',
				name: e.name,
				aliases: [],
				body: 'Some body text.'
			})
			.returning();
		if (!rev) throw new Error('no revision');

		await expectConstraintViolation(
			db.insert(fact).values({
				universeId: u.id,
				entityId: e.id,
				statement: 'Bad span',
				sourceRevisionId: rev.id,
				spanStart: 5,
				spanEnd: 5,
				authorKind: 'human'
			}),
			'fact_span_valid'
		);
	});
});
