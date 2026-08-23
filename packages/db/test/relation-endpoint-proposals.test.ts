/**
 * Issue #613: a `relation` proposal whose endpoint entity does not exist yet, because the
 * same import is proposing it.
 *
 * These are the lifecycle cases, at the layer that owns them. The end-to-end shape (an
 * import producing such a relation at all, and a GM walking the queue) is
 * `packages/import/src/job-runner-relations.test.ts`.
 *
 * Every case here fails on the commit before this issue, and fails in a specific way worth
 * naming: `proposal` had no `target_entity_proposal_id` at all, so a relation with a
 * not-yet-real end could not be written and the merge engine dropped it. What is defended
 * here is not that the column exists but what its four transitions do - resolve on accept,
 * settle on reject, un-resolve on undo, and reconcile for a relation written after its
 * endpoint was already decided, which is the one that is easy to get wrong and was.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	acceptProposal,
	closeDb,
	createProposalPlan,
	getProposal,
	recordProposalDiff,
	rejectProposal,
	undoAcceptedProposal,
	RelationEndpointNotAcceptedError,
	RELATION_ENDPOINT_REJECTED,
	type Db,
	type ProposalRow
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType } from '../src/schema/relation.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('a relation proposal whose endpoint is another proposal (issue #613)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	/** The shipped `part of` type admits place -> place, which is the pair every case here
	 * uses, so nothing in this file is ever testing #191's admission check by accident. */
	async function partOfType(universeId: string): Promise<string> {
		const [row] = await db
			.select({ id: relationType.id })
			.from(relationType)
			.where(and(eq(relationType.label, 'part of')))
			.limit(1);
		if (!row) throw new Error(`no shipped "part of" relation type; universe ${universeId}`);
		return row.id;
	}

	/**
	 * One import's worth of plan: two `create` candidates for pages that do not exist yet,
	 * and the relation between them, whose two ends name those candidates by index. This is
	 * exactly what `materializeDocumentProposals` writes for a page and its subpage on a
	 * first import.
	 */
	async function planWithTwoCreatesAndARelation(): Promise<{
		universeId: string;
		parent: ProposalRow;
		child: ProposalRow;
		link: ProposalRow;
	}> {
		const u = await insertHomebrewUniverse(db);
		const typeId = await partOfType(u.id);
		const { proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'import',
			summary: 'Import: two pages and the link between them.',
			candidateCap: 3,
			estimatedCredits: 0,
			candidates: [
				{
					kind: 'create',
					targetEntityId: null,
					rationale: 'extracted',
					evidence: {},
					rank: 0
				},
				{
					kind: 'create',
					targetEntityId: null,
					rationale: 'extracted',
					evidence: {},
					rank: 1
				},
				{
					kind: 'relation',
					targetEntityId: null,
					relationTypeId: typeId,
					relatedEntityId: null,
					targetEntityProposalIndex: 1,
					relatedEntityProposalIndex: 0,
					rationale: 'the folder tree says so',
					evidence: { documentId: 'doc-2', sourceRef: { path: 'Notebook/Harbour/Docks.htm' } },
					rank: 2
				}
			]
		});
		const [parent, child, link] = proposals;
		if (!parent || !child || !link) throw new Error('plan did not return three proposals');
		// The creates get their patches second, the way an import writes them
		// (`recordProposalDiff` after `createProposalPlan`), so the accept has a name and a
		// slug to build an entity from.
		await createPatch(parent.id, 'Harbour', 'The harbour district.');
		await createPatch(child.id, 'Docks', 'The docks, under the harbour.');
		return { universeId: u.id, parent, child, link };
	}

	async function createPatch(proposalId: string, name: string, body: string): Promise<void> {
		await recordProposalDiff(db, {
			proposalId,
			patch: {
				type: 'place',
				name,
				slug: unique(name.toLowerCase()),
				aliases: [],
				body
			},
			provider: 'import',
			modelId: 'test',
			credits: 0
		});
	}

	it('is written pending, with both ends naming a proposal rather than an entity', async () => {
		const { link, parent, child } = await planWithTwoCreatesAndARelation();
		expect(link.outcome).toBe('pending');
		expect(link.targetEntityId, 'the "from" end has no entity yet').toBeNull();
		expect(link.relatedEntityId, 'the "to" end has no entity yet').toBeNull();
		expect(link.targetEntityProposalId).toBe(child.id);
		expect(link.relatedEntityProposalId).toBe(parent.id);
	});

	it('refuses its own accept by name while an end is still only proposed', async () => {
		const { link, child, parent } = await planWithTwoCreatesAndARelation();
		await expect(acceptProposal(db, { proposalId: link.id })).rejects.toThrow(
			RelationEndpointNotAcceptedError
		);
		// And it names both, so a caller can say what to accept first rather than "something".
		await expect(acceptProposal(db, { proposalId: link.id })).rejects.toThrow(
			new RegExp(`${child.id}.*${parent.id}`)
		);
	});

	it('still refuses after only one end is accepted, and stops refusing after both', async () => {
		const { universeId, link, parent, child } = await planWithTwoCreatesAndARelation();

		await acceptProposal(db, { proposalId: parent.id });
		const halfway = await getProposal(db, link.id);
		expect(halfway?.relatedEntityId, 'the accepted end resolved onto its new entity').toBeTruthy();
		expect(halfway?.targetEntityId, 'the other end has not moved').toBeNull();
		expect(halfway?.outcome, 'and the relation is still a pending decision').toBe('pending');
		await expect(acceptProposal(db, { proposalId: link.id })).rejects.toThrow(
			RelationEndpointNotAcceptedError
		);

		await acceptProposal(db, { proposalId: child.id });
		const accepted = await acceptProposal(db, { proposalId: link.id });
		expect(accepted.outcome).toBe('accepted');

		const rows = await db.select().from(relation).where(eq(relation.universeId, universeId));
		expect(rows, 'exactly one relation reached canon, and only on its own accept').toHaveLength(1);
		expect(rows[0]?.authorKind).toBe('ai_accepted');
	});

	it('accepting the two ends in the other order works the same, since neither is special', async () => {
		const { universeId, link, parent, child } = await planWithTwoCreatesAndARelation();
		await acceptProposal(db, { proposalId: child.id });
		await acceptProposal(db, { proposalId: parent.id });
		await acceptProposal(db, { proposalId: link.id });
		const rows = await db.select().from(relation).where(eq(relation.universeId, universeId));
		expect(rows).toHaveLength(1);
	});

	it('accepting an end writes that end and nothing else, which is the whole guardrail 1 argument', async () => {
		const { universeId, parent, child } = await planWithTwoCreatesAndARelation();
		await acceptProposal(db, { proposalId: parent.id });
		await acceptProposal(db, { proposalId: child.id });
		const rows = await db.select().from(relation).where(eq(relation.universeId, universeId));
		expect(
			rows,
			'both entries accepted and still no relation in canon: only the relation\u2019s own accept writes one'
		).toEqual([]);
	});

	it('rejecting an end settles the relation superseded, with a reason, rather than leaving it pending forever', async () => {
		const { universeId, link, parent } = await planWithTwoCreatesAndARelation();
		await rejectProposal(db, { proposalId: parent.id, reason: null });

		const settled = await getProposal(db, link.id);
		expect(settled?.outcome, 'never left pending against an entry that is not coming').toBe(
			'superseded'
		);
		expect(
			settled?.outcome,
			'and never counted as a rejection: the GM decided the entry, not this'
		).not.toBe('rejected');
		expect(settled?.rejectReason).toBe(RELATION_ENDPOINT_REJECTED);
		expect(settled?.decidedAt).not.toBeNull();

		const rows = await db.select().from(relation).where(eq(relation.universeId, universeId));
		expect(rows, 'and nothing was written to canon on the way out').toEqual([]);
	});

	it('undoing an end\u2019s accept puts the relation back to waiting instead of deleting it', async () => {
		const { link, parent, child } = await planWithTwoCreatesAndARelation();
		await acceptProposal(db, { proposalId: parent.id });
		await acceptProposal(db, { proposalId: child.id });
		expect((await getProposal(db, link.id))?.targetEntityId).toBeTruthy();

		await undoAcceptedProposal(db, { proposalId: child.id });

		const afterUndo = await getProposal(db, link.id);
		expect(afterUndo, 'the FK cascade did not take it away with the entity').not.toBeNull();
		expect(afterUndo?.outcome).toBe('pending');
		expect(afterUndo?.targetEntityId, 'that end is waiting again').toBeNull();
		expect(afterUndo?.targetEntityProposalId, 'on the same proposal as before').toBe(child.id);
		await expect(acceptProposal(db, { proposalId: link.id })).rejects.toThrow(
			RelationEndpointNotAcceptedError
		);
	});

	it('a relation written after its end was already accepted resolves immediately, not never', async () => {
		// The vocabulary case (decision K1) in miniature: the relation row is created later
		// than the accept that would have resolved it. On the notebook this was 164 of 203
		// relations sitting pending against entries that existed.
		const u = await insertHomebrewUniverse(db);
		const typeId = await partOfType(u.id);
		const { proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'import',
			summary: 'one page',
			candidateCap: 1,
			estimatedCredits: 0,
			candidates: [{ kind: 'create', targetEntityId: null, rationale: '', evidence: {}, rank: 0 }]
		});
		const page = proposals[0];
		if (!page) throw new Error('plan did not return a proposal');
		await createPatch(page.id, 'Harbour', 'The harbour district.');
		const accepted = await acceptProposal(db, { proposalId: page.id });
		expect(accepted.outcome).toBe('accepted');

		const [other] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'place',
				name: 'Old Town',
				slug: unique('old-town'),
				body: 'The old town.'
			})
			.returning();
		if (!other) throw new Error('entity insert returned no row');

		const late = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'import',
			summary: 'the link, written after the accept',
			candidateCap: 1,
			estimatedCredits: 0,
			candidates: [
				{
					kind: 'relation',
					targetEntityId: other.id,
					relationTypeId: typeId,
					relatedEntityId: null,
					relatedEntityProposalId: page.id,
					rationale: 'the folder tree says so',
					evidence: {},
					rank: 0
				}
			]
		});
		const link = late.proposals[0];
		if (!link) throw new Error('plan did not return a relation proposal');
		expect(
			link.relatedEntityId,
			'resolved on the way in, against the accept that already ran'
		).toBeTruthy();
		const written = await acceptProposal(db, { proposalId: link.id });
		expect(written.outcome).toBe('accepted');
	});

	it('a relation written after its end was already rejected is settled on the way in, not left pending', async () => {
		const u = await insertHomebrewUniverse(db);
		const typeId = await partOfType(u.id);
		const { proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'import',
			summary: 'one page',
			candidateCap: 1,
			estimatedCredits: 0,
			candidates: [{ kind: 'create', targetEntityId: null, rationale: '', evidence: {}, rank: 0 }]
		});
		const page = proposals[0];
		if (!page) throw new Error('plan did not return a proposal');
		await rejectProposal(db, { proposalId: page.id, reason: null });

		const [other] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'place',
				name: 'Old Town',
				slug: unique('old-town'),
				body: 'The old town.'
			})
			.returning();
		if (!other) throw new Error('entity insert returned no row');

		const late = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'import',
			summary: 'the link, written after the reject',
			candidateCap: 1,
			estimatedCredits: 0,
			candidates: [
				{
					kind: 'relation',
					targetEntityId: other.id,
					relationTypeId: typeId,
					relatedEntityId: null,
					relatedEntityProposalId: page.id,
					rationale: '',
					evidence: {},
					rank: 0
				}
			]
		});
		const link = late.proposals[0];
		if (!link) throw new Error('plan did not return a relation proposal');
		expect(link.outcome).toBe('superseded');
		expect(link.rejectReason).toBe(RELATION_ENDPOINT_REJECTED);
	});
});
