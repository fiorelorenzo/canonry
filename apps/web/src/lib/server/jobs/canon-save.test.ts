/**
 * Integration tests for `createCanonSaveJobQueue` (the wiring `scheduleCanonSaveJob` uses)
 * against the real database, with a `MockLanguageModelV4` standing in for the AI Gateway -
 * this box has no `AI_GATEWAY_*` credentials, so this is the same seam
 * `packages/copilot/src/propagate.test.ts` and `audit.test.ts` already use for a live
 * model call, injected through the same `ModelFactory`/`GatewayWrapper` shape
 * `$lib/server/copilot.ts` wires to the real gateway in production.
 *
 * Fixture mirrors `packages/copilot/src/audit.test.ts`'s own contradiction case (Aldric
 * Vane vs Cairnmouth, "who led the watch through the second freeze") on purpose: the same
 * edit has to produce both a propagation candidate (Aldric is named by mention) and an
 * audit pair, which is exactly what "both engines" needs to demonstrate in one save.
 *
 * Runs against `TEST_DATABASE_URL` (never the shared dev database - see this repo's own
 * `TEST_DB_SUFFIX` convention), each test its own uniquely-slugged universe.
 */
import { randomUUID } from 'node:crypto';
import {
	acceptProposal,
	closeDb,
	createDb,
	createProposalPlan,
	desc,
	eq,
	recordProposalDiff,
	type Db
} from '@canonry/db';
import type { GatewayWrapper, ModelFactory } from '@canonry/copilot';
import {
	entity,
	modelCall,
	modelConfig,
	proposal,
	proposalPlan,
	revision,
	universe,
	user
} from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanonSaveJobQueue, type CanonSaveJobQueue } from './canon-save.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function usage(inputTotal: number, outputTotal: number) {
	return {
		inputTokens: {
			total: inputTotal,
			noCache: inputTotal,
			cacheRead: undefined,
			cacheWrite: undefined
		},
		outputTokens: { total: outputTotal, text: outputTotal, reasoning: undefined }
	};
}

/** One cheap-purpose mock that answers both calls `planPropagation` and `runAudit` make
 * (both resolve `purpose: 'cheap'` - see `propagate.ts`/`audit.ts`): the ranking prompt
 * asks "Entry edited: ..." for a summary and per-candidate rationale, the audit prompt
 * asks "Do these two statements disagree?" for a verdict. Distinguishing on prompt text
 * mirrors `propagate.test.ts`'s own `dynamicRankingModel`, which reads real candidate ids
 * back out of the prompt rather than hand-picking an answer. */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function combinedCheapModel(): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: async (options) => {
			const promptText = JSON.stringify(options.prompt);
			if (promptText.includes('disagree')) {
				const object = { disagree: true, topic: 'who led the watch through the second freeze' };
				return {
					content: [{ type: 'text', text: JSON.stringify(object) }],
					finishReason: { unified: 'stop', raw: undefined },
					usage: usage(60, 20),
					warnings: []
				};
			}
			const ids = Array.from(new Set(Array.from(promptText.matchAll(UUID_RE)).map((m) => m[0])));
			const object = {
				summary: `This change touches ${ids.length} entries.`,
				candidates: ids.map((id) => ({ entityId: id, rationale: 'Because it is affected.' }))
			};
			return {
				content: [{ type: 'text', text: JSON.stringify(object) }],
				finishReason: { unified: 'stop', raw: undefined },
				usage: usage(80, 40),
				warnings: []
			};
		}
	}) as unknown as LanguageModel;
}

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

function modelFactoryFor(cheap: LanguageModel): ModelFactory {
	return () => cheap;
}

describe('createCanonSaveJobQueue (SPEC.md §5.1/§5.2: propagation and audit on save)', () => {
	let db: Db;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 1 });
		// One active model_config row for 'cheap', shared with whichever other suite in this
		// same test run claims it first - see packages/copilot/src/audit.test.ts's own
		// comment: the unique index is on (purpose) where active, and racing to create it is
		// expected, not a bug, since only *some* active row needs to exist.
		try {
			await db.insert(modelConfig).values({
				purpose: 'cheap',
				provider: 'test-provider',
				modelId: unique('test-cheap'),
				active: true,
				params: {}
			});
		} catch {
			// Another suite already provided one.
		}
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture(overrides: Partial<typeof universe.$inferInsert> = {}) {
		const [owner] = await db
			.insert(user)
			.values({
				id: unique('user'),
				name: 'Test GM',
				email: `${unique('user')}@canonry.invalid`,
				emailVerified: true
			})
			.returning();
		if (!owner) throw new Error('user insert returned no row');
		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Test Universe',
				slug: unique('universe'),
				kind: 'homebrew',
				...overrides
			})
			.returning();
		if (!world) throw new Error('universe insert returned no row');
		return { owner, world };
	}

	// A queue instance per test, isolated from the production singleton and from each
	// other, with a short debounce - real timers, on purpose: this exercises the real
	// database and a real (mocked) model call, genuine I/O whose duration deterministic
	// fake-timer control cannot stand in for.
	function testQueue(): CanonSaveJobQueue {
		return createCanonSaveJobQueue({ debounceMs: 20, maxConcurrent: 2 });
	}

	it('runs both engines on a human save, writes only pending proposals, and never touches canon (guardrail 1)', async () => {
		const { owner, world } = await fixture();

		const aldricBody =
			'Dismissed from the watch in the thaw after the Sable Winter, he now answers to ' +
			'the Ashen Ledger.';
		const [aldric] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Aldric Vane',
				slug: unique('aldric'),
				aliases: ['Captain Vane', 'the broken captain'],
				body: aldricBody
			})
			.returning();
		if (!aldric) throw new Error('entity insert returned no row');

		const cairnmouthOldBody =
			'A fishing town two days up the coast. A third of it starved in the Sable Winter ' +
			'when the Sable Reach froze, and the rest remember exactly who did not come.';
		const [cairnmouth] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'place',
				name: 'Cairnmouth',
				slug: unique('cairnmouth'),
				aliases: [],
				body: cairnmouthOldBody
			})
			.returning();
		if (!cairnmouth) throw new Error('entity insert returned no row');

		const newBody =
			`${cairnmouthOldBody} Captain Vane led the watch through the second freeze, ` +
			'the winter after the thaw.';

		// What the real edit route does before it ever calls `scheduleCanonSaveJob`: one
		// human revision, committed together with the entity's own body.
		await db.transaction(async (tx) => {
			await tx.insert(revision).values({
				universeId: world.id,
				entityId: cairnmouth.id,
				authorKind: 'human',
				authorUserId: owner.id,
				name: cairnmouth.name,
				aliases: cairnmouth.aliases,
				body: newBody
			});
			await tx.update(entity).set({ body: newBody }).where(eq(entity.id, cairnmouth.id));
		});

		const queue = testQueue();
		queue.schedule({
			db,
			universeId: world.id,
			entityId: cairnmouth.id,
			entityName: cairnmouth.name,
			userId: owner.id,
			oldBody: cairnmouthOldBody,
			newBody,
			triggerRevisionId: null,
			modelFactory: modelFactoryFor(combinedCheapModel()),
			gateway: IDENTITY_GATEWAY
		});
		await queue.waitForIdle();

		const plans = await db.select().from(proposalPlan).where(eq(proposalPlan.universeId, world.id));
		const savePlan = plans.find((p) => p.trigger === 'save');
		const auditPlan = plans.find((p) => p.trigger === 'audit');
		expect(savePlan, 'propagation should have produced a plan').toBeDefined();
		expect(auditPlan, 'audit should have produced a plan').toBeDefined();

		const saveProposals = await db.select().from(proposal).where(eq(proposal.planId, savePlan!.id));
		expect(saveProposals.length).toBeGreaterThanOrEqual(1);
		for (const p of saveProposals) {
			expect(p.outcome).toBe('pending');
			expect(p.kind).toBe('update');
		}

		const auditProposals = await db
			.select()
			.from(proposal)
			.where(eq(proposal.planId, auditPlan!.id));
		expect(auditProposals).toHaveLength(1);
		expect(auditProposals[0]?.outcome).toBe('pending');
		expect(auditProposals[0]?.kind).toBe('flag');

		// Guardrail 1: propose, never apply. The edited entity's own body is exactly what
		// the human wrote (not further mutated by either engine), the candidate's body is
		// untouched, and the only revision on the edited entity is the human one.
		const [freshCairnmouth] = await db.select().from(entity).where(eq(entity.id, cairnmouth.id));
		expect(freshCairnmouth?.body).toBe(newBody);
		const [freshAldric] = await db.select().from(entity).where(eq(entity.id, aldric.id));
		expect(freshAldric?.body).toBe(aldricBody);

		const revisions = await db.select().from(revision).where(eq(revision.entityId, cairnmouth.id));
		expect(revisions).toHaveLength(1);
		expect(revisions[0]?.authorKind).toBe('human');
	});

	it('does not run either engine, and spends nothing, when a universe has generation switched off (guardrail 4)', async () => {
		const { owner, world } = await fixture({ aiEnabled: false });
		const [edited] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Off Switch Test',
				slug: unique('off-switch'),
				aliases: [],
				body: 'Old body.'
			})
			.returning();
		if (!edited) throw new Error('entity insert returned no row');

		const queue = testQueue();
		queue.schedule({
			db,
			universeId: world.id,
			entityId: edited.id,
			entityName: edited.name,
			userId: owner.id,
			oldBody: edited.body,
			newBody: 'New body that would otherwise touch other entries.',
			triggerRevisionId: null,
			modelFactory: modelFactoryFor(combinedCheapModel()),
			gateway: IDENTITY_GATEWAY
		});
		await queue.waitForIdle();

		const plans = await db.select().from(proposalPlan).where(eq(proposalPlan.universeId, world.id));
		expect(plans).toHaveLength(0);

		const calls = await db.select().from(modelCall).where(eq(modelCall.universeId, world.id));
		expect(calls, 'no model call means no spend, checked before either engine runs').toHaveLength(
			0
		);

		const [job] = queue.recentJobs();
		expect(job?.propagation.status).toBe('ai-disabled');
		expect(job?.audit.status).toBe('ai-disabled');
	});

	it('an accepted AI proposal never schedules a new canon-save job (recursion guard)', async () => {
		const { owner, world } = await fixture();
		const [target] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Recursion Target',
				slug: unique('recursion-target'),
				aliases: [],
				body: 'Original body.'
			})
			.returning();
		if (!target) throw new Error('entity insert returned no row');

		const { proposals } = await createProposalPlan(db, {
			universeId: world.id,
			trigger: 'save',
			summary: 'test plan',
			candidateCap: 10,
			estimatedCredits: 1,
			candidates: [
				{ kind: 'update', targetEntityId: target.id, rationale: 'because', evidence: [], rank: 0 }
			]
		});
		const undiffed = proposals[0];
		if (!undiffed) throw new Error('createProposalPlan wrote no candidate');
		const withDiff = await recordProposalDiff(db, {
			proposalId: undiffed.id,
			patch: { summary: 'AI drafted this.', before: target.body, after: 'AI-drafted body.' },
			provider: 'test',
			modelId: 'test-premium',
			credits: 1
		});

		const queue = testQueue();
		queue.schedule({
			db,
			universeId: world.id,
			entityId: target.id,
			entityName: target.name,
			userId: owner.id,
			oldBody: 'irrelevant before',
			newBody: 'irrelevant after, just to trigger a run',
			triggerRevisionId: null,
			modelFactory: modelFactoryFor(combinedCheapModel()),
			gateway: IDENTITY_GATEWAY
		});
		await queue.waitForIdle();
		expect(queue.recentJobs()).toHaveLength(1);

		await acceptProposal(db, { proposalId: withDiff.id, decidedBy: owner.id });
		await queue.waitForIdle();

		// The accept wrote a revision through `acceptProposal` (`@canonry/db`), a function
		// this queue never calls and no route wires to it - so it never schedules a second
		// job on this queue.
		expect(queue.recentJobs()).toHaveLength(1);

		const revisions = await db
			.select()
			.from(revision)
			.where(eq(revision.entityId, target.id))
			.orderBy(desc(revision.createdAt));
		expect(revisions[0]?.authorKind).toBe('ai_accepted');
	});
});
