/**
 * Round eighteen: the invariant the proposal inbox has to keep, and did not.
 *
 * `pendingProposalCount` is what the sidebar's Proposals badge reads, and it counts every
 * pending row in a universe. The inbox reads `propagationGroupsForInbox` and
 * `importGroupsForInbox`, and both of those start from a plan (or from an import job) and
 * join down to its proposals - so a pending proposal belonging to no plan was counted by
 * one and structurally invisible to the other. The product then told the GM one proposal
 * was waiting and offered nowhere to see it, which is the worst shape a copilot's inbox
 * can take: a claim it cannot back up.
 *
 * One path writes those rows today. `packages/warm/src/store.ts` inserts a `draft_entity`
 * straight into `proposal` with no `plan_id` when the warm cache drafts an NPC while a
 * table is being prepared, which is why this showed up on the deployed preview only after
 * table-prep credits had been spent.
 *
 * So this file does not test the fix, it tests the invariant: **everything the inbox
 * renders, summed, equals what the sidebar counts.** Written that way on purpose, because
 * the next path that writes a proposal by a route nobody thought of fails this test rather
 * than shipping the same silent divergence again.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, proposal, proposalPlan, universe, universeMember, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	importGroupsForInbox,
	pendingProposalCount,
	planlessCandidatesForInbox,
	propagationGroupsForInbox,
	type ProposalCandidate
} from './proposals';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * What the page actually puts on screen: every pending candidate of every group it
 * renders, from the same three queries `proposals/+page.server.ts` calls. The pending
 * filter matters because a settled candidate still comes back inside its group (the queue
 * collapses it to a line with its outcome), while the sidebar's count is pending only.
 */
async function inboxPendingCount(db: Db, universeId: string): Promise<number> {
	const [plans, imports, planless] = await Promise.all([
		propagationGroupsForInbox(db, universeId),
		importGroupsForInbox(db, universeId),
		planlessCandidatesForInbox(db, universeId)
	]);
	const pending = (candidates: ProposalCandidate[]) =>
		candidates.filter((c) => c.proposal.outcome === 'pending').length;
	return (
		plans.reduce((n, g) => n + pending(g.candidates), 0) +
		imports.reduce((n, g) => n + pending(g.candidates), 0) +
		pending(planless)
	);
}

describe('the inbox reconciles with the sidebar count', () => {
	let db: Db;
	let ownerId: string;
	let universeId: string;
	let entityId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('inbox-reconcile-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'Inbox Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Inbox Reconcile Universe',
				slug: unique('inbox-reconcile'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id });
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;
		await db.insert(universeMember).values({ universeId, userId: ownerId, role: 'owner' });

		const [ent] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'Harrow the Tollman',
				slug: unique('harrow-the-tollman'),
				body: 'A warden of the marsh road.'
			})
			.returning({ id: entity.id });
		if (!ent) throw new Error('entity insert did not return a row');
		entityId = ent.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	it('an empty universe reconciles at zero', async () => {
		expect(await pendingProposalCount(db, universeId)).toBe(0);
		expect(await inboxPendingCount(db, universeId)).toBe(0);
	});

	it('a plan-less pending proposal is rendered, not counted and hidden', async () => {
		// Exactly the row `packages/warm/src/store.ts` writes: no `planId` at all.
		await db.insert(proposal).values({
			universeId,
			trigger: 'table',
			kind: 'draft_entity',
			patch: { name: 'Harrow the Tollman', type: 'character', body: 'A warden.', aliases: [] },
			rationale: 'Drafted from the warm cache while preparing the table.',
			evidence: {}
		});

		expect(await pendingProposalCount(db, universeId)).toBe(1);
		// Before the fix this was 0 while the sidebar said 1.
		expect(await inboxPendingCount(db, universeId)).toBe(1);
	});

	it('stays reconciled with a plan in the mix, diffed candidate and awaiting one alike', async () => {
		const [plan] = await db
			.insert(proposalPlan)
			.values({ universeId, trigger: 'save', triggerEntityId: entityId, summary: 'A save' })
			.returning({ id: proposalPlan.id });
		if (!plan) throw new Error('plan insert did not return a row');

		await db.insert(proposal).values([
			{
				universeId,
				planId: plan.id,
				trigger: 'save',
				kind: 'update',
				targetEntityId: entityId,
				patch: { summary: 'the toll doubled', before: 'a', after: 'b' },
				rationale: 'the road changed hands',
				evidence: {}
			},
			{
				universeId,
				planId: plan.id,
				trigger: 'save',
				kind: 'update',
				targetEntityId: entityId,
				// `patch: {}` is #468's awaiting-diff state, which the queue frames differently
				// and still has to count: it is pending, and the badge counts it.
				patch: {},
				rationale: 'no diff written yet',
				evidence: {}
			}
		]);

		const counted = await pendingProposalCount(db, universeId);
		expect(counted).toBe(3);
		expect(await inboxPendingCount(db, universeId)).toBe(counted);
	});
});
