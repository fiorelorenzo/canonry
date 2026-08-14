import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	activeUniverseIds,
	closeDb,
	declareSessionContext,
	type Db,
	endSessionContext,
	findByFingerprint,
	latestArtifact,
	latestRevisionIds,
	markStale,
	pinnedNeighbors,
	putArtifact,
	recordConsumption,
	runningSessionContext,
	staleArtifacts
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType } from '../src/schema/relation.js';
import { revision } from '../src/schema/revision.js';
import { sessionContext, warmArtifact } from '../src/schema/table.js';
import { expectConstraintViolation, insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('warm queries', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function insertEntity(
		universeId: string,
		type: 'place' | 'character' | 'faction',
		name?: string
	) {
		const slug = unique(type);
		const [row] = await db
			.insert(entity)
			.values({ universeId, type, name: name ?? slug, slug })
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		return row;
	}

	async function insertRevision(universeId: string, entityId: string) {
		const [row] = await db
			.insert(revision)
			.values({ universeId, entityId, authorKind: 'human', name: 'r', body: unique('body') })
			.returning();
		if (!row) throw new Error('revision insert returned no row');
		return row;
	}

	async function insertRelation(
		universeId: string,
		fromEntityId: string,
		toEntityId: string,
		label: string
	) {
		const [type] = await db
			.select()
			.from(relationType)
			.where(eq(relationType.label, label))
			.limit(1);
		if (!type) throw new Error(`no shipped relation type "${label}"`);
		await db.insert(relation).values({
			universeId,
			relationTypeId: type.id,
			fromEntityId,
			toEntityId,
			authorKind: 'human'
		});
	}

	describe('latestRevisionIds', () => {
		it('maps each entity to its newest revision, and to null when it has none', async () => {
			const u = await insertHomebrewUniverse(db);
			const withRevisions = await insertEntity(u.id, 'place');
			const withoutRevisions = await insertEntity(u.id, 'place');
			await insertRevision(u.id, withRevisions.id);
			const newest = await insertRevision(u.id, withRevisions.id);

			const map = await latestRevisionIds(db, [withRevisions.id, withoutRevisions.id]);
			expect(map.get(withRevisions.id)).toBe(newest.id);
			expect(map.get(withoutRevisions.id)).toBeNull();
		});

		it('returns an empty map for an empty input without querying', async () => {
			const map = await latestRevisionIds(db, []);
			expect(map.size).toBe(0);
		});
	});

	describe('findByFingerprint, latestArtifact, putArtifact, markStale, recordConsumption', () => {
		it('findByFingerprint is an exact match on kind + subject + fingerprint', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place');
			const saved = await putArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: place.id,
				payload: { text: 'hi' },
				fingerprint: 'fp-1',
				credits: 2
			});

			const found = await findByFingerprint(db, {
				kind: 'brief',
				subjectEntityId: place.id,
				fingerprint: 'fp-1'
			});
			expect(found?.id).toBe(saved.id);

			const miss = await findByFingerprint(db, {
				kind: 'brief',
				subjectEntityId: place.id,
				fingerprint: 'fp-2'
			});
			expect(miss).toBeNull();
		});

		it('latestArtifact returns the newest row for a (kind, subject) slot', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place');
			await putArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: place.id,
				payload: {},
				fingerprint: 'fp-a',
				credits: 1
			});
			const second = await putArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: place.id,
				payload: {},
				fingerprint: 'fp-b',
				credits: 1
			});

			const latest = await latestArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: place.id
			});
			expect(latest?.id).toBe(second.id);
		});

		it('markStale flips stale without touching payload or fingerprint, and is a no-op once already stale', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place');
			const saved = await putArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: place.id,
				payload: { text: 'original' },
				fingerprint: 'fp-1',
				credits: 1
			});

			await markStale(db, saved.id);
			const [after] = await db.select().from(warmArtifact).where(eq(warmArtifact.id, saved.id));
			expect(after?.stale).toBe(true);
			expect(after?.payload).toEqual({ text: 'original' });
			expect(after?.fingerprint).toBe('fp-1');

			// Calling it again is a harmless no-op, not an error.
			await markStale(db, saved.id);
			const [still] = await db.select().from(warmArtifact).where(eq(warmArtifact.id, saved.id));
			expect(still?.stale).toBe(true);
		});

		it('recordConsumption increments the counter and stamps lastConsumedAt', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place');
			const saved = await putArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: place.id,
				payload: {},
				fingerprint: 'fp-1',
				credits: 1
			});
			expect(saved.consumedCount).toBe(0);

			await recordConsumption(db, saved.id);
			await recordConsumption(db, saved.id);
			const [after] = await db.select().from(warmArtifact).where(eq(warmArtifact.id, saved.id));
			expect(after?.consumedCount).toBe(2);
			expect(after?.lastConsumedAt).not.toBeNull();
		});

		it('putArtifact reuses the existing row on a unique-index race for a non-null subject', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place');
			const input = {
				universeId: u.id,
				kind: 'brief' as const,
				subjectEntityId: place.id,
				payload: { text: 'first' },
				fingerprint: 'fp-race',
				credits: 1
			};
			const first = await putArtifact(db, input);
			// A second insert with the identical (kind, subject, fingerprint) hits the unique
			// index rather than duplicating - putArtifact treats that as "already landed".
			const second = await putArtifact(db, { ...input, payload: { text: 'second' } });
			expect(second.id).toBe(first.id);
			expect(second.payload).toEqual({ text: 'first' });
		});

		it('staleArtifacts lists only stale rows for a universe, oldest first', async () => {
			const u = await insertHomebrewUniverse(db);
			const placeA = await insertEntity(u.id, 'place');
			const placeB = await insertEntity(u.id, 'place');
			const fresh = await putArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: placeA.id,
				payload: {},
				fingerprint: 'fp-fresh',
				credits: 1
			});
			const stale = await putArtifact(db, {
				universeId: u.id,
				kind: 'brief',
				subjectEntityId: placeB.id,
				payload: {},
				fingerprint: 'fp-stale',
				credits: 1
			});
			await markStale(db, stale.id);

			const rows = await staleArtifacts(db, u.id);
			expect(rows.map((r) => r.id)).toEqual([stale.id]);
			expect(rows.map((r) => r.id)).not.toContain(fresh.id);
		});
	});

	describe('session_context', () => {
		it('declareSessionContext ends the previous running context and starts exactly one new one', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place');

			const first = await declareSessionContext(db, { universeId: u.id, placeEntityId: place.id });
			expect(first.endedAt).toBeNull();

			const second = await declareSessionContext(db, { universeId: u.id, moment: 'later' });
			expect(second.id).not.toBe(first.id);

			const [endedFirst] = await db
				.select()
				.from(sessionContext)
				.where(eq(sessionContext.id, first.id));
			expect(endedFirst?.endedAt).not.toBeNull();

			const running = await runningSessionContext(db, u.id);
			expect(running?.id).toBe(second.id);
		});

		it('the schema itself refuses two running contexts for the same universe', async () => {
			const u = await insertHomebrewUniverse(db);
			await db.insert(sessionContext).values({ universeId: u.id });
			await expectConstraintViolation(
				db.insert(sessionContext).values({ universeId: u.id }),
				'session_context_running_key'
			);
		});

		it('endSessionContext closes the running context and returns null when there is none', async () => {
			const u = await insertHomebrewUniverse(db);
			await declareSessionContext(db, { universeId: u.id });

			const closed = await endSessionContext(db, u.id);
			expect(closed?.endedAt).not.toBeNull();

			const again = await endSessionContext(db, u.id);
			expect(again).toBeNull();

			const stillRunning = await db
				.select()
				.from(sessionContext)
				.where(and(eq(sessionContext.universeId, u.id), isNull(sessionContext.endedAt)));
			expect(stillRunning).toHaveLength(0);
		});
	});

	describe('pinnedNeighbors: the instant-lane 2-hop query', () => {
		it('reports the shortest hop distance and the relation reaching each neighbor', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place', 'Valdoria');
			const watch = await insertEntity(u.id, 'faction', 'The Valdoria Watch');
			const captain = await insertEntity(u.id, 'character', 'Aldric Vane');
			const unrelated = await insertEntity(u.id, 'place', 'Somewhere Else');

			await insertRelation(u.id, watch.id, place.id, 'located in');
			await insertRelation(u.id, captain.id, watch.id, 'member of');

			const pinned = await pinnedNeighbors(db, place.id);
			const byId = new Map(pinned.map((n) => [n.entity.id, n]));

			expect(byId.get(watch.id)?.hopDistance).toBe(1);
			expect(byId.get(watch.id)?.via).toEqual({
				relationLabel: 'contains',
				entityId: place.id,
				entityName: 'Valdoria'
			});
			expect(byId.get(captain.id)?.hopDistance).toBe(2);
			expect(byId.get(captain.id)?.via?.entityId).toBe(watch.id);
			expect(byId.has(unrelated.id)).toBe(false);
			expect(byId.has(place.id)).toBe(false); // never includes the place itself
		});

		it('honors a custom hop limit', async () => {
			const u = await insertHomebrewUniverse(db);
			const place = await insertEntity(u.id, 'place');
			const watch = await insertEntity(u.id, 'faction');
			const captain = await insertEntity(u.id, 'character');
			await insertRelation(u.id, watch.id, place.id, 'located in');
			await insertRelation(u.id, captain.id, watch.id, 'member of');

			const ring1 = await pinnedNeighbors(db, place.id, { hops: 1 });
			expect(ring1.map((n) => n.entity.id)).toEqual([watch.id]);
		});
	});

	describe('activeUniverseIds', () => {
		it('includes a universe with a recent revision or a recent session_context, excludes an old one', async () => {
			const active = await insertHomebrewUniverse(db);
			const activePlace = await insertEntity(active.id, 'place');
			await insertRevision(active.id, activePlace.id);

			const dormant = await insertHomebrewUniverse(db);
			const dormantPlace = await insertEntity(dormant.id, 'place');
			const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
			await db.insert(revision).values({
				universeId: dormant.id,
				entityId: dormantPlace.id,
				authorKind: 'human',
				name: 'r',
				body: 'old',
				createdAt: oldDate
			});

			const ids = await activeUniverseIds(db, 30);
			expect(ids).toContain(active.id);
			expect(ids).not.toContain(dormant.id);
		});
	});
});
