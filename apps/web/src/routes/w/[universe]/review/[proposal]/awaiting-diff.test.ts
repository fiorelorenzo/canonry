/**
 * Issue #468, P0: `patch = {}` - C3's checklist gate, before the GM pays for
 * `propagate.diff` - used to fall straight through `enrichCandidate`'s diff branch as a
 * full-body removal (`before` = the target entity's live body, `after` = ''), which this
 * route then painted as every sentence struck through with no Accept, no Reject and no
 * explanation. This is the regression guard on the real `load`, against a real Postgres:
 * a candidate with no drafted patch comes back `awaitingDiff`, carrying the plan's own
 * per-diff price rather than a struck-through diff, and a candidate that already has one
 * is untouched.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import {
	entity,
	operationPrice,
	proposal,
	proposalPlan,
	universe,
	universeMember,
	user
} from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { load } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reason `cover-gate.test.ts` does this: the route's own `$lib/server/db.ts`
// singleton reads `$env/dynamic/private` with no fallback, and it has to be set before
// the first `load` call rather than inside one.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const ENTRY_BODY = 'She keeps the vigil at the ossuary and speaks for the dead.';

describe('the review page (#468): a candidate awaiting its diff never reads as a deletion', () => {
	let db: Db;
	let ownerId: string;
	let universeSlug: string;
	let universeId: string;
	let planId: string;
	let awaitingProposalId: string;
	let draftedProposalId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		// A fresh test database has no seeded catalogue - `priceOf` throws rather than
		// silently charging zero (SPEC.md §15), so the row has to exist for the loader's
		// own `priceOf(conn, 'propagate.diff')` call to resolve.
		await db
			.insert(operationPrice)
			.values({
				operation: 'propagate.diff',
				label: 'Propagation diff, per entry',
				credits: 1,
				kind: 'generation'
			})
			.onConflictDoNothing({ target: operationPrice.operation });

		const ownerKey = unique('review-awaiting-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'Review Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Review Awaiting Universe',
				slug: unique('review-awaiting-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;
		universeSlug = uni.slug;

		await db.insert(universeMember).values({ universeId: uni.id, userId: ownerId, role: 'owner' });

		const [target] = await db
			.insert(entity)
			.values({
				universeId: uni.id,
				type: 'character',
				name: 'Mother Sennah',
				slug: unique('mother-sennah'),
				body: ENTRY_BODY
			})
			.returning({ id: entity.id });
		if (!target) throw new Error('entity insert did not return a row');

		const [plan] = await db
			.insert(proposalPlan)
			.values({
				universeId: uni.id,
				trigger: 'save',
				summary: 'This change touches 1 entry.',
				status: 'ready',
				estimatedCredits: 2,
				candidateCap: 25
			})
			.returning({ id: proposalPlan.id });
		if (!plan) throw new Error('plan insert did not return a row');
		planId = plan.id;

		// `createProposalPlan` (`@canonry/db`) writes every candidate this way: `patch: {}`
		// until the GM pays for `propagate.diff`. This row is the repro straight off the
		// issue - a real proposal in the seeded world resolves the same `patch = {}` case.
		const [awaiting] = await db
			.insert(proposal)
			.values({
				universeId: uni.id,
				planId,
				trigger: 'save',
				kind: 'update',
				targetEntityId: target.id,
				patch: {},
				rationale: "Mother Sennah's vigil needs to be documented as a new lore point.",
				evidence: [],
				rank: 0,
				outcome: 'pending'
			})
			.returning({ id: proposal.id });
		if (!awaiting) throw new Error('proposal insert did not return a row');
		awaitingProposalId = awaiting.id;

		const [drafted] = await db
			.insert(proposal)
			.values({
				universeId: uni.id,
				planId,
				trigger: 'save',
				kind: 'update',
				targetEntityId: target.id,
				patch: {
					summary: 'Notes a second vigil.',
					before: ENTRY_BODY,
					after: `${ENTRY_BODY} She now keeps a second vigil at dusk.`
				},
				rationale: 'A second candidate in the same plan, already diffed.',
				evidence: [],
				rank: 1,
				outcome: 'pending',
				credits: 1
			})
			.returning({ id: proposal.id });
		if (!drafted) throw new Error('proposal insert did not return a row');
		draftedProposalId = drafted.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	async function loadReview(proposalId: string) {
		return load({
			params: { universe: universeSlug, proposal: proposalId },
			locals: { user: { id: ownerId }, locale: 'en' }
		} as Parameters<typeof load>[0]);
	}

	it('flags patch = {} as awaitingDiff, carrying the plan link and the real per-diff price', async () => {
		const data = await loadReview(awaitingProposalId);
		expect(data.candidate.awaitingDiff).toBe(true);
		expect(data.candidate.outcome).toBe('pending');
		expect(data.candidate.planId).toBe(planId);
		expect(data.diffPriceCredits).toBe(1);
	});

	it('never marks a candidate awaitingDiff once its diff has been written', async () => {
		const data = await loadReview(draftedProposalId);
		expect(data.candidate.awaitingDiff).toBe(false);
		expect(data.candidate.diff.rows.length).toBeGreaterThan(0);
		expect(data.diffPriceCredits).toBeNull();
	});
});
