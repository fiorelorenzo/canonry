/**
 * Issue #638: a vocabulary question carries how many relations are waiting on it.
 *
 * A first import of the OneNote notebook asks 133 of these and 194 relations wait on the
 * answers, and the weight is nowhere near flat: one question carries 11, another 7, two
 * carry 6, and 103 carry exactly one. Nothing recorded that, so the review queue read them
 * by `created_at` and the 11-relation question sat wherever in the hundred it happened to
 * be emitted (position 16, as it turned out).
 *
 * `rank` is the column for it. Everywhere else it means "ordering inside a plan", which is
 * what survives decision C3's candidate cap, and a vocabulary question is a plan of exactly
 * one candidate, so that meaning had nothing to do here and the column sat at its default of
 * 0 for all 133. It now holds the count, written by the fold rather than once at creation,
 * because a question's weight is only settled when the job ends: `situata in` reaches its 11
 * one sighting at a time across 88 documents.
 *
 * Both cases fail on 9a8a4f8, where every vocabulary proposal keeps `rank` 0 whatever it
 * accumulates.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	createImportJob,
	getProposal,
	proposeRelationTypeVocabulary,
	type Db,
	type RelationTypeVocabPatch,
	type RelationTypeWaitingRelation
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relationType } from '../src/schema/relation.js';
import { insertHomebrewUniverse, insertUser, testDb, unique } from './helpers.js';

describe('a vocabulary question is ranked by what it unblocks (issue #638)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function realEntity(
		universeId: string,
		type: 'character' | 'place' | 'faction',
		name: string
	): Promise<string> {
		const [row] = await db
			.insert(entity)
			.values({
				universeId,
				type,
				name,
				slug: unique(name.toLowerCase()),
				aliases: [],
				body: `${name} exists.`
			})
			.returning({ id: entity.id });
		if (!row) throw new Error('entity insert returned no row');
		return row.id;
	}

	function waiting(fromEntityId: string, toEntityId: string): RelationTypeWaitingRelation {
		return {
			fromEntityId,
			toEntityId,
			rationale: 'the page says so',
			evidence: { documentId: unique('doc') }
		};
	}

	async function setup() {
		const user = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: user.id });
		const job = await createImportJob(db, {
			universeId: universe.id,
			createdBy: user.id,
			sourceType: 'onenote',
			playbook: 'onenote',
			playbookVersion: 1,
			artefactPath: '/dev/null',
			artefactBytes: 1024,
			artefactSha256: unique('sha'),
			documentCount: 3,
			budgetCredits: 100
		});
		return { universeId: universe.id, jobId: job.id };
	}

	it('rises with every sighting that folds into the same question', async () => {
		const { universeId, jobId } = await setup();
		const label = unique('situata in');
		const places = await Promise.all([
			realEntity(universeId, 'place', 'Cairnmouth'),
			realEntity(universeId, 'place', 'Valdoria'),
			realEntity(universeId, 'place', 'Il Porto')
		]);
		const people = await Promise.all([
			realEntity(universeId, 'character', 'Aldric'),
			realEntity(universeId, 'character', 'Mirenna'),
			realEntity(universeId, 'character', 'Corvin')
		]);

		const resolution = {
			kind: 'relation_type_new' as const,
			label,
			inverseLabel: unique('contiene'),
			cardinality: 'many_to_one' as const,
			fromType: 'character' as const,
			toType: 'place' as const,
			why: 'No existing type reads as this.'
		};

		const first = await proposeRelationTypeVocabulary(db, {
			universeId,
			importJobId: jobId,
			resolution,
			relation: waiting(people[0]!, places[0]!),
			provider: 'import',
			modelId: 'onenote'
		});
		expect(first.created).toBe(true);
		// One relation is waiting the moment the question exists, so the queue has something
		// true to order by even before a second document sees the same label.
		expect((await getProposal(db, first.proposalId))?.rank).toBe(1);

		for (let i = 1; i < 3; i++) {
			const again = await proposeRelationTypeVocabulary(db, {
				universeId,
				importJobId: jobId,
				resolution,
				relation: waiting(people[i]!, places[i]!),
				provider: 'import',
				modelId: 'onenote'
			});
			// Same question, so it folds rather than asking twice (#190's own shape).
			expect(again.created).toBe(false);
			expect(again.proposalId).toBe(first.proposalId);
			const row = await getProposal(db, first.proposalId);
			expect(row?.rank).toBe(i + 1);
		}

		// And the rank is the count, not a counter of its own: it always equals what the
		// card reads off the patch, which is what the queue's ordering claims to mean.
		const row = await getProposal(db, first.proposalId);
		const patch = row?.patch as RelationTypeVocabPatch;
		expect(patch.relations).toHaveLength(3);
		expect(row?.rank).toBe(patch.relations.length);
	});

	it('leaves the questions with one sighting at one, which is most of a real import', async () => {
		const { universeId, jobId } = await setup();
		const from = await realEntity(universeId, 'character', 'Iselde');
		const to = await realEntity(universeId, 'faction', 'La Corona');

		const ranks: number[] = [];
		for (let i = 0; i < 4; i++) {
			const created = await proposeRelationTypeVocabulary(db, {
				universeId,
				importJobId: jobId,
				// Four different labels, so each one is its own question rather than a fold.
				resolution: {
					kind: 'relation_type_new',
					label: unique(`giura a ${i}`),
					inverseLabel: unique(`riceve giuramento ${i}`),
					cardinality: 'many_to_many',
					fromType: 'character',
					toType: 'faction',
					why: 'No existing type reads as this.'
				},
				relation: waiting(from, to),
				provider: 'import',
				modelId: 'onenote'
			});
			expect(created.created).toBe(true);
			const row = await getProposal(db, created.proposalId);
			ranks.push(row?.rank ?? -1);
		}
		expect(ranks).toEqual([1, 1, 1, 1]);
	});

	it('ranks a reuse and a widen question the same way, since the queue orders all three kinds', async () => {
		const { universeId, jobId } = await setup();
		const from = await realEntity(universeId, 'character', 'Thanaak');
		const to = await realEntity(universeId, 'faction', 'Il Culto');
		const [shipped] = await db
			.select({ id: relationType.id })
			.from(relationType)
			.where(and(eq(relationType.label, 'member of'), isNull(relationType.universeId)))
			.limit(1);
		if (!shipped) throw new Error('no shipped "member of" relation type');
		const existingTypeId = shipped.id;

		const reuse = await proposeRelationTypeVocabulary(db, {
			universeId,
			importJobId: jobId,
			resolution: {
				kind: 'relation_type_reuse',
				existingTypeId,
				proposedLabel: unique('fa parte di'),
				why: 'Reads as the same relation.'
			},
			relation: waiting(from, to),
			provider: 'import',
			modelId: 'onenote'
		});
		expect((await getProposal(db, reuse.proposalId))?.rank).toBe(1);

		const widen = await proposeRelationTypeVocabulary(db, {
			universeId,
			importJobId: jobId,
			resolution: {
				kind: 'relation_type_widen',
				existingTypeId,
				addFrom: 'faction',
				addTo: null,
				why: 'Does not admit this pair yet.'
			},
			relation: waiting(to, from),
			provider: 'import',
			modelId: 'onenote'
		});
		const widenAgain = await proposeRelationTypeVocabulary(db, {
			universeId,
			importJobId: jobId,
			resolution: {
				kind: 'relation_type_widen',
				existingTypeId,
				addFrom: 'faction',
				addTo: null,
				why: 'Does not admit this pair yet.'
			},
			relation: waiting(to, from),
			provider: 'import',
			modelId: 'onenote'
		});
		expect(widenAgain.proposalId).toBe(widen.proposalId);
		expect((await getProposal(db, widen.proposalId))?.rank).toBe(2);
	});
});
