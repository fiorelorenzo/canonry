import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	confirmSessionLog,
	listPublicEntities,
	publicEntityBySlug,
	publicMentionTargets,
	queueEntityForSessionLog,
	revealEntityLive,
	revealFactLive,
	revealRelationLive,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { fact } from '../src/schema/fact.js';
import { mediaAsset } from '../src/schema/media.js';
import { relation, relationType } from '../src/schema/relation.js';
import { revision } from '../src/schema/revision.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('players', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	/** A universe with one session entity and two revealable characters connected by a
	 * relation, plus a gm_only faction Aldric's entry mentions by name (mirroring
	 * export.test.ts's Secret Villain fixture) - the shape every test below shares. */
	async function worldFixture() {
		const u = await insertHomebrewUniverse(db);
		const [session] = await db
			.insert(entity)
			.values({ universeId: u.id, type: 'session', name: 'Session 1', slug: unique('session') })
			.returning();
		const body =
			'Dismissed from the watch, he now answers to the Ashen Ledger. Nobody has said so aloud.';
		const [aldric] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'character',
				name: 'Aldric Vane',
				slug: unique('aldric'),
				body
			})
			.returning();
		const [ledger] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'faction',
				name: 'The Ashen Ledger',
				slug: unique('ledger'),
				visibility: 'gm_only',
				body: 'GM-only body nobody but the table owner should read.'
			})
			.returning();
		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'employs',
				inverseLabel: 'employed by',
				cardinality: 'many_to_many',
				allowedFrom: ['faction'],
				allowedTo: ['character']
			})
			.returning();
		if (!session || !aldric || !ledger || !rt) throw new Error('fixture setup failed');
		const [employsRelation] = await db
			.insert(relation)
			.values({
				universeId: u.id,
				relationTypeId: rt.id,
				fromEntityId: ledger.id,
				toEntityId: aldric.id,
				authorKind: 'human'
			})
			.returning();
		const [rev] = await db
			.insert(revision)
			.values({
				universeId: u.id,
				entityId: aldric.id,
				authorKind: 'human',
				name: aldric.name,
				body
			})
			.returning();
		if (!employsRelation || !rev) throw new Error('fixture setup failed');
		const sentence = 'Dismissed from the watch';
		const spanStart = body.indexOf(sentence);
		const [dismissedFact] = await db
			.insert(fact)
			.values({
				universeId: u.id,
				entityId: aldric.id,
				statement: 'Aldric was dismissed from the watch.',
				sourceRevisionId: rev.id,
				spanStart,
				spanEnd: spanStart + sentence.length,
				authorKind: 'human'
			})
			.returning();
		if (!dismissedFact) throw new Error('fixture setup failed');
		return { u, session, aldric, ledger, rt, employsRelation, rev, dismissedFact };
	}

	describe('revealEntityLive', () => {
		it('is idempotent: a second live tap in the same session never moves confirmed_at', async () => {
			const { u, session, aldric } = await worldFixture();
			const first = await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			const second = await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			expect(second.id).toBe(first.id);
			expect(second.confirmedAt?.getTime()).toBe(first.confirmedAt?.getTime());
		});
	});

	describe('queueEntityForSessionLog / confirmSessionLog', () => {
		it('a queued row is invisible until the session log is confirmed', async () => {
			const { u, session, aldric } = await worldFixture();
			await queueEntityForSessionLog(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});

			const beforeConfirm = await publicEntityBySlug(db, u.id, aldric.slug);
			expect(beforeConfirm?.status).toBe('gap');

			const confirmed = await confirmSessionLog(db, { sessionEntityId: session.id });
			expect(confirmed).toHaveLength(1);

			const afterConfirm = await publicEntityBySlug(db, u.id, aldric.slug);
			expect(afterConfirm?.status).toBe('full');
		});

		it('confirming twice only confirms the still-pending rows once', async () => {
			const { u, session, aldric } = await worldFixture();
			await queueEntityForSessionLog(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			const first = await confirmSessionLog(db, { sessionEntityId: session.id });
			const second = await confirmSessionLog(db, { sessionEntityId: session.id });
			expect(first).toHaveLength(1);
			expect(second).toHaveLength(0);
		});
	});

	describe('listPublicEntities', () => {
		it('excludes gm_only entirely and marks an unrevealed entity as a gap', async () => {
			const { u, aldric, ledger } = await worldFixture();
			const rows = await listPublicEntities(db, u.id);
			expect(rows.map((r) => r.id)).not.toContain(ledger.id);
			const aldricRow = rows.find((r) => r.id === aldric.id);
			expect(aldricRow?.status).toBe('gap');
		});

		it('marks a live-revealed entity as full, with a revealedAt timestamp', async () => {
			const { u, session, aldric } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			const rows = await listPublicEntities(db, u.id);
			const aldricRow = rows.find((r) => r.id === aldric.id);
			expect(aldricRow?.status).toBe('full');
			expect(aldricRow?.revealedAt).toBeInstanceOf(Date);
		});
	});

	describe('publicMentionTargets', () => {
		it('never includes a gm_only entity', async () => {
			const { u, aldric, ledger } = await worldFixture();
			const targets = await publicMentionTargets(db, u.id);
			expect(targets.map((t) => t.slug)).toContain(aldric.slug);
			expect(targets.map((t) => t.slug)).not.toContain(ledger.slug);
		});
	});

	describe('publicEntityBySlug', () => {
		it('returns undefined for a slug that does not exist', async () => {
			const { u } = await worldFixture();
			expect(await publicEntityBySlug(db, u.id, 'no-such-entity')).toBeUndefined();
		});

		it('returns undefined for a gm_only entity, indistinguishable from not existing', async () => {
			const { u, ledger } = await worldFixture();
			expect(await publicEntityBySlug(db, u.id, ledger.slug)).toBeUndefined();
		});

		it('returns the E7 gap shape for a revealable entity with no confirmed revelation: name and type only', async () => {
			const { u, aldric } = await worldFixture();
			const result = await publicEntityBySlug(db, u.id, aldric.slug);
			expect(result).toEqual({ status: 'gap', name: 'Aldric Vane', type: 'character' });
		});

		it('returns the full shape once revealed, with unrevealed facts and relations excluded', async () => {
			const { u, session, aldric } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});

			const result = await publicEntityBySlug(db, u.id, aldric.slug);
			if (result?.status !== 'full') throw new Error('expected a full entity');
			expect(result.name).toBe('Aldric Vane');
			expect(result.body).toContain('Dismissed from the watch');
			expect(result.facts).toEqual([]);
			expect(result.relations).toEqual([]);
			expect(result.revealedInSession).toBe('Session 1');
		});

		it('includes a fact only once it has its own confirmed revelation', async () => {
			const { u, session, aldric, dismissedFact } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			await revealFactLive(db, {
				universeId: u.id,
				factId: dismissedFact.id,
				sessionEntityId: session.id
			});

			const result = await publicEntityBySlug(db, u.id, aldric.slug);
			if (result?.status !== 'full') throw new Error('expected a full entity');
			expect(result.facts).toHaveLength(1);
			expect(result.facts[0]?.sourceExcerpt).toBe('Dismissed from the watch');
		});

		it('a revealed relation to a gm_only entity never surfaces, even if someone revealed it', async () => {
			const { u, session, aldric, employsRelation } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			// Defense in depth: reveal the relation anyway and confirm the gm_only other side
			// still never appears in the public payload.
			await revealRelationLive(db, {
				universeId: u.id,
				relationId: employsRelation.id,
				sessionEntityId: session.id
			});

			const result = await publicEntityBySlug(db, u.id, aldric.slug);
			if (result?.status !== 'full') throw new Error('expected a full entity');
			expect(result.relations).toEqual([]);
		});

		it('only a published image ever appears, never an unpublished one', async () => {
			const { u, session, aldric } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			await db.insert(mediaAsset).values([
				{
					universeId: u.id,
					entityId: aldric.id,
					kind: 'image',
					path: '/media/unpublished-portrait.png',
					mimeType: 'image/png',
					generated: true,
					publishedToPlayers: false,
					prompt: 'a secret prompt nobody should see'
				},
				{
					universeId: u.id,
					entityId: aldric.id,
					kind: 'image',
					path: '/media/published-portrait.png',
					mimeType: 'image/png',
					generated: true,
					publishedToPlayers: true
				}
			]);

			const result = await publicEntityBySlug(db, u.id, aldric.slug);
			if (result?.status !== 'full') throw new Error('expected a full entity');
			expect(result.images).toHaveLength(1);
			expect(JSON.stringify(result)).not.toContain('unpublished-portrait');
			expect(JSON.stringify(result)).not.toContain('secret prompt');
		});
	});
});
