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
 * Issue #115: the queue's state now lives in Postgres (`canon_save_job`,
 * `packages/db/src/schema/queue.ts`), not one process's memory, so the tests below that
 * exercise coalescing, the lease and the attempt cap talk to that table directly - either
 * by reading it after `waitForIdle()`, or by inserting a row that simulates a worker that
 * already claimed a job and then crashed, which is not otherwise reachable through the
 * public `schedule()`/`waitForIdle()` surface.
 *
 * Runs against `TEST_DATABASE_URL` (never the shared dev database - see this repo's own
 * `TEST_DB_SUFFIX` convention), each test its own uniquely-slugged universe.
 */
import { randomUUID } from 'node:crypto';
import {
	acceptProposal,
	and,
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
	canonSaveJob,
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
import {
	createCanonSaveJobQueue,
	type CanonSaveJobQueue,
	type CanonSaveJobQueueOptions
} from './canon-save.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** `Promise.withResolvers` instead of `new Promise((resolve) => setTimeout(...))`
 * throughout this file - every wait below is either injected model latency
 * (`combinedCheapModel`'s `delayMs`) or a poll against real claim/lease/dead-letter
 * timing in Postgres, genuine async behaviour fake timers cannot stand in for (this
 * file's own long-standing "real timers, on purpose" convention). */
function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
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
 * back out of the prompt rather than hand-picking an answer. `delayMs` (default 0) is what
 * lets the "follow-up during a run" test observe a job sitting in `claimed` before it
 * finishes - genuine async latency, not a fake timer, matching this file's own "real
 * timers, on purpose" convention. */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function combinedCheapModel(delayMs = 0): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: async (options) => {
			if (delayMs > 0) await delay(delayMs);
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

type CanonSaveJobRow = typeof canonSaveJob.$inferSelect;

/** Polls a known row id until `predicate` matches - what every test below uses instead of
 * a fixed sleep, since claim/reclaim/dead-letter timing is genuine async latency (a real
 * poll interval against a real database), not something fake timers can stand in for. */
async function waitForRow(
	conn: Db,
	id: string,
	predicate: (row: CanonSaveJobRow) => boolean,
	timeoutMs = 3000
): Promise<CanonSaveJobRow> {
	const start = Date.now();
	for (;;) {
		const [row] = await conn.select().from(canonSaveJob).where(eq(canonSaveJob.id, id));
		if (row && predicate(row)) return row;
		if (Date.now() - start > timeoutMs) {
			throw new Error(
				`waitForRow: canon_save_job ${id} never matched within ${timeoutMs}ms (last status: ${row?.status ?? 'missing'})`
			);
		}
		await delay(15);
	}
}

/** Same, scoped to (universe, entity) instead of a known id - for the coalescing tests,
 * where the row's id is only known after the burst has already merged into it. */
async function waitForEntityRow(
	conn: Db,
	universeId: string,
	entityId: string,
	predicate: (row: CanonSaveJobRow) => boolean,
	timeoutMs = 3000
): Promise<CanonSaveJobRow> {
	const start = Date.now();
	for (;;) {
		const rows = await conn
			.select()
			.from(canonSaveJob)
			.where(and(eq(canonSaveJob.universeId, universeId), eq(canonSaveJob.entityId, entityId)))
			.orderBy(desc(canonSaveJob.updatedAt));
		const match = rows.find(predicate);
		if (match) return match;
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitForEntityRow: no matching canon_save_job row within ${timeoutMs}ms`);
		}
		await delay(15);
	}
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
	// other, with a short debounce and a fast poll interval - real timers, on purpose:
	// this exercises the real database and a real (mocked) model call, genuine I/O whose
	// duration deterministic fake-timer control cannot stand in for.
	function testQueue(
		overrides: Partial<CanonSaveJobQueueOptions> = {},
		cheap: LanguageModel = combinedCheapModel()
	): CanonSaveJobQueue {
		return createCanonSaveJobQueue({
			debounceMs: 80,
			maxConcurrent: 2,
			pollIntervalMs: 10,
			leaseMs: 5000,
			maxAttempts: 5,
			db,
			modelFactory: modelFactoryFor(cheap),
			gateway: IDENTITY_GATEWAY,
			...overrides
		});
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
			universeId: world.id,
			entityId: cairnmouth.id,
			entityName: cairnmouth.name,
			userId: owner.id,
			oldBody: cairnmouthOldBody,
			newBody,
			triggerRevisionId: null
		});
		await queue.waitForIdle();
		await queue.stop();

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
			universeId: world.id,
			entityId: edited.id,
			entityName: edited.name,
			userId: owner.id,
			oldBody: edited.body,
			newBody: 'New body that would otherwise touch other entries.',
			triggerRevisionId: null
		});
		await queue.waitForIdle();
		await queue.stop();

		const plans = await db.select().from(proposalPlan).where(eq(proposalPlan.universeId, world.id));
		expect(plans).toHaveLength(0);

		const calls = await db.select().from(modelCall).where(eq(modelCall.universeId, world.id));
		expect(calls, 'no model call means no spend, checked before either engine runs').toHaveLength(
			0
		);

		// `recentJobs()` reads the same shared `canon_save_job` table every instance and
		// every other test in this file writes to (that sharing is the point of issue #115:
		// durable history is visible fleet-wide, not private to whichever instance happened
		// to schedule it) - filtered to this test's own entity rather than asserting on the
		// whole table's length.
		const jobs = await queue.recentJobs();
		const job = jobs.find((j) => j.entityId === edited.id);
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
			universeId: world.id,
			entityId: target.id,
			entityName: target.name,
			userId: owner.id,
			oldBody: 'irrelevant before',
			newBody: 'irrelevant after, just to trigger a run',
			triggerRevisionId: null
		});
		await queue.waitForIdle();
		expect((await queue.recentJobs()).filter((j) => j.entityId === target.id)).toHaveLength(1);

		await acceptProposal(db, { proposalId: withDiff.id, decidedBy: owner.id });
		// Nothing schedules from an accept, so there is nothing new to wait for - a short,
		// fixed pause is what proves the absence instead (waitForIdle would trivially
		// return immediately with an empty tracked set either way).
		await delay(100);
		await queue.stop();

		// The accept wrote a revision through `acceptProposal` (`@canonry/db`), a function
		// this queue never calls and no route wires to it - so it never schedules a second
		// job on this queue.
		expect((await queue.recentJobs()).filter((j) => j.entityId === target.id)).toHaveLength(1);

		const revisions = await db
			.select()
			.from(revision)
			.where(eq(revision.entityId, target.id))
			.orderBy(desc(revision.createdAt));
		expect(revisions[0]?.authorKind).toBe('ai_accepted');
	});

	it('coalesces five schedule() calls inside the debounce window into one run spanning the whole burst', async () => {
		const { owner, world } = await fixture();
		const [edited] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Burst Target',
				slug: unique('burst'),
				aliases: [],
				body: 'body 0'
			})
			.returning();
		if (!edited) throw new Error('entity insert returned no row');

		const queue = testQueue();
		for (let i = 1; i <= 5; i++) {
			queue.schedule({
				universeId: world.id,
				entityId: edited.id,
				entityName: edited.name,
				userId: owner.id,
				oldBody: `body ${i - 1}`,
				newBody: `body ${i}`,
				triggerRevisionId: null
			});
			await delay(15);
		}
		await queue.waitForIdle();
		await queue.stop();

		// One row for the whole burst - issue #115's "five saves, one run", now enforced by
		// the partial unique index rather than a JS Map, spanning "before the first" to
		// "after the last" rather than each intermediate save.
		const rows = await db
			.select()
			.from(canonSaveJob)
			.where(and(eq(canonSaveJob.universeId, world.id), eq(canonSaveJob.entityId, edited.id)));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe('done');
		expect(rows[0]?.oldBody).toBe('body 0');
		expect(rows[0]?.newBody).toBe('body 5');
	});

	it('never starts a second run for a key while one is in flight - saves during a run collapse into exactly one follow-up', async () => {
		const { owner, world } = await fixture();
		// A companion entity mentioned by alias in the edit, mirroring the guardrail-1
		// fixture: propagation only calls the model at all once `buildCandidatePool` finds a
		// candidate (`writePlanRationale` short-circuits without any model call for zero
		// candidates - packages/copilot/src/ranking.ts) - a single-entity universe would
		// never exercise `combinedCheapModel`'s injected delay below.
		const [companion] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Aldric Vane',
				slug: unique('aldric'),
				aliases: ['Captain Vane'],
				body: 'Keeps the watch these days.'
			})
			.returning();
		if (!companion) throw new Error('entity insert returned no row');

		const [edited] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'place',
				name: 'Follow-up Target',
				slug: unique('followup'),
				aliases: [],
				body: 'A quiet harbor town.'
			})
			.returning();
		if (!edited) throw new Error('entity insert returned no row');

		// A slow model is what makes the first run's `claimed` window observable in real
		// time, instead of racing a schedule() call against however fast the mock happens
		// to resolve.
		const queue = testQueue({}, combinedCheapModel(250));
		queue.schedule({
			universeId: world.id,
			entityId: edited.id,
			entityName: edited.name,
			userId: owner.id,
			oldBody: 'A quiet harbor town.',
			newBody: 'A quiet harbor town. Captain Vane leads the watch here now.',
			triggerRevisionId: null
		});

		await waitForEntityRow(db, world.id, edited.id, (r) => r.status === 'claimed');

		queue.schedule({
			universeId: world.id,
			entityId: edited.id,
			entityName: edited.name,
			userId: owner.id,
			oldBody: 'A quiet harbor town. Captain Vane leads the watch here now.',
			newBody:
				'A quiet harbor town. Captain Vane leads the watch here now, as he has since the thaw.',
			triggerRevisionId: null
		});

		await queue.waitForIdle();
		await queue.stop();

		const rows = await db
			.select()
			.from(canonSaveJob)
			.where(and(eq(canonSaveJob.universeId, world.id), eq(canonSaveJob.entityId, edited.id)))
			.orderBy(canonSaveJob.createdAt);
		// Exactly one follow-up: the run in flight when the second save landed, plus one
		// more - never a third, however many schedule() calls happened while the first was
		// still running (there was only one here, but the mechanism is the same one the
		// deleted in-memory test proved with several).
		expect(rows).toHaveLength(2);
		expect(rows[0]?.status).toBe('done');
		expect(rows[0]?.oldBody).toBe('A quiet harbor town.');
		expect(rows[0]?.newBody).toBe('A quiet harbor town. Captain Vane leads the watch here now.');
		expect(rows[1]?.status).toBe('done');
		expect(rows[1]?.oldBody).toBe('A quiet harbor town. Captain Vane leads the watch here now.');
		expect(rows[1]?.newBody).toBe(
			'A quiet harbor town. Captain Vane leads the watch here now, as he has since the thaw.'
		);
	});

	it('coalesces across two independent queue instances - the multi-process case an in-memory queue cannot do', async () => {
		const { owner, world } = await fixture();
		const [edited] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Cross-Instance Target',
				slug: unique('cross-instance'),
				aliases: [],
				body: 'A'
			})
			.returning();
		if (!edited) throw new Error('entity insert returned no row');

		// Two fully independent `CanonSaveJobQueue`s, each with its own poller and its own
		// mock model - standing in for two web replicas behind a proxy, sharing nothing but
		// the database. Only one of the two ever claims the row, so only one of the two
		// mocks is ever actually called.
		const instanceA = testQueue();
		const instanceB = testQueue();

		instanceA.schedule({
			universeId: world.id,
			entityId: edited.id,
			entityName: edited.name,
			userId: owner.id,
			oldBody: 'A',
			newBody: 'B',
			triggerRevisionId: null
		});
		await delay(15);
		instanceB.schedule({
			universeId: world.id,
			entityId: edited.id,
			entityName: edited.name,
			userId: owner.id,
			oldBody: 'B',
			newBody: 'C',
			triggerRevisionId: null
		});

		await instanceA.waitForIdle();
		await instanceB.waitForIdle();
		await instanceA.stop();
		await instanceB.stop();

		const rows = await db
			.select()
			.from(canonSaveJob)
			.where(and(eq(canonSaveJob.universeId, world.id), eq(canonSaveJob.entityId, edited.id)));
		expect(rows, 'two instances scheduling the same key produced one run, not two').toHaveLength(1);
		expect(rows[0]?.status).toBe('done');
		expect(rows[0]?.oldBody).toBe('A');
		expect(rows[0]?.newBody).toBe('C');

		const plans = await db
			.select()
			.from(proposalPlan)
			.where(and(eq(proposalPlan.universeId, world.id), eq(proposalPlan.trigger, 'save')));
		expect(plans).toHaveLength(1);
	});

	it("reclaims a crashed worker's job after its lease expires, and a second worker finishes it", async () => {
		const { owner, world } = await fixture();
		const [edited] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Reclaim Target',
				slug: unique('reclaim'),
				aliases: [],
				body: 'irrelevant'
			})
			.returning();
		if (!edited) throw new Error('entity insert returned no row');

		// Simulates a worker that claimed this job and then crashed before ever calling
		// `completeCanonSaveJob` - not reachable through `schedule()`, since a real run
		// always settles one way or another. `leaseExpiresAt` already in the past is what
		// makes it immediately reclaimable.
		const [stuck] = await db
			.insert(canonSaveJob)
			.values({
				universeId: world.id,
				entityId: edited.id,
				entityName: edited.name,
				userId: owner.id,
				oldBody: 'reclaim old',
				newBody: 'reclaim new',
				triggerRevisionId: null,
				runAfter: new Date(Date.now() - 2000),
				status: 'claimed',
				leaseHolder: 'dead-worker-simulated',
				leaseExpiresAt: new Date(Date.now() - 500),
				attemptCount: 1,
				startedAt: new Date(Date.now() - 2000)
			})
			.returning();
		if (!stuck) throw new Error('canon_save_job insert returned no row');
		expect(stuck.status).toBe('claimed');
		expect(stuck.leaseHolder).toBe('dead-worker-simulated');

		const queue = testQueue({ leaseMs: 60_000, maxAttempts: 5 });
		const done = await waitForRow(db, stuck.id, (r) => r.status === 'done');
		await queue.stop();

		expect(done.attemptCount).toBe(2);
		expect(done.leaseHolder).not.toBe('dead-worker-simulated');
		expect(done.propagationOutcome).not.toBeNull();
		expect(done.auditOutcome).not.toBeNull();

		const rows = await db.select().from(canonSaveJob).where(eq(canonSaveJob.id, stuck.id));
		expect(rows, 'reclaiming never duplicates the row').toHaveLength(1);
	});

	it('dead-letters a job as failed once its attempt cap is exhausted, instead of reclaiming it forever', async () => {
		const { owner, world } = await fixture();
		const [edited] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Attempt Cap Target',
				slug: unique('attempt-cap'),
				aliases: [],
				body: 'irrelevant'
			})
			.returning();
		if (!edited) throw new Error('entity insert returned no row');

		const [exhausted] = await db
			.insert(canonSaveJob)
			.values({
				universeId: world.id,
				entityId: edited.id,
				entityName: edited.name,
				userId: owner.id,
				oldBody: 'cap old',
				newBody: 'cap new',
				triggerRevisionId: null,
				runAfter: new Date(Date.now() - 2000),
				status: 'claimed',
				leaseHolder: 'dead-worker-again',
				leaseExpiresAt: new Date(Date.now() - 500),
				attemptCount: 2,
				startedAt: new Date(Date.now() - 2000)
			})
			.returning();
		if (!exhausted) throw new Error('canon_save_job insert returned no row');

		const queue = testQueue({ leaseMs: 60_000, maxAttempts: 2 });
		const failed = await waitForRow(db, exhausted.id, (r) => r.status === 'failed');
		await queue.stop();

		// Dead-lettered, not reclaimed: attempt_count and lease_holder are exactly what they
		// were before this poll, proving the cap stopped it from ever being claimed again.
		expect(failed.attemptCount).toBe(2);
		expect(failed.leaseHolder).toBe('dead-worker-again');
		expect(failed.lastError).toBeTruthy();
		expect(failed.lastError).toContain('2 attempt');

		// Written down where a human can find it: the failure surfaces through the same
		// introspection a completed job does.
		const recent = await queue.recentJobs();
		const record = recent.find((r) => r.entityId === edited.id);
		expect(record?.propagation.status).toBe('error');
		expect(record?.audit.status).toBe('error');
	});
});
