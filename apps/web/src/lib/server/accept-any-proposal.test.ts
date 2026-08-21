/**
 * Issue #498 (V2 = A): the inbox mixes propagation and import candidates on one page,
 * so its own accept action (`acceptAnyProposalForUniverse`) has to work out which write
 * path a proposal needs before deciding it - the plain `acceptProposal` for a
 * propagation-plan candidate, `acceptAnyImportProposal` (which also writes
 * `entity_source_ref`, SPEC.md Β§6.4) for one that came from an import job. Nothing
 * already tested that dispatch: the plan route and the import review route each only
 * ever call one of the two paths, because each already knows which kind of plan it is
 * scoped to. This is the regression guard on the real dispatcher, against a real
 * Postgres.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import {
	entity,
	entitySourceRef,
	importJob,
	proposal,
	proposalPlan,
	universe,
	universeMember,
	user
} from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptAnyProposalForUniverse, ProposalNotFoundError } from './proposals';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('acceptAnyProposalForUniverse (#498): the inbox accept, dispatched by origin', () => {
	let db: Db;
	let ownerId: string;
	let universeId: string;
	let otherUniverseId: string;
	let saveProposalId: string;
	let importProposalId: string;
	let foreignProposalId: string;
	let savedEntityId: string;
	let importedEntityId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('accept-any-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'Accept Any Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Accept Any Universe',
				slug: unique('accept-any-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id });
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;
		await db.insert(universeMember).values({ universeId, userId: ownerId, role: 'owner' });

		const [otherUni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Accept Any Other Universe',
				slug: unique('accept-any-other-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id });
		if (!otherUni) throw new Error('universe insert did not return a row');
		otherUniverseId = otherUni.id;

		const [savedEntity] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'Wren Talbot',
				slug: unique('wren-talbot'),
				body: 'Keeps the toll ledger at the north bridge.'
			})
			.returning({ id: entity.id });
		if (!savedEntity) throw new Error('entity insert did not return a row');
		savedEntityId = savedEntity.id;

		const [importedEntity] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'place',
				name: 'The Marsh Road',
				slug: unique('the-marsh-road'),
				body: 'A causeway that floods twice a year.'
			})
			.returning({ id: entity.id });
		if (!importedEntity) throw new Error('entity insert did not return a row');
		importedEntityId = importedEntity.id;

		const [savePlan] = await db
			.insert(proposalPlan)
			.values({
				universeId,
				trigger: 'save',
				summary: 'This change touches 1 entry.',
				status: 'spent',
				estimatedCredits: 1
			})
			.returning({ id: proposalPlan.id });
		if (!savePlan) throw new Error('plan insert did not return a row');

		const [saveProposal] = await db
			.insert(proposal)
			.values({
				universeId,
				planId: savePlan.id,
				trigger: 'save',
				kind: 'update',
				targetEntityId: savedEntityId,
				patch: {
					after: 'Keeps the toll ledger at the north bridge, in a hand nobody else can read.'
				},
				rationale: 'A save-triggered candidate, already diffed.',
				evidence: [],
				rank: 0,
				outcome: 'pending'
			})
			.returning({ id: proposal.id });
		if (!saveProposal) throw new Error('proposal insert did not return a row');
		saveProposalId = saveProposal.id;

		const [job] = await db
			.insert(importJob)
			.values({
				universeId,
				sourceType: 'obsidian',
				playbook: 'obsidian',
				playbookVersion: 1,
				artefactPath: '/tmp/accept-any.upload',
				artefactSha256: 'a'.repeat(64),
				documentCount: 1,
				status: 'finished'
			})
			.returning({ id: importJob.id });
		if (!job) throw new Error('import job insert did not return a row');

		const [importPlan] = await db
			.insert(proposalPlan)
			.values({
				universeId,
				trigger: 'import',
				importJobId: job.id,
				summary: 'Import: 1 entity, 0 relation(s) from document "doc-1".',
				status: 'ready',
				estimatedCredits: 0
			})
			.returning({ id: proposalPlan.id });
		if (!importPlan) throw new Error('plan insert did not return a row');

		const [importProposal] = await db
			.insert(proposal)
			.values({
				universeId,
				planId: importPlan.id,
				trigger: 'import',
				kind: 'update',
				targetEntityId: importedEntityId,
				patch: { after: 'A causeway that floods twice a year, rebuilt after the Long Thaw.' },
				rationale: 'An import-sourced candidate.',
				evidence: {
					sourceRef: { path: 'Valdoria Vault/Places/The Marsh Road.md' },
					contentHash: 'b'.repeat(64)
				},
				rank: 0,
				outcome: 'pending'
			})
			.returning({ id: proposal.id });
		if (!importProposal) throw new Error('proposal insert did not return a row');
		importProposalId = importProposal.id;

		const [foreignEntity] = await db
			.insert(entity)
			.values({
				universeId: otherUniverseId,
				type: 'character',
				name: 'A Stranger',
				slug: unique('a-stranger'),
				body: 'Belongs to a different universe entirely.'
			})
			.returning({ id: entity.id });
		if (!foreignEntity) throw new Error('entity insert did not return a row');

		const [foreignPlan] = await db
			.insert(proposalPlan)
			.values({
				universeId: otherUniverseId,
				trigger: 'save',
				summary: 'This change touches 1 entry.',
				status: 'spent',
				estimatedCredits: 1
			})
			.returning({ id: proposalPlan.id });
		if (!foreignPlan) throw new Error('plan insert did not return a row');

		const [foreignProposal] = await db
			.insert(proposal)
			.values({
				universeId: otherUniverseId,
				planId: foreignPlan.id,
				trigger: 'save',
				kind: 'update',
				targetEntityId: foreignEntity.id,
				patch: { after: 'Something else entirely.' },
				rationale: 'Belongs to another universe.',
				evidence: [],
				rank: 0,
				outcome: 'pending'
			})
			.returning({ id: proposal.id });
		if (!foreignProposal) throw new Error('proposal insert did not return a row');
		foreignProposalId = foreignProposal.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(universe).where(eq(universe.id, otherUniverseId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	it('accepts a propagation-plan candidate through the plain write path, writing no entity_source_ref', async () => {
		const accepted = await acceptAnyProposalForUniverse(db, universeId, saveProposalId, ownerId);
		expect(accepted.outcome).toBe('accepted');

		const [row] = await db.select().from(entity).where(eq(entity.id, savedEntityId));
		expect(row?.body).toBe(
			'Keeps the toll ledger at the north bridge, in a hand nobody else can read.'
		);

		const refs = await db
			.select()
			.from(entitySourceRef)
			.where(eq(entitySourceRef.entityId, savedEntityId));
		expect(refs).toHaveLength(0);
	});

	it('accepts an import-plan candidate through the import write path, writing entity_source_ref', async () => {
		const accepted = await acceptAnyProposalForUniverse(db, universeId, importProposalId, ownerId);
		expect(accepted.outcome).toBe('accepted');

		const [row] = await db.select().from(entity).where(eq(entity.id, importedEntityId));
		expect(row?.body).toBe('A causeway that floods twice a year, rebuilt after the Long Thaw.');

		const [ref] = await db
			.select()
			.from(entitySourceRef)
			.where(eq(entitySourceRef.entityId, importedEntityId));
		expect(ref?.sourceSystem).toBe('obsidian');
		expect(ref?.externalId).toBe('Valdoria Vault/Places/The Marsh Road.md');
		expect(ref?.contentHash).toBe('b'.repeat(64));
	});

	it('never decides a proposal from another universe, even with a valid id', async () => {
		await expect(
			acceptAnyProposalForUniverse(db, universeId, foreignProposalId, ownerId)
		).rejects.toBeInstanceOf(ProposalNotFoundError);
	});
});
