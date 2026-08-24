/**
 * Issue #489: the plan page showed three credit figures nobody could reconcile - a plan
 * with one surviving candidate read "Est. 4.00 credits to generate diffs" at the top and
 * "0.00 cr" on the candidate's own row. `propagate.diff` prices per candidate
 * (docs/design/DECISIONS.md G11), so the arithmetic `planPropagation` writes at creation time
 * (`planRationale.credits + survivors.length * diffPrice.credits`, see
 * `packages/copilot/src/propagate.ts`) is correct for what it is - the stored total is only
 * wrong to READ as "credits to generate diffs", because it also carries the plan-level
 * ranking charge, and it goes stale the moment a candidate leaves 'pending' any way other
 * than `dropCandidateFromPlan` (accept and reject never touch `estimated_credits`, unlike
 * drop, and the route places no guard on either action requiring `status = 'spent'`). This
 * is the regression guard on the real `load`, against a real Postgres, for a plan seeded
 * into exactly that stale shape: one candidate still pending, two already decided outside
 * `dropCandidateFromPlan`, `estimated_credits` left at the three-candidate total. The fixed
 * loader derives every figure live (`priceOf('propagate.diff')`,
 * `priceOf('propagate.plan')`) rather than trusting that stale column, so the four figures
 * it returns reconcile regardless.
 *
 * A second case covers the other trigger that can still reach this page before 'spent': an
 * audit plan, whose flags are already fully priced when written (packages/copilot/src/
 * audit.ts) and have no real "generate diffs" step ahead of them - `pricing.kind` is
 * `'spent'` for that trigger (issue #572, which is also what decides the sentence around
 * the figure), and each row keeps its own stored `credits` rather than being overwritten
 * with propagation's per-diff price.
 *
 * Issue #508 has since fixed the column itself: `estimated_credits` now means what a plan's
 * still-open candidates are worth, every accept, reject and drop moves it, and propagation's
 * plan-level ranking charge is no longer folded into it. The hand-seeded plan below keeps the
 * old stale shape on purpose, because a plan written before that fix still carries it and
 * this screen has to stay honest over such a row rather than assume the column is now right.
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
// Same reason `awaiting-diff.test.ts` does this: the route's own `$lib/server/db.ts`
// singleton reads `$env/dynamic/private` with no fallback, and it has to be set before the
// first `load` call rather than inside one.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('the plan page (#489): the credit figures reconcile even from a stale stored estimate', () => {
	let db: Db;
	let ownerId: string;
	let universeSlug: string;
	let universeId: string;
	let stalePlanId: string;
	let pendingProposalId: string;
	let auditPlanId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		// A fresh test database has no seeded catalogue - `priceOf` throws rather than
		// silently charging zero (SPEC.md §15), so both rows the loader's own `priceOf`
		// calls resolve have to exist.
		await db
			.insert(operationPrice)
			.values([
				{
					operation: 'propagate.diff',
					label: 'Propagation diff, per entry',
					credits: 1,
					kind: 'generation'
				},
				{
					operation: 'propagate.plan',
					label: 'Propagation plan',
					credits: 1,
					kind: 'generation'
				}
			])
			.onConflictDoNothing({ target: operationPrice.operation });

		const ownerKey = unique('reconcile-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'Reconcile Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Reconcile Universe',
				slug: unique('reconcile-universe'),
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
				body: 'She keeps the vigil at the ossuary.'
			})
			.returning({ id: entity.id });
		if (!target) throw new Error('entity insert did not return a row');

		// The exact shape issue #489 reported: `planPropagation` charged for 3 survivors
		// (`estimated_credits = 1 rationale + 3 x 1 diff = 4`), then two left 'pending' by
		// something other than `dropCandidateFromPlan` (which is the only path that keeps
		// `estimated_credits` in step) - so only 1 candidate is left on screen, but the
		// stored total still says 4.
		const [stalePlan] = await db
			.insert(proposalPlan)
			.values({
				universeId: uni.id,
				trigger: 'save',
				summary: 'This change touches 3 entries.',
				status: 'ready',
				estimatedCredits: 4,
				candidateCap: 25
			})
			.returning({ id: proposalPlan.id });
		if (!stalePlan) throw new Error('plan insert did not return a row');
		stalePlanId = stalePlan.id;

		const [pending] = await db
			.insert(proposal)
			.values({
				universeId: uni.id,
				planId: stalePlanId,
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
		if (!pending) throw new Error('proposal insert did not return a row');
		pendingProposalId = pending.id;

		// Decided outside `dropCandidateFromPlan` - the estimate above was never adjusted
		// down for either of these two, which is exactly how it stays stuck at 4.
		await db.insert(proposal).values([
			{
				universeId: uni.id,
				planId: stalePlanId,
				trigger: 'save',
				kind: 'update',
				targetEntityId: target.id,
				patch: {},
				rationale: 'Already decided candidate one.',
				evidence: [],
				rank: 1,
				outcome: 'accepted'
			},
			{
				universeId: uni.id,
				planId: stalePlanId,
				trigger: 'save',
				kind: 'update',
				targetEntityId: target.id,
				patch: {},
				rationale: 'Already decided candidate two.',
				evidence: [],
				rank: 2,
				outcome: 'rejected'
			}
		]);

		// The other trigger that can still reach this page before 'spent': an audit plan,
		// whose flags are already fully priced when written and have their own real
		// (non-zero, non-uniform) `credits` - never `propagate.diff`'s price.
		const [audit] = await db
			.insert(proposalPlan)
			.values({
				universeId: uni.id,
				trigger: 'audit',
				summary: 'Two entries disagree.',
				status: 'ready',
				estimatedCredits: 5,
				candidateCap: 5
			})
			.returning({ id: proposalPlan.id });
		if (!audit) throw new Error('plan insert did not return a row');
		auditPlanId = audit.id;

		await db.insert(proposal).values({
			universeId: uni.id,
			planId: auditPlanId,
			trigger: 'audit',
			kind: 'flag',
			targetEntityId: target.id,
			patch: {},
			rationale: 'These two entries disagree.',
			evidence: [],
			rank: 0,
			outcome: 'pending',
			credits: 2.5
		});
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	/** `load`'s declared return is `void | PageData` (SvelteKit lets a load redirect or
	 * throw instead of returning), so the awaited value needs narrowing before any property
	 * read - asserted here once, same as `awaiting-diff.test.ts`'s own `loadReview`. */
	async function loadPlan(planId: string) {
		const data = await load({
			params: { universe: universeSlug, plan: planId },
			locals: { user: { id: ownerId }, locale: 'en' }
		} as Parameters<typeof load>[0]);
		if (!data) throw new Error('the plan load returned nothing');
		return data;
	}

	it('derives the reconciling figures live rather than trusting the stale stored estimate', async () => {
		const data = await loadPlan(stalePlanId);

		// Only the still-pending candidate reaches the checklist.
		expect(data.checklistRows).toHaveLength(1);
		expect(data.checklistRows[0]?.id).toBe(pendingProposalId);

		// The row's own price is the live per-diff price, not the always-0 `proposal.credits`
		// a pre-diff candidate actually has in Postgres.
		expect(data.checklistRows[0]?.credits).toBe(1);

		if (data.pricing.kind !== 'perDiff') throw new Error('expected perDiff pricing');
		expect(data.pricing.diffPriceCredits).toBe(1);
		// The plan-level ranking charge, looked up live - not `4` (the stored total) and not
		// `4 - 1 * 1 = 3` (what subtracting the live per-diff total back out of the stale
		// stored estimate would wrongly produce).
		expect(data.pricing.alreadySpentCredits).toBe(1);

		// 1 pending candidate x the live per-diff price - the three numbers a GM reads on
		// screen (count, price each, total) reconcile by construction.
		const toGenerate = data.checklistRows.length * data.pricing.diffPriceCredits;
		expect(toGenerate).toBe(1);
	});

	it('keeps the figure, and each row its own real credits, for a trigger with no diff-generation step', async () => {
		const data = await loadPlan(auditPlanId);

		// Issue #572: an audit plan's figure is a charge already made, so it travels under its
		// own discriminant rather than sharing propagation's forward-looking one.
		if (data.pricing.kind !== 'spent') throw new Error('expected spent pricing');
		expect(data.pricing.trigger).toBe('audit');
		expect(data.pricing.estimatedCredits).toBe(5);

		expect(data.checklistRows).toHaveLength(1);
		// Not overwritten with `propagate.diff`'s price (1) - this trigger never has a real
		// "generate diffs" step ahead of it, so its own row credits pass through untouched.
		expect(data.checklistRows[0]?.credits).toBe(2.5);
	});
});
