import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { fact } from '../src/schema/fact.js';
import { relation, relationType } from '../src/schema/relation.js';
import { revision } from '../src/schema/revision.js';
import { universe } from '../src/schema/universe.js';
import {
	expectConstraintViolation,
	insertHomebrewUniverse,
	insertUser,
	testDb,
	unique
} from './helpers.js';

describe('universe', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('lets a homebrew universe have no base', async () => {
		const row = await insertHomebrewUniverse(db);
		expect(row.kind).toBe('homebrew');
		expect(row.baseUniverseId).toBeNull();
	});

	it('rejects a homebrew universe that names a base', async () => {
		const base = await insertHomebrewUniverse(db);
		await expectConstraintViolation(
			db.insert(universe).values({
				ownerUserId: unique('owner'),
				name: 'Bad homebrew',
				slug: unique('universe'),
				kind: 'homebrew',
				baseUniverseId: base.id
			}),
			'universe_derived_has_base'
		);
	});

	it('requires a derived universe to name a base', async () => {
		await expectConstraintViolation(
			db.insert(universe).values({
				ownerUserId: unique('owner'),
				name: 'Bad derived',
				slug: unique('universe'),
				kind: 'derived'
			}),
			'universe_derived_has_base'
		);
	});

	it('accepts a derived universe that names a base', async () => {
		const base = await insertHomebrewUniverse(db);
		const owner = await insertUser(db);
		const [derived] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Good derived',
				slug: unique('universe'),
				kind: 'derived',
				baseUniverseId: base.id
			})
			.returning();
		expect(derived?.baseUniverseId).toBe(base.id);
	});

	it('makes slug uniqueness global rather than scoped to the owner (decision J1, issue #153)', async () => {
		const slug = unique('shared-slug');
		const ownerA = (await insertUser(db)).id;
		const ownerB = (await insertUser(db)).id;

		await db.insert(universe).values({ ownerUserId: ownerA, name: 'A', slug, kind: 'homebrew' });
		// Same slug, different owner: rejected now that /w/<slug> carries no owner to
		// disambiguate - this is the schema half of #153's fix.
		await expectConstraintViolation(
			db.insert(universe).values({ ownerUserId: ownerB, name: 'B', slug, kind: 'homebrew' }),
			'universe_slug_key'
		);
		// Same slug, same owner again: still rejected, same global constraint.
		await expectConstraintViolation(
			db.insert(universe).values({ ownerUserId: ownerA, name: 'A2', slug, kind: 'homebrew' }),
			'universe_slug_key'
		);
	});

	it('a numeric-suffix retry on the global unique index resolves two same-named universes under different owners to different slugs', async () => {
		// Mirrors createOnboardingUniverse's retry loop (apps/web/src/lib/server/onboarding.ts):
		// insert the bare slug, and on a 23505 unique_violation retry with "-2", "-3", ... The
		// mechanism itself is app-layer code this package cannot import, but the constraint it
		// races against is universe_slug_key, and that is what this test proves - decision J1's
		// accepted cost is that the second GM to want a name gets a suffix, not a collision.
		async function insertWithSuffixRetry(ownerUserId: string, base: string) {
			for (let attempt = 0; attempt < 5; attempt++) {
				const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
				try {
					const [row] = await db
						.insert(universe)
						.values({ ownerUserId, name: base, slug, kind: 'homebrew' })
						.returning();
					if (!row) throw new Error('insert returned no row');
					return row;
				} catch (err) {
					const cause = err && typeof err === 'object' && 'cause' in err ? err.cause : undefined;
					const isUniqueViolation =
						cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505';
					if (!isUniqueViolation) throw err;
				}
			}
			throw new Error(`could not find a free slug for "${base}"`);
		}

		const base = unique('shared-name');
		const ownerA = (await insertUser(db)).id;
		const ownerB = (await insertUser(db)).id;

		const first = await insertWithSuffixRetry(ownerA, base);
		const second = await insertWithSuffixRetry(ownerB, base);

		expect(first.slug).toBe(base);
		expect(second.slug).toBe(`${base}-2`);
		expect(second.ownerUserId).toBe(ownerB);
	});

	it('cascades delete to entities, relations, facts and revisions', async () => {
		const u = await insertHomebrewUniverse(db);

		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'guards',
				inverseLabel: 'guarded by',
				cardinality: 'one_to_many',
				allowedFrom: ['character'],
				allowedTo: ['character']
			})
			.returning();
		if (!rt) throw new Error('no relation type');

		const [entityA] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Guard', slug: unique('entity') })
			.returning();
		const [entityB] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'character', name: 'Ward', slug: unique('entity') })
			.returning();
		if (!entityA || !entityB) throw new Error('no entities');

		const [rev] = await db
			.insert(revision)
			.values({
				universeId: u.id,
				entityId: entityA.id,
				authorKind: 'human',
				name: entityA.name,
				aliases: [],
				body: 'The guard stands watch.'
			})
			.returning();
		if (!rev) throw new Error('no revision');

		await db.insert(relation).values({
			universeId: u.id,
			relationTypeId: rt.id,
			fromEntityId: entityA.id,
			toEntityId: entityB.id,
			authorKind: 'human'
		});

		await db.insert(fact).values({
			universeId: u.id,
			entityId: entityA.id,
			statement: 'The guard stands watch.',
			sourceRevisionId: rev.id,
			spanStart: 0,
			spanEnd: 24,
			authorKind: 'human'
		});

		await db.delete(universe).where(eq(universe.id, u.id));

		const remainingEntities = await db.select().from(entity).where(eq(entity.universeId, u.id));
		const remainingRelations = await db
			.select()
			.from(relation)
			.where(eq(relation.universeId, u.id));
		const remainingFacts = await db.select().from(fact).where(eq(fact.universeId, u.id));
		const remainingRevisions = await db
			.select()
			.from(revision)
			.where(eq(revision.universeId, u.id));

		expect(remainingEntities).toHaveLength(0);
		expect(remainingRelations).toHaveLength(0);
		expect(remainingFacts).toHaveLength(0);
		expect(remainingRevisions).toHaveLength(0);
	});
});
