import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	confirmSessionLog,
	isPubliclyVisible,
	listPublicEntities,
	publicEntityBySlug,
	publicMediaAssetById,
	publicMentionTargets,
	queueEntityForSessionLog,
	revealEntityLive,
	revealFactLive,
	revealRelationLive,
	setEntityCover,
	setMediaAssetPublished,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { fact } from '../src/schema/fact.js';
import { mediaAsset } from '../src/schema/media.js';
import { relation, relationType, relationTypeLabel } from '../src/schema/relation.js';
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

		// #220's root cause: the GM route's own mention-target query used to decide
		// "is this public" on its own, independently of this one. Proving this query's
		// result equals `isPubliclyVisible` applied to every entity in the universe is what
		// lets the GM route reuse that exported predicate instead of a second copy of the
		// `gm_only` rule - see `apps/web/src/lib/components/players/playerPreview.ts`.
		it('agrees with isPubliclyVisible for every entity in the universe', async () => {
			const { u } = await worldFixture();
			const all = await db.query.entity.findMany({
				where: (row, { eq }) => eq(row.universeId, u.id)
			});
			const expectedSlugs = all
				.filter((row) => isPubliclyVisible(row.visibility))
				.map((row) => row.slug)
				.sort();
			const targets = await publicMentionTargets(db, u.id);
			expect(targets.map((t) => t.slug).sort()).toEqual(expectedSlugs);
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

		// #198: `publicEntityBySlug`'s `locale` parameter, the players' wiki's own read.
		// Needs a relation between two *revealable* entities - `worldFixture`'s
		// `employsRelation` deliberately points at a gm_only faction for the test above,
		// so this builds its own pair.
		it('resolves a saved translation for the requested locale, falling back to the authored label otherwise', async () => {
			const { u, session } = await worldFixture();
			const [mentor] = await db
				.insert(entity)
				.values({ universeId: u.id, type: 'character', name: 'Mentor', slug: unique('mentor') })
				.returning();
			const [pupil] = await db
				.insert(entity)
				.values({ universeId: u.id, type: 'character', name: 'Pupil', slug: unique('pupil') })
				.returning();
			const [mentors] = await db
				.insert(relationType)
				.values({
					universeId: u.id,
					label: 'mentors',
					inverseLabel: 'mentored by',
					cardinality: 'one_to_many',
					allowedFrom: ['character'],
					allowedTo: ['character']
				})
				.returning();
			if (!mentor || !pupil || !mentors) throw new Error('fixture setup failed');
			const [mentorRelation] = await db
				.insert(relation)
				.values({
					universeId: u.id,
					relationTypeId: mentors.id,
					fromEntityId: mentor.id,
					toEntityId: pupil.id,
					authorKind: 'human'
				})
				.returning();
			if (!mentorRelation) throw new Error('fixture setup failed');
			await db.insert(relationTypeLabel).values({
				relationTypeId: mentors.id,
				locale: 'it',
				label: 'fa da mentore',
				inverseLabel: 'assistito da',
				authorKind: 'human'
			});
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: mentor.id,
				sessionEntityId: session.id
			});
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: pupil.id,
				sessionEntityId: session.id
			});
			await revealRelationLive(db, {
				universeId: u.id,
				relationId: mentorRelation.id,
				sessionEntityId: session.id
			});

			const noLocale = await publicEntityBySlug(db, u.id, mentor.slug);
			if (noLocale?.status !== 'full') throw new Error('expected a full entity');
			expect(noLocale.relations[0]?.label).toBe('mentors');

			const untranslatedLocale = await publicEntityBySlug(db, u.id, mentor.slug, 'en');
			if (untranslatedLocale?.status !== 'full') throw new Error('expected a full entity');
			expect(untranslatedLocale.relations[0]?.label).toBe('mentors');

			const translatedLocale = await publicEntityBySlug(db, u.id, mentor.slug, 'it');
			if (translatedLocale?.status !== 'full') throw new Error('expected a full entity');
			expect(translatedLocale.relations[0]?.label).toBe('fa da mentore');
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

		it('carries a cover only once that image is published, and never one the GM set but kept private (O2, #284)', async () => {
			const { u, session, aldric } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			const [portrait] = await db
				.insert(mediaAsset)
				.values({
					universeId: u.id,
					entityId: aldric.id,
					kind: 'image',
					path: '/media/cover-gate-portrait.png',
					mimeType: 'image/png',
					generated: true,
					publishedToPlayers: false
				})
				.returning();
			if (!portrait) throw new Error('fixture setup failed');
			await setEntityCover(db, { entityId: aldric.id, mediaAssetId: portrait.id });

			// Guardrail 6 has no exception for images, and a cover is not a special case of a
			// published one: setting it shows it to the GM and to nobody else.
			const beforePublish = await publicEntityBySlug(db, u.id, aldric.slug);
			if (beforePublish?.status !== 'full') throw new Error('expected a full entity');
			expect(beforePublish.coverImageId).toBeNull();
			expect(JSON.stringify(beforePublish)).not.toContain(portrait.id);

			await setMediaAssetPublished(db, portrait.id, true);
			const afterPublish = await publicEntityBySlug(db, u.id, aldric.slug);
			if (afterPublish?.status !== 'full') throw new Error('expected a full entity');
			expect(afterPublish.coverImageId).toBe(portrait.id);

			// And back: unpublishing is the same deliberate act in reverse, so the band goes
			// away again rather than surviving on the cover column alone.
			await setMediaAssetPublished(db, portrait.id, false);
			const afterUnpublish = await publicEntityBySlug(db, u.id, aldric.slug);
			if (afterUnpublish?.status !== 'full') throw new Error('expected a full entity');
			expect(afterUnpublish.coverImageId).toBeNull();
		});

		it('carries no cover when the entity has none, published images notwithstanding (O2, #284)', async () => {
			const { u, session, aldric } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			await db.insert(mediaAsset).values({
				universeId: u.id,
				entityId: aldric.id,
				kind: 'image',
				path: '/media/no-cover-portrait.png',
				mimeType: 'image/png',
				generated: true,
				publishedToPlayers: true
			});

			// A published picture is a gallery entry, never a cover by promotion: nothing but
			// a GM's own "use as cover" click writes that column (guardrail 1).
			const result = await publicEntityBySlug(db, u.id, aldric.slug);
			if (result?.status !== 'full') throw new Error('expected a full entity');
			expect(result.images).toHaveLength(1);
			expect(result.coverImageId).toBeNull();
		});
	});

	describe('publicMediaAssetById (#254)', () => {
		it('walks every publish/unpublish transition: invisible, visible once published, invisible again once unpublished', async () => {
			const { u, session, aldric } = await worldFixture();
			await revealEntityLive(db, {
				universeId: u.id,
				entityId: aldric.id,
				sessionEntityId: session.id
			});
			const [asset] = await db
				.insert(mediaAsset)
				.values({
					universeId: u.id,
					entityId: aldric.id,
					kind: 'image',
					path: '/media/publish-gate-portrait.png',
					mimeType: 'image/png',
					generated: true,
					publishedToPlayers: false
				})
				.returning();
			if (!asset) throw new Error('fixture setup failed');

			expect(await publicMediaAssetById(db, u.id, asset.id)).toBeUndefined();

			await setMediaAssetPublished(db, asset.id, true);
			expect(await publicMediaAssetById(db, u.id, asset.id)).toEqual({
				path: '/media/publish-gate-portrait.png',
				mimeType: 'image/png'
			});

			await setMediaAssetPublished(db, asset.id, false);
			expect(await publicMediaAssetById(db, u.id, asset.id)).toBeUndefined();
		});

		it('stays invisible for a gm_only entity even once its image is published - visibility outranks publication', async () => {
			const { u, ledger } = await worldFixture();
			const [asset] = await db
				.insert(mediaAsset)
				.values({
					universeId: u.id,
					entityId: ledger.id,
					kind: 'image',
					path: '/media/gm-only-portrait.png',
					mimeType: 'image/png',
					generated: true,
					publishedToPlayers: true
				})
				.returning();
			if (!asset) throw new Error('fixture setup failed');

			expect(await publicMediaAssetById(db, u.id, asset.id)).toBeUndefined();
		});

		it('stays invisible for a published image whose entity carries no confirmed revelation', async () => {
			const { u, aldric } = await worldFixture();
			// Deliberately no revealEntityLive call - aldric is revealable, but nothing at
			// the table has confirmed it yet.
			const [asset] = await db
				.insert(mediaAsset)
				.values({
					universeId: u.id,
					entityId: aldric.id,
					kind: 'image',
					path: '/media/unrevealed-portrait.png',
					mimeType: 'image/png',
					generated: true,
					publishedToPlayers: true
				})
				.returning();
			if (!asset) throw new Error('fixture setup failed');

			expect(await publicMediaAssetById(db, u.id, asset.id)).toBeUndefined();
		});
	});
});
