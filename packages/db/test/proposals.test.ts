import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	acceptProposal,
	closeDb,
	createProposalPlan,
	dropCandidateFromPlan,
	getProposal,
	listProposalsForPlan,
	ProposalAlreadyDecidedError,
	ProposalCannotBeAcceptedError,
	ProposalHasDiffError,
	ProposalNotAcceptedError,
	ProposalNotFoundError,
	recordProposalDiff,
	rejectedProposalsFor,
	rejectProposal,
	setRejectReason,
	undoAcceptedProposal,
	UndoNotPossibleError,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType } from '../src/schema/relation.js';
import { revision } from '../src/schema/revision.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('proposals', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture() {
		const u = await insertHomebrewUniverse(db);
		const [target] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'faction',
				name: 'The Ashen Ledger',
				slug: unique('ashen-ledger'),
				body: 'A merchant bank that lends at knife point.'
			})
			.returning();
		if (!target) throw new Error('fixture setup failed');
		return { u, target };
	}

	async function planWithOneUpdateCandidate() {
		const { u, target } = await fixture();
		const { plan, proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'save',
			summary: 'This change touches 1 entry.',
			candidateCap: 10,
			estimatedCredits: 2,
			candidates: [
				{
					kind: 'update',
					targetEntityId: target.id,
					rationale: 'They employ him.',
					evidence: [{ kind: 'relation', hops: 1, path: ['employs'] }],
					rank: 0
				}
			]
		});
		const proposal = proposals[0];
		if (!proposal) throw new Error('fixture setup failed');
		return { u, target, plan, proposal };
	}

	describe('createProposalPlan', () => {
		it('writes the plan and one proposal row per candidate, each with an empty patch and pending outcome', async () => {
			const { plan, proposal } = await planWithOneUpdateCandidate();

			expect(plan.status).toBe('ready');
			expect(plan.candidateCap).toBe(10);
			expect(plan.estimatedCredits).toBe(2);
			expect(proposal.outcome).toBe('pending');
			expect(proposal.patch).toEqual({});
			expect(proposal.planId).toBe(plan.id);
			expect(proposal.rank).toBe(0);
		});

		it('writes a plan with zero candidates when the shortlist is empty', async () => {
			const { u } = await fixture();
			const { plan, proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'Nothing else looks affected.',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: []
			});
			expect(proposals).toEqual([]);
			expect(plan.status).toBe('ready');
		});
	});

	describe('dropCandidateFromPlan', () => {
		it('deletes the candidate and reduces the plan estimate by the propagate.diff price', async () => {
			const { plan, proposal } = await planWithOneUpdateCandidate();
			const before = plan.estimatedCredits;

			const result = await dropCandidateFromPlan(db, proposal.id);

			expect(result.plan.estimatedCredits).toBeLessThan(before);
			expect(result.dropped.id).toBe(proposal.id);
			expect(await getProposal(db, proposal.id)).toBeNull();
		});

		it('never drops the estimate below zero', async () => {
			const { u, target } = await fixture();
			const { plan, proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 0,
				candidates: [
					{ kind: 'update', targetEntityId: target.id, rationale: 'x', evidence: [], rank: 0 }
				]
			});
			const proposal = proposals[0]!;
			const result = await dropCandidateFromPlan(db, proposal.id);
			expect(result.plan.estimatedCredits).toBe(0);
			void plan;
		});

		it('refuses to drop a candidate that already has a diff', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { summary: 's', before: 'a', after: 'b' },
				provider: 'test',
				modelId: 'test-premium',
				credits: 1
			});
			await expect(dropCandidateFromPlan(db, proposal.id)).rejects.toBeInstanceOf(
				ProposalHasDiffError
			);
		});

		it('throws for an unknown proposal id', async () => {
			await expect(dropCandidateFromPlan(db, randomUUID())).rejects.toBeInstanceOf(
				ProposalNotFoundError
			);
		});
	});

	describe('recordProposalDiff', () => {
		it('writes the patch, provider, model id and credits', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			const updated = await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { summary: 'Notes the new employer.', before: 'old body', after: 'new body' },
				provider: 'test-provider',
				modelId: 'test-premium',
				credits: 1.5
			});
			expect(updated.patch).toEqual({
				summary: 'Notes the new employer.',
				before: 'old body',
				after: 'new body'
			});
			expect(updated.provider).toBe('test-provider');
			expect(updated.modelId).toBe('test-premium');
			expect(updated.credits).toBe(1.5);
		});

		it('refuses to overwrite the diff of an already-decided proposal', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			await rejectProposal(db, { proposalId: proposal.id, reason: 'wrong' });
			await expect(
				recordProposalDiff(db, {
					proposalId: proposal.id,
					patch: { summary: 's', before: 'a', after: 'b' },
					provider: 'test',
					modelId: 'test',
					credits: 1
				})
			).rejects.toBeInstanceOf(ProposalAlreadyDecidedError);
		});
	});

	describe('acceptProposal', () => {
		it('flips outcome, writes exactly one ai_accepted revision, updates the entity and sets applied_revision_id - all in one transaction', async () => {
			const { target, proposal } = await planWithOneUpdateCandidate();
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: {
					summary: 'Notes the new employer.',
					before: target.body,
					after: `${target.body} It now employs Aldric Vane.`
				},
				provider: 'test-provider',
				modelId: 'test-premium',
				credits: 1
			});

			const accepted = await acceptProposal(db, { proposalId: proposal.id, decidedBy: null });

			expect(accepted.outcome).toBe('accepted');
			expect(accepted.decidedAt).not.toBeNull();
			expect(accepted.appliedRevisionId).not.toBeNull();

			const revisions = await db.select().from(revision).where(eq(revision.entityId, target.id));
			expect(revisions).toHaveLength(1);
			expect(revisions[0]?.authorKind).toBe('ai_accepted');
			expect(revisions[0]?.proposalId).toBe(proposal.id);
			expect(revisions[0]?.body).toBe(`${target.body} It now employs Aldric Vane.`);
			expect(revisions[0]?.id).toBe(accepted.appliedRevisionId);

			const [updatedEntity] = await db.select().from(entity).where(eq(entity.id, target.id));
			expect(updatedEntity?.body).toBe(`${target.body} It now employs Aldric Vane.`);
		});

		it('accepting twice is idempotent: exactly one revision, one outcome flip, no error', async () => {
			const { target, proposal } = await planWithOneUpdateCandidate();
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { summary: 's', before: target.body, after: `${target.body} changed.` },
				provider: 'test',
				modelId: 'test',
				credits: 1
			});

			const first = await acceptProposal(db, { proposalId: proposal.id });
			const second = await acceptProposal(db, { proposalId: proposal.id });

			expect(second.outcome).toBe('accepted');
			expect(second.appliedRevisionId).toBe(first.appliedRevisionId);
			expect(second.decidedAt?.getTime()).toBe(first.decidedAt?.getTime());

			const revisions = await db.select().from(revision).where(eq(revision.entityId, target.id));
			expect(revisions).toHaveLength(1);
		});

		it('refuses to accept an already-rejected proposal', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			await rejectProposal(db, { proposalId: proposal.id, reason: 'wrong' });
			await expect(acceptProposal(db, { proposalId: proposal.id })).rejects.toBeInstanceOf(
				ProposalAlreadyDecidedError
			);
		});

		it('accepts a create-kind proposal by inserting a new entity and its first revision', async () => {
			const { u } = await fixture();
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{
						kind: 'create',
						targetEntityId: null,
						rationale: 'A new NPC the scene needs.',
						evidence: [],
						rank: 0
					}
				]
			});
			const proposal = proposals[0]!;
			const newSlug = unique('corvin-ashe');
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: {
					type: 'character',
					name: 'Corvin Ashe',
					slug: newSlug,
					aliases: [],
					body: 'A factor.'
				},
				provider: 'test',
				modelId: 'test',
				credits: 1
			});

			const accepted = await acceptProposal(db, { proposalId: proposal.id });
			expect(accepted.appliedRevisionId).not.toBeNull();

			const [createdRevision] = await db
				.select()
				.from(revision)
				.where(eq(revision.id, accepted.appliedRevisionId!));
			expect(createdRevision?.name).toBe('Corvin Ashe');
			expect(createdRevision?.authorKind).toBe('ai_accepted');

			const [createdEntity] = await db.select().from(entity).where(eq(entity.slug, newSlug));
			expect(createdEntity?.name).toBe('Corvin Ashe');
			expect(createdEntity?.type).toBe('character');
		});

		it('accepts a relation-kind proposal by inserting the relation row', async () => {
			const { u, target } = await fixture();
			const [other] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'character',
					name: 'Corvin Ashe',
					slug: unique('corvin')
				})
				.returning();
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
			if (!other || !rt) throw new Error('fixture setup failed');

			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{
						kind: 'relation',
						targetEntityId: target.id,
						relationTypeId: rt.id,
						relatedEntityId: other.id,
						rationale: 'They now employ him.',
						evidence: [],
						rank: 0
					}
				]
			});
			const proposal = proposals[0]!;

			const accepted = await acceptProposal(db, { proposalId: proposal.id });
			expect(accepted.outcome).toBe('accepted');

			const rows = await db
				.select()
				.from(relation)
				.where(and(eq(relation.fromEntityId, target.id), eq(relation.toEntityId, other.id)));
			expect(rows).toHaveLength(1);
			expect(rows[0]?.authorKind).toBe('ai_accepted');
		});

		it('refuses to accept a flag-kind proposal: an audit flag is a question, not a change (guardrail 7)', async () => {
			const { u, target } = await fixture();
			const [other] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'place',
					name: 'Cairnmouth',
					slug: unique('cairnmouth')
				})
				.returning();
			if (!other) throw new Error('fixture setup failed');

			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'audit',
				summary:
					'The Ashen Ledger and Cairnmouth do not agree on who led the watch through the second freeze.',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{
						kind: 'flag',
						targetEntityId: target.id,
						relatedEntityId: other.id,
						rationale: 'Worth checking, not necessarily wrong.',
						evidence: [],
						rank: 0
					}
				]
			});
			const proposal = proposals[0]!;
			expect(proposal.kind).toBe('flag');

			await expect(acceptProposal(db, { proposalId: proposal.id })).rejects.toBeInstanceOf(
				ProposalCannotBeAcceptedError
			);

			// Dismiss is the only decision a flag can register, and it needs no revision.
			const rejected = await rejectProposal(db, {
				proposalId: proposal.id,
				reason: 'not-a-contradiction'
			});
			expect(rejected.outcome).toBe('rejected');
			expect(rejected.rejectReason).toBe('not-a-contradiction');

			const revisionsForTarget = await db
				.select()
				.from(revision)
				.where(eq(revision.entityId, target.id));
			expect(revisionsForTarget).toHaveLength(0);
		});
	});

	describe('undoAcceptedProposal', () => {
		it('restores the entity to its prior revision and deletes the ai_accepted one', async () => {
			const { u, target } = await fixture();
			// A real production entity always has at least the revision its own creation
			// wrote - this fixture's raw entity insert skips that, so give it one by hand.
			const [priorRevision] = await db
				.insert(revision)
				.values({
					universeId: u.id,
					entityId: target.id,
					authorKind: 'human',
					name: target.name,
					aliases: target.aliases,
					body: target.body
				})
				.returning();
			if (!priorRevision) throw new Error('fixture setup failed');

			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{ kind: 'update', targetEntityId: target.id, rationale: 'x', evidence: [], rank: 0 }
				]
			});
			const proposal = proposals[0]!;
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { summary: 's', before: target.body, after: `${target.body} changed.` },
				provider: 'test',
				modelId: 'test',
				credits: 1
			});
			const accepted = await acceptProposal(db, { proposalId: proposal.id });
			expect(accepted.appliedRevisionId).not.toBeNull();

			const undone = await undoAcceptedProposal(db, { proposalId: proposal.id });

			expect(undone.outcome).toBe('pending');
			expect(undone.decidedAt).toBeNull();
			expect(undone.appliedRevisionId).toBeNull();

			const [restoredEntity] = await db.select().from(entity).where(eq(entity.id, target.id));
			expect(restoredEntity?.body).toBe(target.body);

			const revisions = await db.select().from(revision).where(eq(revision.entityId, target.id));
			expect(revisions).toHaveLength(1);
			expect(revisions[0]?.id).toBe(priorRevision.id);
		});

		it('undoing a create-kind accept deletes the entity it created, cascading its revision', async () => {
			const { u } = await fixture();
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{ kind: 'create', targetEntityId: null, rationale: 'x', evidence: [], rank: 0 }
				]
			});
			const proposal = proposals[0]!;
			const newSlug = unique('corvin-ashe');
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { type: 'character', name: 'Corvin Ashe', slug: newSlug, aliases: [], body: 'x' },
				provider: 'test',
				modelId: 'test',
				credits: 1
			});
			await acceptProposal(db, { proposalId: proposal.id });
			expect((await db.select().from(entity).where(eq(entity.slug, newSlug))).length).toBe(1);

			const undone = await undoAcceptedProposal(db, { proposalId: proposal.id });
			expect(undone.outcome).toBe('pending');
			expect(await db.select().from(entity).where(eq(entity.slug, newSlug))).toEqual([]);
		});

		it('undoing a relation-kind accept deletes the relation row', async () => {
			const { u, target } = await fixture();
			const [other] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'character',
					name: 'Corvin Ashe',
					slug: unique('corvin')
				})
				.returning();
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
			if (!other || !rt) throw new Error('fixture setup failed');

			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{
						kind: 'relation',
						targetEntityId: target.id,
						relationTypeId: rt.id,
						relatedEntityId: other.id,
						rationale: 'x',
						evidence: [],
						rank: 0
					}
				]
			});
			const proposal = proposals[0]!;
			await acceptProposal(db, { proposalId: proposal.id });

			await undoAcceptedProposal(db, { proposalId: proposal.id });

			const rows = await db
				.select()
				.from(relation)
				.where(and(eq(relation.fromEntityId, target.id), eq(relation.toEntityId, other.id)));
			expect(rows).toHaveLength(0);
		});

		it('refuses to undo a proposal that is not accepted', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			await expect(undoAcceptedProposal(db, { proposalId: proposal.id })).rejects.toBeInstanceOf(
				ProposalNotAcceptedError
			);
			await rejectProposal(db, { proposalId: proposal.id, reason: 'wrong' });
			await expect(undoAcceptedProposal(db, { proposalId: proposal.id })).rejects.toBeInstanceOf(
				ProposalNotAcceptedError
			);
		});

		it('refuses to undo when the accepted entity has no prior revision to restore', async () => {
			// The fixture entity's raw insert (no founding revision) is exactly this case.
			const { target, proposal } = await planWithOneUpdateCandidate();
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { summary: 's', before: target.body, after: `${target.body} changed.` },
				provider: 'test',
				modelId: 'test',
				credits: 1
			});
			await acceptProposal(db, { proposalId: proposal.id });
			await expect(undoAcceptedProposal(db, { proposalId: proposal.id })).rejects.toBeInstanceOf(
				UndoNotPossibleError
			);
		});
	});

	describe('rejectProposal', () => {
		it('stores the reason and flips the outcome', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			const rejected = await rejectProposal(db, { proposalId: proposal.id, reason: 'wrong' });
			expect(rejected.outcome).toBe('rejected');
			expect(rejected.rejectReason).toBe('wrong');
			expect(rejected.decidedAt).not.toBeNull();
		});

		it('accepts no reason at all - skipping is a valid outcome', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			const rejected = await rejectProposal(db, { proposalId: proposal.id });
			expect(rejected.outcome).toBe('rejected');
			expect(rejected.rejectReason).toBeNull();
		});

		it('rejecting twice is idempotent and never re-asks for a reason', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			const first = await rejectProposal(db, { proposalId: proposal.id, reason: 'wrong' });
			const second = await rejectProposal(db, { proposalId: proposal.id, reason: 'too much' });
			expect(second.rejectReason).toBe(first.rejectReason);
		});

		it('refuses to reject an already-accepted proposal', async () => {
			const { target, proposal } = await planWithOneUpdateCandidate();
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { summary: 's', before: target.body, after: 'new' },
				provider: 'test',
				modelId: 'test',
				credits: 1
			});
			await acceptProposal(db, { proposalId: proposal.id });
			await expect(
				rejectProposal(db, { proposalId: proposal.id, reason: 'wrong' })
			).rejects.toBeInstanceOf(ProposalAlreadyDecidedError);
		});
	});

	describe('setRejectReason', () => {
		it('attaches a reason chosen after the reject already happened', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			await rejectProposal(db, { proposalId: proposal.id });
			const updated = await setRejectReason(db, proposal.id, 'already true');
			expect(updated?.rejectReason).toBe('already true');
			expect(updated?.outcome).toBe('rejected');
		});

		it('is a no-op for a proposal that was never rejected', async () => {
			const { proposal } = await planWithOneUpdateCandidate();
			const updated = await setRejectReason(db, proposal.id, 'wrong');
			expect(updated).toBeNull();
			expect((await getProposal(db, proposal.id))?.rejectReason).toBeNull();
		});
	});

	describe('rejectedProposalsFor', () => {
		it('returns only rejected proposals for the universe, newest first', async () => {
			const { u, target } = await fixture();
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 2,
				candidates: [
					{ kind: 'update', targetEntityId: target.id, rationale: 'a', evidence: [], rank: 0 },
					{ kind: 'update', targetEntityId: target.id, rationale: 'b', evidence: [], rank: 1 }
				]
			});
			await rejectProposal(db, { proposalId: proposals[0]!.id, reason: 'wrong' });
			// The second stays pending.
			void proposals[1];

			const rejected = await rejectedProposalsFor(db, u.id);
			expect(rejected).toHaveLength(1);
			expect(rejected[0]?.reason).toBe('wrong');
			expect(rejected[0]?.targetEntityId).toBe(target.id);
		});
	});

	it('listProposalsForPlan orders by rank', async () => {
		const { u, target } = await fixture();
		const { plan, proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'save',
			summary: 'x',
			candidateCap: 10,
			estimatedCredits: 2,
			candidates: [
				{ kind: 'update', targetEntityId: target.id, rationale: 'a', evidence: [], rank: 1 },
				{ kind: 'update', targetEntityId: target.id, rationale: 'b', evidence: [], rank: 0 }
			]
		});
		void proposals;
		const listed = await listProposalsForPlan(db, plan.id);
		expect(listed.map((p) => p.rank)).toEqual([0, 1]);
	});
});
