import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	acceptProposal,
	closeDb,
	createProposalPlan,
	dropCandidateFromPlan,
	getProposalPlan,
	entityDeletedByUndo,
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
	RelationTypeNotAdmittedError,
	setRejectReason,
	undoAcceptedProposal,
	UndoNotPossibleError,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType } from '../src/schema/relation.js';
import { operationPrice } from '../src/schema/prices.js';
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

		it('a create-kind accept that loses the entity_universe_slug_key race folds onto the winner instead of raising a raw query error (issue #160)', async () => {
			const { u } = await fixture();
			const sharedSlug = unique('aldric-vane');

			async function createCandidate(name: string, body: string) {
				const { proposals } = await createProposalPlan(db, {
					universeId: u.id,
					trigger: 'import',
					summary: 'x',
					candidateCap: 10,
					estimatedCredits: 0,
					candidates: [
						{ kind: 'create', targetEntityId: null, rationale: 'r', evidence: [], rank: 0 }
					]
				});
				const created = proposals[0]!;
				await recordProposalDiff(db, {
					proposalId: created.id,
					patch: { type: 'character', name, slug: sharedSlug, aliases: [], body },
					provider: 'test',
					modelId: 'test',
					credits: 0
				});
				return created;
			}

			// Two independent proposals - as if two different documents, or two different
			// import jobs, both slugified to the same name. materializeDocumentProposals's
			// own fix (issue #160) only sees one job's own pending output, so this race is
			// still real between two jobs, or between an import and a manually authored
			// "new entity", even after that fix.
			const first = await createCandidate('Aldric Vane', 'Commands the harbour watch.');
			const second = await createCandidate('Aldric Vane', 'Also patrols the docks at night.');

			const firstAccepted = await acceptProposal(db, { proposalId: first.id });
			expect(firstAccepted.outcome).toBe('accepted');

			// Without the fix, this throws a raw DrizzleQueryError wrapping the Postgres
			// unique violation - a GM's second accept of the same-named entity turning into
			// a 500 instead of a change.
			const secondAccepted = await acceptProposal(db, { proposalId: second.id });
			expect(secondAccepted.outcome).toBe('accepted');
			expect(secondAccepted.kind).toBe('create');

			const entityRows = await db.select().from(entity).where(eq(entity.slug, sharedSlug));
			expect(entityRows).toHaveLength(1);
			const target = entityRows[0]!;
			// The losing accept's target is now recorded on the proposal - honest history
			// that it landed as an update onto the entity the winner created.
			expect(secondAccepted.targetEntityId).toBe(target.id);
			// The losing proposal's own patch is what the entity now holds.
			expect(target.body).toBe('Also patrols the docks at night.');

			const revisions = await db
				.select()
				.from(revision)
				.where(eq(revision.entityId, target.id))
				.orderBy(revision.createdAt);
			expect(revisions).toHaveLength(2);
			expect(revisions[1]?.id).toBe(secondAccepted.appliedRevisionId);
		});

		it('a create-kind accept prefers patch.language over detecting the (often thin) body (issue #122/#125)', async () => {
			const { u } = await fixture();
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{ kind: 'create', targetEntityId: null, rationale: 'r', evidence: [], rank: 0 }
				]
			});
			const proposal = proposals[0]!;
			const newSlug = unique('dono-vasari');
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: {
					type: 'character',
					name: 'Dono Vasari',
					slug: newSlug,
					aliases: [],
					// Too short for the body-only heuristic to decide on its own - the point of
					// this test is that `patch.language` is what settles it, not the body.
					body: 'A merchant.',
					language: 'it'
				},
				provider: 'test',
				modelId: 'test',
				credits: 1
			});

			await acceptProposal(db, { proposalId: proposal.id });

			const [createdEntity] = await db.select().from(entity).where(eq(entity.slug, newSlug));
			expect(createdEntity?.language).toBe('it');
			expect(createdEntity?.languageSource).toBe('detected');
		});

		it('a create-kind accept falls back to detecting the body when the patch carries no language', async () => {
			const { u } = await fixture();
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{ kind: 'create', targetEntityId: null, rationale: 'r', evidence: [], rank: 0 }
				]
			});
			const proposal = proposals[0]!;
			const newSlug = unique('mira-solenne');
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: {
					type: 'character',
					name: 'Mira Solenne',
					slug: newSlug,
					aliases: [],
					body: 'A harbour clerk who keeps every ledger in the Lantern Quarter honest, and none of the friends that would come with it.'
				},
				provider: 'test',
				modelId: 'test',
				credits: 1
			});

			await acceptProposal(db, { proposalId: proposal.id });

			const [createdEntity] = await db.select().from(entity).where(eq(entity.slug, newSlug));
			expect(createdEntity?.language).toBe('en');
			expect(createdEntity?.languageSource).toBe('detected');
		});

		it("an update-kind accept never overwrites a target entity's hand-set language, whatever the patch says (issue #122)", async () => {
			const { u } = await fixture();
			const [target] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: unique('ashen-ledger-human'),
					body: 'A merchant bank.',
					language: 'en',
					languageSource: 'human'
				})
				.returning();
			if (!target) throw new Error('fixture setup failed');

			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'save',
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 1,
				candidates: [
					{ kind: 'update', targetEntityId: target.id, rationale: 'r', evidence: [], rank: 0 }
				]
			});
			const proposal = proposals[0]!;
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				// An import re-run claiming Italian, and a body that would detect as Italian too
				// if this were a fresh entity - neither is allowed to move a human's choice.
				patch: {
					summary: 's',
					before: target.body,
					after:
						'Una banca mercantile che presta denaro con la forza e tiene registri migliori del magistrato.',
					language: 'it'
				},
				provider: 'test',
				modelId: 'test',
				credits: 1
			});

			await acceptProposal(db, { proposalId: proposal.id });

			const [updatedEntity] = await db.select().from(entity).where(eq(entity.id, target.id));
			expect(updatedEntity?.language).toBe('en');
			expect(updatedEntity?.languageSource).toBe('human');
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

		it('#191: refuses to accept a relation-kind proposal whose ends the type does not admit, and writes nothing', async () => {
			const { u, target } = await fixture(); // target.type === 'faction'
			const [other] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'place',
					name: 'Cairnmouth',
					slug: unique('cairnmouth')
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
					allowedTo: ['character'] // "place" is not admitted on this side
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
						rationale: 'They now employ it, apparently.',
						evidence: [],
						rank: 0
					}
				]
			});
			const proposal = proposals[0]!;

			await expect(acceptProposal(db, { proposalId: proposal.id })).rejects.toBeInstanceOf(
				RelationTypeNotAdmittedError
			);

			const rows = await db
				.select()
				.from(relation)
				.where(and(eq(relation.fromEntityId, target.id), eq(relation.toEntityId, other.id)));
			expect(rows).toHaveLength(0);

			// A real error, not a silent drop - the proposal is untouched, still decidable.
			const stillPending = await getProposal(db, proposal.id);
			expect(stillPending?.outcome).toBe('pending');
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

		it('entityDeletedByUndo names the entity undo is about to delete, and nothing once it is gone (issue #164)', async () => {
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
			const newSlug = unique('lira-onyx');
			await recordProposalDiff(db, {
				proposalId: proposal.id,
				patch: { type: 'character', name: 'Lira Onyx', slug: newSlug, aliases: [], body: 'x' },
				provider: 'test',
				modelId: 'test',
				credits: 1
			});
			await acceptProposal(db, { proposalId: proposal.id });
			const [created] = await db.select().from(entity).where(eq(entity.slug, newSlug));
			if (!created) throw new Error('fixture setup failed');

			expect(await entityDeletedByUndo(db, proposal.id)).toBe(created.id);

			await undoAcceptedProposal(db, { proposalId: proposal.id });

			// The entity is gone and the proposal is back to pending - nothing left to name.
			expect(await entityDeletedByUndo(db, proposal.id)).toBeNull();
		});

		it('entityDeletedByUndo is null for an accepted update - there is no entity to delete', async () => {
			const { u, target } = await fixture();
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
			await acceptProposal(db, { proposalId: proposal.id });
			expect(await entityDeletedByUndo(db, proposal.id)).toBeNull();
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

/**
 * Issue #508. `proposal_plan.estimated_credits` means one thing: what the candidates still
 * open in this plan are worth at today's prices, one per-candidate charge each (the column's
 * own comment in schema/proposal.ts carries the definition). Before this, only
 * `dropCandidateFromPlan` moved it, so a plan whose candidates were accepted or rejected
 * kept advertising them as still open - which is what the seeded demo plan showed, an
 * estimate of 4 against one remaining candidate.
 *
 * The two prices are deliberately moved apart for this suite's own run. In the seeded
 * catalogue `propagate.diff` and `audit.flag` are both 1.0000, and that coincidence is
 * exactly what hid the second bug here: a drop on an audit plan subtracted `propagate.diff`
 * whatever the trigger was, and every assertion about "the price its trigger implies" passes
 * by accident while the two agree. With 3 and 7 it cannot. No other test file in this
 * package asserts a credits value for either row (prices.test.ts only checks that both
 * exist and are priced as 'generation'), so repricing them here races nothing, and `afterAll`
 * puts the seeded values back.
 */
describe('issue #508: estimated_credits follows a plan through accept, reject and drop', () => {
	const DIFF_CREDITS = 3;
	const FLAG_CREDITS = 7;
	let db: Db;
	let seededPrices: Array<{ operation: string; credits: number }> = [];

	beforeAll(async () => {
		db = testDb();
		seededPrices = await db
			.select({ operation: operationPrice.operation, credits: operationPrice.credits })
			.from(operationPrice)
			.where(inArray(operationPrice.operation, ['propagate.diff', 'audit.flag']));
		await db
			.update(operationPrice)
			.set({ credits: DIFF_CREDITS })
			.where(eq(operationPrice.operation, 'propagate.diff'));
		await db
			.update(operationPrice)
			.set({ credits: FLAG_CREDITS })
			.where(eq(operationPrice.operation, 'audit.flag'));
	});

	afterAll(async () => {
		for (const row of seededPrices) {
			await db
				.update(operationPrice)
				.set({ credits: row.credits })
				.where(eq(operationPrice.operation, row.operation));
		}
		await closeDb(db);
	});

	async function savePlanWith(candidates: number, estimatedCredits = candidates * DIFF_CREDITS) {
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
		const created = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'save',
			summary: `This change touches ${candidates} entries.`,
			candidateCap: 10,
			estimatedCredits,
			candidates: Array.from({ length: candidates }, (_, rank) => ({
				kind: 'update' as const,
				targetEntityId: target.id,
				rationale: 'They bank with them.',
				evidence: [],
				rank
			}))
		});
		return { u, target, ...created };
	}

	async function draftDiffFor(proposalId: string, target: { body: string }) {
		await recordProposalDiff(db, {
			proposalId,
			patch: { summary: 's', before: target.body, after: `${target.body} And a new line.` },
			provider: 'test',
			modelId: 'test-premium',
			credits: DIFF_CREDITS
		});
	}

	/** An audit plan the way `runAudit` writes one: every flag fully drafted and charged at
	 * `audit.flag` by the time the plan row exists, so the plan's figure is the flags it
	 * carries and each row carries its own real credits. */
	async function auditPlanWith(flags: number) {
		const u = await insertHomebrewUniverse(db);
		const rows = await db
			.insert(entity)
			.values(
				Array.from({ length: 2 }, (_, i) => ({
					universeId: u.id,
					type: 'character' as const,
					name: `Statement holder ${i}`,
					slug: unique('statement-holder'),
					body: 'Says one thing.'
				}))
			)
			.returning();
		const [a, b] = rows;
		if (!a || !b) throw new Error('fixture setup failed');
		const created = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'audit',
			summary: 'Two entries disagree.',
			candidateCap: 12,
			estimatedCredits: flags * FLAG_CREDITS,
			candidates: Array.from({ length: flags }, (_, rank) => ({
				kind: 'flag' as const,
				targetEntityId: a.id,
				relatedEntityId: b.id,
				rationale: 'These two disagree about the toll.',
				evidence: [],
				rank,
				credits: FLAG_CREDITS
			}))
		});
		return created;
	}

	it('accept: the accepted candidate stops being counted as open', async () => {
		const { plan, proposals, target } = await savePlanWith(2);
		expect(plan.estimatedCredits).toBe(2 * DIFF_CREDITS);

		await draftDiffFor(proposals[0]!.id, target);
		await acceptProposal(db, { proposalId: proposals[0]!.id });

		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(DIFF_CREDITS);
	});

	it('reject: the rejected candidate stops being counted, and a second reject does not count twice', async () => {
		const { plan, proposals } = await savePlanWith(2);

		await rejectProposal(db, { proposalId: proposals[0]!.id, reason: 'unrelated' });
		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(DIFF_CREDITS);

		// `rejectProposal` is idempotent by decision C7 ("never re-ask"), and that early
		// return is what keeps the price from coming off twice.
		await rejectProposal(db, { proposalId: proposals[0]!.id, reason: 'unrelated' });
		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(DIFF_CREDITS);
	});

	it('drop: the dropped candidate comes off at its own price', async () => {
		const { plan, proposals } = await savePlanWith(2);

		const result = await dropCandidateFromPlan(db, proposals[0]!.id);

		expect(result.plan.estimatedCredits).toBe(DIFF_CREDITS);
		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(DIFF_CREDITS);
	});

	it('undo: an undone accept puts the candidate, and its price, back', async () => {
		const { u } = await savePlanWith(0, 0);
		const slug = unique('corvin-ashe');
		const { plan, proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'save',
			summary: 'One new entry.',
			candidateCap: 10,
			estimatedCredits: DIFF_CREDITS,
			candidates: [{ kind: 'create', targetEntityId: null, rationale: 'x', evidence: [], rank: 0 }]
		});
		const candidate = proposals[0]!;
		await recordProposalDiff(db, {
			proposalId: candidate.id,
			patch: { type: 'character', name: 'Corvin Ashe', slug, aliases: [], body: 'x' },
			provider: 'test',
			modelId: 'test-premium',
			credits: DIFF_CREDITS
		});

		await acceptProposal(db, { proposalId: candidate.id });
		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(0);

		await undoAcceptedProposal(db, { proposalId: candidate.id });
		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(DIFF_CREDITS);
	});

	it('an audit plan moves by audit.flag price, never by propagate.diff (the coincidence that hid this)', async () => {
		const { plan, proposals } = await auditPlanWith(2);
		expect(plan.estimatedCredits).toBe(2 * FLAG_CREDITS);

		const dropped = await dropCandidateFromPlan(db, proposals[0]!.id);

		expect(dropped.plan.estimatedCredits).toBe(FLAG_CREDITS);
		// What the hardcoded `propagate.diff` lookup produced: 14 - 3. Asserted explicitly
		// because with the seeded catalogue's two equal prices the correct and the wrong
		// answer are the same number.
		expect(dropped.plan.estimatedCredits).not.toBe(2 * FLAG_CREDITS - DIFF_CREDITS);

		// Dismissing a flag (guardrail 7: the only decision a flag can register) counts the
		// same way a drop does.
		await rejectProposal(db, { proposalId: proposals[1]!.id });
		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(0);
	});

	it('an audit flag carries its own real credits, not zero', async () => {
		const { proposals } = await auditPlanWith(1);
		expect(proposals[0]?.credits).toBe(FLAG_CREDITS);
	});

	it('a trigger with no per-candidate price leaves the estimate where it is', async () => {
		const u = await insertHomebrewUniverse(db);
		// An import is priced per document (`import.document`, charged by the job runner),
		// never per proposal, so no decision on one of its proposals may move this column.
		const { plan, proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'import',
			summary: 'A new relation type from the export.',
			candidateCap: 1,
			estimatedCredits: 5,
			candidates: [{ kind: 'create', targetEntityId: null, rationale: 'x', evidence: {}, rank: 0 }]
		});

		await rejectProposal(db, { proposalId: proposals[0]!.id });

		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(5);
	});

	it('stops at zero rather than going negative on a plan that was already understated', async () => {
		const { plan, proposals } = await savePlanWith(2, 0);

		await rejectProposal(db, { proposalId: proposals[0]!.id });
		await rejectProposal(db, { proposalId: proposals[1]!.id });

		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(0);
	});

	it('the shape issue #489 screenshotted: three survivors, two decided, one open', async () => {
		const { plan, proposals, target } = await savePlanWith(3);
		expect(plan.estimatedCredits).toBe(3 * DIFF_CREDITS);

		await draftDiffFor(proposals[0]!.id, target);
		await acceptProposal(db, { proposalId: proposals[0]!.id });
		await rejectProposal(db, { proposalId: proposals[1]!.id, reason: 'wrong' });

		// One candidate left open, so one candidate's worth left on the plan - never the
		// three-candidate total the column used to keep.
		expect((await getProposalPlan(db, plan.id))?.estimatedCredits).toBe(DIFF_CREDITS);
		const open = await listProposalsForPlan(db, plan.id);
		expect(open.filter((p) => p.outcome === 'pending')).toHaveLength(1);
	});
});
