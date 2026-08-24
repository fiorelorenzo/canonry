/**
 * Issues #669 and #689: two labels that differ only in Italian gender agreement, only in an
 * enclitic article, or only in a leading copula, are one vocabulary question rather than two.
 *
 * The normaliser change alone does not achieve this, which is the part of #669 worth writing
 * down. `resolveRelationType`'s rung 1 compares a proposed label against the *catalogue*, and on
 * the recorded Italian notebook not one of the 130 questions is a gender or article edge away
 * from a shipped string, so teaching rung 1 Italian agreement removes zero questions there. What
 * removes them is this: `dedupKeyFor` used to group `relation_type_new` questions on case and
 * whitespace only, so `fondata da` and `fondato da` reached the review queue as two questions
 * after rung 1 had already established they are one label. Seven of that notebook's 130
 * questions, covering 27 relations, are that shape and nothing else, and #689's copula adds an
 * eighth covering 4 more.
 *
 * Every #669 case here fails on 2ef81b0, where the two labels produce two proposals. Of the two
 * #689 cases, the copula fold fails on 1d656be and the `has member` control passes either way,
 * which is what a control is for.
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

describe('a vocabulary question is one question per normalised label (issue #669)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function realEntity(universeId: string, name: string): Promise<string> {
		const [row] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'place',
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

	/** A fresh job per case, because the fold is scoped to one import job. */
	async function setup(): Promise<{ universeId: string; jobId: string; from: string; to: string }> {
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
		return {
			universeId: universe.id,
			jobId: job.id,
			from: await realEntity(universe.id, 'Cairnmouth'),
			to: await realEntity(universe.id, 'Valdoria')
		};
	}

	/** Asks each label once against a fresh job and returns the proposal ids, in order. */
	async function ask(labels: string[]): Promise<string[]> {
		const { universeId, jobId, from, to } = await setup();
		const ids: string[] = [];
		for (const label of labels) {
			const result = await proposeRelationTypeVocabulary(db, {
				universeId,
				importJobId: jobId,
				resolution: {
					kind: 'relation_type_new',
					label,
					inverseLabel: `inverse of ${label}`,
					cardinality: 'many_to_one',
					fromType: 'place',
					toType: 'place',
					why: 'No existing type reads as this.'
				},
				relation: waiting(from, to),
				provider: 'import',
				modelId: 'onenote'
			});
			ids.push(result.proposalId);
		}
		return ids;
	}

	it('asks once for a feminine and a masculine participle of the same label', async () => {
		const [first, second] = await ask(['fondata da', 'fondato da']);

		expect(second).toBe(first);
		const row = await getProposal(db, first!);
		const patch = row?.patch as RelationTypeVocabPatch;
		// Both relations are waiting on the one question, which is what the GM answers once.
		expect(patch.relations).toHaveLength(2);
		expect(row?.rank).toBe(2);
	});

	it('keeps the label the model actually wrote first, rather than the normalised form', async () => {
		// Guardrail 1: the question a GM reads is words a model proposed, never a string this
		// normaliser invented. `fondato da` is a real label; `fondat da` would not be.
		const [first] = await ask(['fondata da', 'fondato da']);
		const patch = (await getProposal(db, first!))?.patch as RelationTypeVocabPatch;
		if (patch.kind !== 'relation_type_new') throw new Error('unreachable');
		expect(patch.label).toBe('fondata da');
	});

	it("folds the four agreement and article variants of the notebook's largest question", async () => {
		// `situata in` carries 11 relations in the recorded run and the other three carry 2 each,
		// so on that corpus this single fold is four questions becoming one and 17 relations
		// arriving behind one answer.
		const ids = await ask(['situata in', 'situato in', 'situato nel', 'situato nella']);

		expect(new Set(ids).size).toBe(1);
		expect((await getProposal(db, ids[0]!))?.rank).toBe(4);
	});

	it('asks twice when two labels differ by more than agreement or an article', async () => {
		// The control, and the one that matters: the collapse must be narrow. `in` and `a` are
		// different prepositions and `fondata`/`guidata` are different verbs, so these stay
		// separate questions and no permanent key is shared between them.
		const ids = await ask(['situata in', 'situata a', 'guidata da', 'fondata da']);

		expect(new Set(ids).size).toBe(4);
	});

	it('asks twice for two English labels that merely end alike', async () => {
		// `errata` and `vendetta` end in a participle termination and are followed by an English
		// preposition, so the gender rule never fires and neither collapses onto anything.
		const ids = await ask(['errata of', 'errato of', 'vendetta with', 'vendetto with']);

		expect(new Set(ids).size).toBe(4);
	});

	it('asks once for a label with a leading copula and the same label without it (issue #689)', async () => {
		// `è sindaco di` carries 2 relations in the recorded run and `sindaco di` 2, and they are
		// the one question #689's rule collapses on that corpus. Rung 1 cannot reach it: neither
		// label is any distance from a shipped string, so this key is the whole mechanism.
		const ids = await ask(['è sindaco di', 'sindaco di']);

		expect(new Set(ids).size).toBe(1);
		const row = await getProposal(db, ids[0]!);
		expect(row?.rank).toBe(2);
		// Guardrail 1 again: the question a GM reads is the label a model wrote, copula included.
		const patch = row?.patch as RelationTypeVocabPatch;
		if (patch.kind !== 'relation_type_new') throw new Error('unreachable');
		expect(patch.label).toBe('è sindaco di');
	});

	it('asks twice for the two labels a leading strip would have merged wrongly (issue #689)', async () => {
		// `has member` is `member_of`'s shipped English inverse label and `ha come membro` its
		// Italian one, which is why the rule strips copulas and not `has`. All four of these stay
		// their own question, so no shipped label's identity moves and no key is shared.
		const ids = await ask(['has member', 'has as member', 'ha come membro', 'ha membro']);

		expect(new Set(ids).size).toBe(4);
	});

	it('still keys a reuse question on the type plus the label the model proposed', async () => {
		// `relation_type_reuse` deliberately did not change: its label is shown verbatim next to
		// the type it reuses, and case and whitespace is the whole of what makes two spellings of
		// it one question.
		const { universeId, jobId, from, to } = await setup();
		const [shipped] = await db
			.select({ id: relationType.id })
			.from(relationType)
			.where(and(eq(relationType.label, 'member of'), isNull(relationType.universeId)))
			.limit(1);
		if (!shipped) throw new Error('no shipped "member of" relation type');

		const ids: string[] = [];
		for (const proposedLabel of ['  Fa Parte  Di ', 'fa parte di', 'fa parte del']) {
			const result = await proposeRelationTypeVocabulary(db, {
				universeId,
				importJobId: jobId,
				resolution: {
					kind: 'relation_type_reuse',
					existingTypeId: shipped.id,
					proposedLabel,
					why: 'close enough in meaning to reuse'
				},
				relation: waiting(from, to),
				provider: 'import',
				modelId: 'onenote'
			});
			ids.push(result.proposalId);
		}

		// The first two are one question (case and whitespace); the third is its own, because
		// nothing normalises a reuse label beyond that.
		expect(ids[1]).toBe(ids[0]);
		expect(ids[2]).not.toBe(ids[0]);
	});
});
