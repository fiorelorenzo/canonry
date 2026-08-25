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
	sql,
	type Db
} from '@canonry/db';
import { clearModelCache, resolveModel } from '@canonry/ai';
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
	universeIndexBackfill,
	user
} from '@canonry/db/schema';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	embeddingDimensionsFor,
	retrieveForUniverse,
	type EmbeddingModelFactory
} from '@canonry/indexing';
import { createVectorClient, dropCollection, loreCollectionNameForModel } from '@canonry/vector';
import {
	createCanonSaveJobQueue,
	type CanonSaveJobQueue,
	type CanonSaveJobQueueOptions,
	type EngineOutcome,
	type IndexOutcome
} from './canon-save.js';
import { entitiesSkippedForNoEmbeddingModel } from './store.js';
import { resumeIndexBackfill, type UniverseIndexBackfillRow } from './backfill-store.js';

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

/** Issue #164: no `AI_GATEWAY_*` credentials in this box either, so the index engine's
 * embedder is a scripted stand-in too - same hashing trick `@canonry/indexing`'s own
 * `hashingEmbedder` uses, parameterised to whatever width the suite's active `'embedding'`
 * `model_config` row (migration 0025's seed) actually resolves to, so a real
 * `ensureCollection`/`upsertPoints` call never sees a width mismatch. */
function fakeEmbedVector(text: string, dims: number): number[] {
	const vector = new Array(dims).fill(0) as number[];
	const tokens = text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((token) => token.length > 0);
	for (const token of tokens) {
		let hash = 2166136261;
		for (let i = 0; i < token.length; i++) {
			hash ^= token.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		const bucket = Math.abs(hash) % dims;
		vector[bucket] = (vector[bucket] ?? 0) + 1;
	}
	const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
	return norm > 0 ? vector.map((v) => v / norm) : vector;
}

function fakeEmbeddingModelFactory(): EmbeddingModelFactory {
	return (resolved) => {
		const dims = embeddingDimensionsFor(resolved.provider, resolved.modelId);
		return new MockEmbeddingModelV4({
			doEmbed: async (options) => ({
				embeddings: options.values.map((text) => fakeEmbedVector(text, dims)),
				usage: { tokens: options.values.join(' ').length },
				warnings: []
			})
		}) as unknown as EmbeddingModel;
	};
}

/** Every other test in this file never wires a real embedding gateway - this factory is
 * never called for them (`runIndexEngine` resolves the embedding model and checks
 * `oldBody !== newBody` before ever reaching it, and every save below that changes a body
 * still only exercises the caught, contained `error` path this throw produces), so the
 * default keeps the suite from writing to Qdrant at all except in the one test below that
 * asks to. */
const NO_EMBEDDING_MODEL_FACTORY: EmbeddingModelFactory = () => {
	throw new Error('no embedding gateway wired in this test');
};

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
	//
	// Issue #709's sweep is effectively off by default here (`backfillSweepIntervalMs` a day),
	// and that is not tidiness. Every instance in this file shares one database, so a sweep
	// firing on its own timer would enqueue a backfill for whatever universe another test has
	// just left with a `no-embedding-model` row and fan out index jobs into it mid-assertion.
	// The backfill tests below drive `sweepIndexBackfills()` by hand instead, which also keeps
	// "the trigger fired" and "the catch-up ran" separately observable.
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
			backfillSweepIntervalMs: 24 * 3600_000,
			backfillPollIntervalMs: 10,
			backfillLeaseMs: 5000,
			// Production is 5s and 10s. What a test has to prove is that the stagger is applied and
			// that a pass comes back to verify, not that either number is spent in real seconds.
			backfillStaggerMs: 300,
			backfillVerifyDelayMs: 100,
			db,
			modelFactory: modelFactoryFor(cheap),
			gateway: IDENTITY_GATEWAY,
			vectorClient: createVectorClient(),
			embeddingModelFactory: NO_EMBEDDING_MODEL_FACTORY,
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
			triggerRevisionId: null,
			locale: 'en' as const
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
			triggerRevisionId: null,
			locale: 'en' as const
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
			triggerRevisionId: null,
			locale: 'en' as const
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
				triggerRevisionId: null,
				locale: 'en' as const
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
			triggerRevisionId: null,
			locale: 'en' as const
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
			triggerRevisionId: null,
			locale: 'en' as const
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
			triggerRevisionId: null,
			locale: 'en' as const
		});
		await delay(15);
		instanceB.schedule({
			universeId: world.id,
			entityId: edited.id,
			entityName: edited.name,
			userId: owner.id,
			oldBody: 'B',
			newBody: 'C',
			triggerRevisionId: null,
			locale: 'en' as const
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
				locale: 'en' as const,
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
				locale: 'en' as const,
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

	it('indexes the saved entity through the worker (issue #164): retrievable chunks, and a re-save replaces rather than duplicates them', async () => {
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const dims = embeddingDimensionsFor(embeddingModel.provider, embeddingModel.modelId);
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();
		const queue = testQueue({
			vectorClient: vector,
			embeddingModelFactory: fakeEmbeddingModelFactory()
		});

		try {
			const [saved] = await db
				.insert(entity)
				.values({
					universeId: world.id,
					type: 'place',
					name: 'The Gilded Rat',
					slug: unique('gilded-rat'),
					aliases: [],
					body: ''
				})
				.returning();
			if (!saved) throw new Error('entity insert returned no row');

			const firstBody =
				'The Gilded Rat is a smugglers tavern in the harbour district, run by Old Maren.';
			// The entity's own row moves first, then the job is scheduled - the order
			// `e/[slug]/edit`'s save action follows, and since issue #703 the order the index
			// engine depends on: it embeds what the entity currently says, not what the row that
			// scheduled it remembers.
			await db.update(entity).set({ body: firstBody }).where(eq(entity.id, saved.id));
			queue.schedule({
				universeId: world.id,
				entityId: saved.id,
				entityName: saved.name,
				userId: owner.id,
				oldBody: '',
				newBody: firstBody,
				triggerRevisionId: null,
				locale: 'en'
			});

			const firstRow = await waitForEntityRow(
				db,
				world.id,
				saved.id,
				(row) => row.status === 'done' && row.newBody === firstBody
			);
			// `index_outcome` is jsonb, so drizzle gives it back as `unknown`; the engine that
			// wrote it is the only writer, so the row's own union is the shape rather than a
			// fabricated one, asserted once into a named const.
			const firstOutcome = firstRow.indexOutcome as IndexOutcome;
			if (firstOutcome.status !== 'ok') throw new Error(`indexed ${firstOutcome.status}`);
			expect(firstOutcome.chunkCount).toBeGreaterThan(0);
			expect(firstOutcome.entityPointWritten).toBe(true);

			const findsMaren = 'smugglers tavern harbour district Old Maren';
			const marenHits = await retrieveForUniverse({
				db,
				vectorClient: vector,
				collectionName,
				universeId: world.id,
				queryVector: fakeEmbedVector(findsMaren, dims),
				queryText: findsMaren,
				topK: 10,
				threshold: -1
			});
			expect(marenHits.some((h) => h.payload.text.includes('Old Maren'))).toBe(true);

			// Re-save with a different body: the stale chunk has to be replaced, not
			// accumulated alongside the new one.
			const secondBody = 'The Gilded Rat burned down last winter; only the sign remains.';
			await db.update(entity).set({ body: secondBody }).where(eq(entity.id, saved.id));
			queue.schedule({
				universeId: world.id,
				entityId: saved.id,
				entityName: saved.name,
				userId: owner.id,
				oldBody: firstBody,
				newBody: secondBody,
				triggerRevisionId: null,
				locale: 'en'
			});
			const secondRow = await waitForEntityRow(
				db,
				world.id,
				saved.id,
				(row) => row.status === 'done' && row.newBody === secondBody
			);
			const secondOutcome = secondRow.indexOutcome as IndexOutcome;
			if (secondOutcome.status !== 'ok') throw new Error(`re-indexed ${secondOutcome.status}`);

			const afterResave = await retrieveForUniverse({
				db,
				vectorClient: vector,
				collectionName,
				universeId: world.id,
				queryVector: fakeEmbedVector(findsMaren, dims),
				queryText: findsMaren,
				topK: 10,
				threshold: -1
			});
			expect(afterResave.every((h) => !h.payload.text.includes('Old Maren'))).toBe(true);

			const findsRuin = 'burned down winter sign remains';
			const allForEntity = await retrieveForUniverse({
				db,
				vectorClient: vector,
				collectionName,
				universeId: world.id,
				queryVector: fakeEmbedVector(findsRuin, dims),
				queryText: findsRuin,
				topK: 50,
				threshold: -1
			});
			const pointsForEntity = allForEntity.filter((h) => h.payload.url.endsWith(saved.id));
			expect(
				pointsForEntity,
				'no duplicate points left behind by the first save, plus the one entity point'
			).toHaveLength(secondOutcome.chunkCount + 1);
			expect(pointsForEntity.filter((h) => h.payload.pointKind === 'entity')).toHaveLength(1);
		} finally {
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	});

	it('an index-only schedule indexes a bodyless entry and runs neither other engine (issue #703)', async () => {
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const dims = embeddingDimensionsFor(embeddingModel.provider, embeddingModel.modelId);
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();
		const queue = testQueue({
			vectorClient: vector,
			embeddingModelFactory: fakeEmbeddingModelFactory()
		});

		try {
			// The state the entity-level point exists for, and the one an import accept and the
			// entries list's "New entry" both produce: a name, its aliases, a type, no prose.
			const [created] = await db
				.insert(entity)
				.values({
					universeId: world.id,
					type: 'place',
					name: 'Il Ratto Dorato',
					slug: unique('ratto-dorato'),
					aliases: ['the Gilded Rat'],
					body: ''
				})
				.returning();
			if (!created) throw new Error('entity insert returned no row');

			queue.scheduleIndexOnly({
				universeId: world.id,
				entityId: created.id,
				entityName: created.name,
				userId: owner.id,
				locale: 'en'
			});

			const row = await waitForEntityRow(
				db,
				world.id,
				created.id,
				(r) => r.status === 'done' && r.entityId === created.id
			);
			const index = row.indexOutcome as IndexOutcome;
			if (index.status !== 'ok') throw new Error(`indexed ${index.status}`);
			expect(index.chunkCount, 'no prose to chunk').toBe(0);
			expect(index.entityPointWritten).toBe(true);

			// The recursion guard, restated for the surface that replaced it: an index-only row
			// carries no diff, so both other engines answer `no-change` without a model call, and
			// neither a plan nor a spend exists for this universe afterwards.
			const propagation = row.propagationOutcome as EngineOutcome;
			const audit = row.auditOutcome as EngineOutcome;
			expect(propagation.status).toBe('no-change');
			expect(audit.status).toBe('no-change');
			expect(
				await db.select().from(proposalPlan).where(eq(proposalPlan.universeId, world.id))
			).toHaveLength(0);
			// One `model_call` row and one only, the index engine's own embedding: agent
			// 'indexing', which is reading infrastructure charged at zero credits, never
			// generation. Anything from propagation or audit would be a different agent, and
			// there is none.
			const calls = await db.select().from(modelCall).where(eq(modelCall.universeId, world.id));
			expect(calls.every((call) => call.agent === 'indexing')).toBe(true);
			expect(calls.every((call) => call.credits === 0)).toBe(true);

			// And the point of all of it: an entry with no body is now retrievable, by the alias
			// as well as by the name. Nothing about this entity was in the collection before.
			const query = 'the Gilded Rat';
			const hits = await retrieveForUniverse({
				db,
				vectorClient: vector,
				collectionName,
				universeId: world.id,
				queryVector: fakeEmbedVector(query, dims),
				queryText: query,
				topK: 10,
				threshold: -1
			});
			const hit = hits.find((h) => h.payload.url.endsWith(created.id));
			expect(hit, 'a named, unwritten entry is citable').toBeDefined();
			expect(hit?.payload.pointKind).toBe('entity');
			expect(hit?.payload.entityType).toBe('place');
			expect(hit?.payload.text).toContain('the Gilded Rat');
		} finally {
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	});

	it('an index-only schedule never clobbers a pending human save\u2019s diff (issue #703)', async () => {
		const { owner, world } = await fixture();
		const [edited] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Merged Burst',
				slug: unique('merged-burst'),
				aliases: [],
				body: 'Old body.'
			})
			.returning();
		if (!edited) throw new Error('entity insert returned no row');

		// A GM saving an entry and an accept landing on the same entity inside one debounce
		// window merge into one row (the partial unique index on (universe, entity) while
		// pending). The human save's diff has to survive that merge, or its propagation is
		// silently dropped - which is the one thing this table exists to deliver.
		const queue = testQueue();
		try {
			queue.schedule({
				universeId: world.id,
				entityId: edited.id,
				entityName: edited.name,
				userId: owner.id,
				oldBody: 'Old body.',
				newBody: 'New body, materially different.',
				triggerRevisionId: null,
				locale: 'en'
			});
			queue.scheduleIndexOnly({
				universeId: world.id,
				entityId: edited.id,
				entityName: edited.name,
				userId: owner.id,
				locale: 'en'
			});

			const row = await waitForEntityRow(
				db,
				world.id,
				edited.id,
				(r) => r.status === 'claimed' || r.status === 'done'
			);
			expect(row.oldBody).toBe('Old body.');
			expect(row.newBody).toBe('New body, materially different.');
		} finally {
			await queue.stop();
		}
	});

	it('records a universe with no embedding model as no-embedding-model rather than silence (issue #703)', async () => {
		const { owner, world } = await fixture();
		const [created] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'place',
				name: 'Unindexable Hold',
				slug: unique('unindexable-hold'),
				aliases: [],
				body: 'A keep nobody can find, for want of an embedding row.'
			})
			.returning();
		if (!created) throw new Error('entity insert returned no row');

		// `resolveModel` is process-wide and caches for 30 seconds, so reaching the state a
		// fresh deployment is in takes both halves: deactivate the row migration 0025 seeds,
		// and clear that cache, or the engine answers from a resolution taken before this test
		// ran. Restored in the `finally` below, and safe to do here because no other test file
		// in `apps/web` resolves the `embedding` purpose, directly or through a route it calls -
		// a file that starts to will need this one to hold an advisory lock instead (the shape
		// `packages/media`'s `lockImageModelConfigForFile` already has).
		const active = await db
			.update(modelConfig)
			.set({ active: false })
			.where(and(eq(modelConfig.purpose, 'embedding'), eq(modelConfig.active, true)))
			.returning({ id: modelConfig.id });
		clearModelCache();
		const queue = testQueue();
		try {
			queue.scheduleIndexOnly({
				universeId: world.id,
				entityId: created.id,
				entityName: created.name,
				userId: owner.id,
				locale: 'en'
			});
			const row = await waitForEntityRow(db, world.id, created.id, (r) => r.status === 'done');
			// The whole point: not `no-change`, which is what this used to say and what made a
			// quietly empty index indistinguishable from a save that changed nothing.
			const outcome = row.indexOutcome as IndexOutcome;
			expect(outcome.status).toBe('no-embedding-model');
			expect(
				await entitiesSkippedForNoEmbeddingModel(db, world.id, created.id),
				'the count that goes on the log line, so one line says how much of the universe is missing'
			).toBe(1);
		} finally {
			await queue.stop();
			for (const row of active) {
				await db.update(modelConfig).set({ active: true }).where(eq(modelConfig.id, row.id));
			}
			clearModelCache();
		}
	});

	/**
	 * Issue #709. #703 made the skip visible and named the fact that nothing came back for it;
	 * these are the tests that it now does.
	 *
	 * `withoutEmbeddingModel` is the same manoeuvre the test above makes, factored out because
	 * every test here needs the "before" arm to be a universe that genuinely has no embedding
	 * model. Note the ordering it has to get right: the row goes back to active *and* the cache
	 * is cleared before anything asserts on the catch-up, because "the row appeared" is the
	 * trigger condition and a stale cache would make the sweep answer from a resolution taken
	 * while it was still missing.
	 */
	async function withoutEmbeddingModel<T>(body: () => Promise<T>): Promise<T> {
		const active = await db
			.update(modelConfig)
			.set({ active: false })
			.where(and(eq(modelConfig.purpose, 'embedding'), eq(modelConfig.active, true)))
			.returning({ id: modelConfig.id });
		clearModelCache();
		try {
			return await body();
		} finally {
			for (const row of active) {
				await db.update(modelConfig).set({ active: true }).where(eq(modelConfig.id, row.id));
			}
			clearModelCache();
		}
	}

	async function insertEntry(worldId: string, name: string, body = '') {
		const [row] = await db
			.insert(entity)
			.values({
				universeId: worldId,
				type: 'place',
				name,
				slug: unique('entry'),
				aliases: [],
				body
			})
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		return row;
	}

	function backfillJobRowsFor(worldId: string) {
		return db
			.select()
			.from(canonSaveJob)
			.where(eq(canonSaveJob.universeId, worldId))
			.orderBy(canonSaveJob.runAfter);
	}

	/** How many job rows each entity got, which is the assertion a count cannot make. A
	 * double-schedule moves this map and moves no set: `new Set(rows.map(r => r.entityId))` is
	 * blind to a duplicate by construction, and `entities_scheduled` sees one only if you
	 * already know what the right number is. This says which entries were scheduled *and* that
	 * each was scheduled once, which is the whole claim (#737, #764). */
	function rowsPerEntity(rows: readonly CanonSaveJobRow[]): Map<string, number> {
		const counts = new Map<string, number>();
		for (const row of rows) counts.set(row.entityId, (counts.get(row.entityId) ?? 0) + 1);
		return counts;
	}

	it('enqueues no backfill while there is no embedding model, and one for the skipped universe once there is (issue #709)', async () => {
		const { owner, world } = await fixture();
		const created = await insertEntry(world.id, 'Unreachable Hold');
		const queue = testQueue();
		try {
			const skipped = await withoutEmbeddingModel(async () => {
				queue.scheduleIndexOnly({
					universeId: world.id,
					entityId: created.id,
					entityName: created.name,
					userId: owner.id,
					locale: 'en'
				});
				const row = await waitForEntityRow(db, world.id, created.id, (r) => r.status === 'done');
				expect((row.indexOutcome as IndexOutcome).status).toBe('no-embedding-model');

				// The trigger's own precondition, and the reason it is a separate assertion: with no
				// row configured the sweep does nothing at all, so it can never enqueue a catch-up
				// that could only be requeued until a model appears.
				expect(await queue.sweepIndexBackfills()).toEqual([]);
				expect(await queue.recentBackfills(world.id)).toEqual([]);
				return row;
			});
			expect(skipped.status).toBe('done');

			// The row is back. Nothing about this universe changed, nobody saved anything, and the
			// catch-up is owed anyway - which is the difference between this trigger and one that
			// hangs off the next save.
			const enqueued = await queue.sweepIndexBackfills();
			expect(enqueued).toContain(world.id);
			const [backfill] = await queue.recentBackfills(world.id);
			expect(backfill?.reason).toBe('no-embedding-model');

			// And it is enqueued exactly once: a second sweep before the first has finished must not
			// produce a second row, which is what the partial unique index is for.
			expect(await queue.sweepIndexBackfills()).not.toContain(world.id);
			expect(await queue.recentBackfills(world.id)).toHaveLength(1);
		} finally {
			await queue.stop();
		}
		// Longer than vitest's 5s default, and the only tests in this file that need it: each one
		// drives several real debounce windows, a real Qdrant scroll and a real fan-out that then
		// has to drain through the worker. Real timers, on purpose, like everything else here.
	}, 45_000);

	it('a backfill schedules one index job per unindexed entry, staggered, and none for an entry already indexed (issue #709)', async () => {
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();
		// A real fan-out has to happen against a queue that can actually index, or the jobs it
		// writes cannot be told from jobs that failed for another reason.
		const queue = testQueue({
			vectorClient: vector,
			embeddingModelFactory: fakeEmbeddingModelFactory()
		});
		try {
			// One entry indexed the ordinary way, before the model ever goes missing: the backfill
			// must leave it alone, because re-embedding a world that is already indexed is how a
			// catch-up turns into a recurring cost.
			const alreadyIndexed = await insertEntry(
				world.id,
				'The Lit Lantern',
				'A tavern with a sign.'
			);
			queue.scheduleIndexOnly({
				universeId: world.id,
				entityId: alreadyIndexed.id,
				entityName: alreadyIndexed.name,
				userId: owner.id,
				locale: 'en'
			});
			const indexedRow = await waitForEntityRow(
				db,
				world.id,
				alreadyIndexed.id,
				(r) => r.status === 'done'
			);
			expect((indexedRow.indexOutcome as IndexOutcome).status).toBe('ok');

			const skippedEntries = await withoutEmbeddingModel(async () => {
				const entries = [];
				for (const name of ['Hollow Deep', 'Saltmarsh Gate', 'The Ashen Ledger']) {
					const row = await insertEntry(world.id, name, `${name} is somewhere in the marsh.`);
					entries.push(row);
					queue.scheduleIndexOnly({
						universeId: world.id,
						entityId: row.id,
						entityName: row.name,
						userId: owner.id,
						locale: 'en'
					});
					const job = await waitForEntityRow(db, world.id, row.id, (r) => r.status === 'done');
					expect((job.indexOutcome as IndexOutcome).status).toBe('no-embedding-model');
				}
				return entries;
			});

			const before = await backfillJobRowsFor(world.id);
			await queue.sweepIndexBackfills();
			await queue.waitForBackfillIdle(world.id, 30_000);

			const [backfill] = await queue.recentBackfills(world.id);
			// `done` means an enumeration came back empty, not that a pass scheduled everything it
			// found: this row went `pending -> claimed -> pending (verifying) -> claimed -> done`,
			// and the counts on it are the *last* pass's, which is why `entities_missing` is zero.
			expect(backfill?.status).toBe('done');
			expect(backfill?.entitiesTotal).toBe(4);
			expect(backfill?.entitiesMissing).toBe(0);

			const after = await backfillJobRowsFor(world.id);
			const fannedOut = after.filter((row) => !before.some((old) => old.id === row.id));
			// Three rows, one per skipped entry, and none for the entry that already had its point.
			// A map rather than the count that used to be here (`entities_scheduled` toBe(3)) or the
			// set that used to sit beside it: the count moved under load without saying which entry
			// had been scheduled twice, and a set of ids cannot see a duplicate at all. This says
			// which entries and how many rows each, which is the claim both of those stood in for
			// (#737, #764).
			expect(rowsPerEntity(fannedOut)).toEqual(new Map(skippedEntries.map((row) => [row.id, 1])));
			// And the counter agrees with the rows that exist, rather than with a literal somebody
			// would have to keep in step with the fixture.
			expect(backfill?.entitiesScheduled).toBe(fannedOut.length);
			// The shape that makes propagation and audit structurally impossible for these rows, the
			// same guard `scheduleEntityIndexJob` relies on: no diff to name, no revision to blame.
			for (const row of fannedOut) {
				expect(row.oldBody).toBe('');
				expect(row.newBody).toBe('');
				expect(row.triggerRevisionId).toBeNull();
				// There is no actor behind a backfill; the universe's owner is who a zero-credit
				// `index.embed` in their own world belongs to.
				expect(row.userId).toBe(owner.id);
			}

			// Three entries is one batch, so they share a `run_after` - the stagger is per batch of
			// `BACKFILL_SCHEDULE_BATCH`, and what matters here is that a backfill row is never due
			// *before* a save made at the same moment, which is what keeps a GM's propagation ahead
			// of a catch-up they did not ask for. Still a count, and no longer a race detector: the
			// assertion above pins exactly which rows `fannedOut` holds, so a duplicate pass cannot
			// reach this line to add its later `run_after` to the set (which is what made it fail
			// as a second-order symptom in #737).
			const dueTimes = new Set(fannedOut.map((row) => row.runAfter.getTime()));
			expect(dueTimes.size).toBe(1);

			// The deliverable: those three entries are retrievable now, which they were not.
			//
			// `waitForIdle` is deliberately not what waits here. It tracks the ids this *instance's*
			// own `schedule()` calls returned, and a backfill's rows are written by the worker's own
			// statement rather than through that surface, so it answers immediately and proves
			// nothing. The rows themselves are the thing to wait on.
			const gate = skippedEntries.find((row) => row.name === 'Saltmarsh Gate')!;
			for (const entry of skippedEntries) {
				const done = await waitForEntityRow(
					db,
					world.id,
					entry.id,
					(row) => row.status === 'done' && (row.indexOutcome as IndexOutcome).status === 'ok',
					20_000
				);
				const outcome = done.indexOutcome as IndexOutcome;
				if (outcome.status !== 'ok') throw new Error(`backfilled ${outcome.status}`);
				expect(outcome.entityPointWritten).toBe(true);
			}

			const findsGate = 'Saltmarsh Gate';
			const hits = await retrieveForUniverse({
				db,
				vectorClient: vector,
				collectionName,
				universeId: world.id,
				queryVector: fakeEmbedVector(
					findsGate,
					embeddingDimensionsFor(embeddingModel.provider, embeddingModel.modelId)
				),
				queryText: findsGate,
				topK: 20,
				threshold: -1
			});
			expect(
				hits.some((hit) => hit.payload.text.includes(gate.name)),
				'an entry skipped for want of an embedding model is retrievable after the backfill'
			).toBe(true);
		} finally {
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	}, 45_000);

	it('finds an entry the job rows cannot see, which is why the enumeration reads the collection (issue #709)', async () => {
		// The completeness claim, as a test rather than an argument. Three entries, none of which
		// has an entity-level point, and only one of which has a `canon_save_job` row carrying
		// `no-embedding-model`:
		//
		//  - one written straight to `entity`, the way `seed-fixture.ts` and `packages/bench` do,
		//    so no job was ever scheduled for it;
		//  - one whose job dead-lettered, so `index_outcome` is null and the status predicate
		//    cannot match it;
		//  - one that genuinely skipped, which is the only one a job-row enumeration can name.
		//
		// A backfill driven off the job rows leaves all three out of retrieval forever. The one
		// driven off the collection finds them.
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();
		const queue = testQueue({
			vectorClient: vector,
			embeddingModelFactory: fakeEmbeddingModelFactory()
		});
		try {
			const neverScheduled = await insertEntry(world.id, 'Seeded Hold', 'Straight into the table.');
			const deadLettered = await insertEntry(world.id, 'Abandoned Hold', 'Its job gave up.');
			// The trigger still needs one genuine skip to have happened, which is what makes this
			// universe owed a catch-up at all.
			const skipped = await withoutEmbeddingModel(async () => {
				const row = await insertEntry(world.id, 'Skipped Hold', 'Recorded honestly.');
				queue.scheduleIndexOnly({
					universeId: world.id,
					entityId: row.id,
					entityName: row.name,
					userId: owner.id,
					locale: 'en'
				});
				await waitForEntityRow(db, world.id, row.id, (r) => r.status === 'done');
				return row;
			});

			await db.insert(canonSaveJob).values([
				{
					universeId: world.id,
					entityId: deadLettered.id,
					entityName: deadLettered.name,
					userId: owner.id,
					oldBody: '',
					newBody: '',
					locale: 'en',
					status: 'failed',
					attemptCount: 5,
					lastError: 'lease expired after 5 attempt(s)',
					finishedAt: new Date()
				}
			]);

			// What a job-row enumeration would have to work from, measured rather than asserted
			// about: one entity, the one whose run actually recorded the status.
			const rowsCarryingTheStatus = await db
				.selectDistinct({ entityId: canonSaveJob.entityId })
				.from(canonSaveJob)
				.where(
					and(
						eq(canonSaveJob.universeId, world.id),
						sql`${canonSaveJob.indexOutcome}->>'status' = 'no-embedding-model'`
					)
				);
			expect(rowsCarryingTheStatus.map((row) => row.entityId)).toEqual([skipped.id]);

			const before = await backfillJobRowsFor(world.id);
			await queue.sweepIndexBackfills();
			await queue.waitForBackfillIdle(world.id, 30_000);

			const [backfill] = await queue.recentBackfills(world.id);
			expect(backfill?.status).toBe('done');
			// All three, not the one the job rows can name.
			expect(backfill?.entitiesTotal).toBe(3);
			expect(backfill?.entitiesMissing).toBe(0);

			// Which three, and how many rows each, which is the claim `entities_scheduled` only
			// stands in for. #737 made this a count beside a set of ids and #764 is why neither was
			// enough: the count knew a duplicate had happened without saying which entry, and the
			// set could not see one at all. The map says both. `entities_scheduled` is then checked
			// against the rows that exist rather than against a literal, so the counter is asserted
			// to agree with reality instead of being a second, independent guess at it.
			const fannedOut = (await backfillJobRowsFor(world.id)).filter(
				(row) => !before.some((old) => old.id === row.id)
			);
			expect(rowsPerEntity(fannedOut)).toEqual(
				new Map([
					[neverScheduled.id, 1],
					[deadLettered.id, 1],
					[skipped.id, 1]
				])
			);
			expect(backfill?.entitiesScheduled).toBe(fannedOut.length);

			for (const entry of [neverScheduled, deadLettered, skipped]) {
				const done = await waitForEntityRow(
					db,
					world.id,
					entry.id,
					(row) => row.status === 'done' && (row.indexOutcome as IndexOutcome).status === 'ok',
					20_000
				);
				expect((done.indexOutcome as IndexOutcome).status).toBe('ok');
			}

			const hits = await retrieveForUniverse({
				db,
				vectorClient: vector,
				collectionName,
				universeId: world.id,
				queryVector: fakeEmbedVector(
					'Seeded Hold straight into the table',
					embeddingDimensionsFor(embeddingModel.provider, embeddingModel.modelId)
				),
				queryText: 'Seeded Hold straight into the table',
				topK: 20,
				threshold: -1
			});
			expect(
				hits.some((hit) => hit.payload.text.includes('Seeded Hold')),
				'an entry that never had a job row at all is retrievable after the backfill'
			).toBe(true);
		} finally {
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	}, 45_000);

	it('schedules nothing for an entry whose job finishes between the enumeration and the fan-out (issue #764)', async () => {
		// #746 stopped the fan-out re-scheduling an entry whose job was still `pending` or
		// `claimed` by reading the in-flight set inside the insert's own statement. #764 is the
		// window that anti-join cannot see, because it is not inside the statement at all:
		//
		//   T0  the pass reads the collection and finds this entry missing, because the job that
		//       is about to index it is still `claimed`;
		//   T1  that job upserts the entity point (`wait: true`, so it is visible to every read
		//       after this) and `completeCanonSaveJob` marks the row `done`;
		//   T2  the pass runs its insert. The anti-join sees a `done` row, which is deliberately
		//       not in-flight (#715: an entry whose job ended without writing its point still
		//       needs one), and `canon_save_job_pending_key` constrains `pending` only, so a
		//       second job row is written for work that has already finished.
		//
		// Widening the partial unique index would not have closed this: at T2 the row is `done`,
		// and an index that also blocked `done` and `failed` would break both #715 and #762's
		// give-up path. What closes it is that the pass fixes its work list at T0 - the in-flight
		// set is read *before* the collection, so an entry that was in flight when we looked is
		// never scheduled on the strength of that look.
		//
		// Forced rather than raced, which is the whole point: the embedder holds until the
		// verification pass has read the collection, and that read then holds until the job it
		// was racing is `done`. Both halves of the interleaving are ours, so this fails on every
		// run against the code before the fix rather than one run in a hundred under CI load.
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();

		// The embedder the fan-out's own job will reach, held shut until the pass has looked.
		const held = Promise.withResolvers<void>();
		const holdingEmbeddingFactory: EmbeddingModelFactory = (resolved) => {
			const dims = embeddingDimensionsFor(resolved.provider, resolved.modelId);
			return new MockEmbeddingModelV4({
				doEmbed: async (options) => {
					await held.promise;
					return {
						embeddings: options.values.map((text) => fakeEmbedVector(text, dims)),
						usage: { tokens: options.values.join(' ').length },
						warnings: []
					};
				}
			}) as unknown as EmbeddingModel;
		};

		let entryId = '';
		let interleaved = false;
		let interleavedJobId = '';
		// The seam is `scroll`, because that is the enumeration's own read of the collection
		// (`indexedEntityUrls` -> `scrollPointsPage` -> `client.scroll`). The page it returns is
		// the real, unmodified answer from before the point landed; all this wrapper does is
		// hold the pass there until the job that answer is stale about has finished, which is
		// exactly what a loaded box does to it for free.
		const interleavingVector = new Proxy(vector, {
			get(target, prop, receiver) {
				const value = Reflect.get(target, prop, receiver);
				if (typeof value !== 'function') return value;
				const method = value.bind(target) as (...args: never[]) => unknown;
				if (prop !== 'scroll') return method;
				return async (...args: never[]) => {
					const page = await method(...args);
					const [inFlight] = await db
						.select({ id: canonSaveJob.id })
						.from(canonSaveJob)
						.where(
							and(
								eq(canonSaveJob.universeId, world.id),
								eq(canonSaveJob.entityId, entryId),
								sql`${canonSaveJob.status} in ('pending', 'claimed')`
							)
						);
					if (!interleaved && inFlight) {
						interleaved = true;
						held.resolve();
						// That row, by id: `waitForEntityRow` would match the `no-embedding-model` job
						// this entry already has, which is `done` before the sweep even starts, and the
						// wait would return without waiting for anything at all.
						interleavedJobId = inFlight.id;
						await waitForRow(db, inFlight.id, (row) => row.status === 'done', 20_000);
					}
					return page;
				};
			}
		}) as typeof vector;

		const queue = testQueue({
			vectorClient: interleavingVector,
			embeddingModelFactory: holdingEmbeddingFactory
		});
		try {
			const skipped = await withoutEmbeddingModel(async () => {
				const row = await insertEntry(world.id, 'Held Hold', 'Indexed while a pass watches.');
				queue.scheduleIndexOnly({
					universeId: world.id,
					entityId: row.id,
					entityName: row.name,
					userId: owner.id,
					locale: 'en'
				});
				// This one records `no-embedding-model` without reaching the embedder at all, so
				// the held promise above does not block it.
				await waitForEntityRow(db, world.id, row.id, (r) => r.status === 'done');
				return row;
			});
			entryId = skipped.id;

			const before = await backfillJobRowsFor(world.id);
			await queue.sweepIndexBackfills();
			await queue.waitForBackfillIdle(world.id, 30_000);

			// Without this the test can pass by never reaching the window it exists for, which is
			// the failure mode of every race test that only asserts the good outcome: the pass has
			// to have read the collection while that job was in flight, and the job has to have
			// reached `done` before the pass got to its insert.
			expect(interleaved, 'the enumeration really did overlap an in-flight job').toBe(true);

			const fannedOut = (await backfillJobRowsFor(world.id)).filter(
				(row) => !before.some((old) => old.id === row.id)
			);
			// One row, for that entry, and the counter agreeing with it. Before the fix this is two
			// rows for one entity and `entities_scheduled` 2, which is #764's `expected 4 to be 3`
			// with the load taken out of it.
			expect(rowsPerEntity(fannedOut)).toEqual(new Map([[skipped.id, 1]]));
			expect(
				fannedOut.map((row) => row.id),
				'the surviving row is the one that did the work, not a replacement for it'
			).toEqual([interleavedJobId]);
			const [backfill] = await queue.recentBackfills(world.id);
			expect(backfill?.status).toBe('done');
			expect(backfill?.entitiesMissing).toBe(0);
			expect(backfill?.entitiesScheduled).toBe(fannedOut.length);
		} finally {
			held.resolve();
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	}, 45_000);

	it('a backfill never touches an entry that already has a pending job of its own (issue #709)', async () => {
		// The one thing a catch-up must never do. `scheduleEntityIndexJobRow`'s conflict branch
		// moves `run_after`, which is right for a fresh accept and would be catastrophic here: a
		// backfill row staggered minutes out would push a GM's queued save minutes out with it, and
		// that save's propagation is the one thing `canon_save_job` exists to deliver on time. So
		// the fan-out is `on conflict do nothing`, and this is that assertion.
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();
		const queue = testQueue({
			vectorClient: vector,
			embeddingModelFactory: fakeEmbeddingModelFactory()
		});
		try {
			const queued = await insertEntry(world.id, 'Queued Hold', 'A save is already waiting.');
			await withoutEmbeddingModel(async () => {
				const row = await insertEntry(world.id, 'Skipped Hold', 'Recorded honestly.');
				queue.scheduleIndexOnly({
					universeId: world.id,
					entityId: row.id,
					entityName: row.name,
					userId: owner.id,
					locale: 'en'
				});
				await waitForEntityRow(db, world.id, row.id, (r) => r.status === 'done');
			});

			// Parked far enough out that it is unambiguously still `pending` when the pass runs,
			// which is what the partial unique index keys on.
			const parkedAt = new Date(Date.now() + 3_600_000);
			const [pendingRow] = await db
				.insert(canonSaveJob)
				.values({
					universeId: world.id,
					entityId: queued.id,
					entityName: queued.name,
					userId: owner.id,
					oldBody: 'before',
					newBody: 'after',
					locale: 'en',
					status: 'pending',
					runAfter: parkedAt
				})
				.returning();

			await queue.sweepIndexBackfills();
			// One pass is enough: this asserts what the fan-out did, not that the catch-up finished.
			// It cannot finish here, because the entry it is waiting on is parked an hour out, and
			// that is correct: a backfill is only `done` once an enumeration comes back empty.
			const deadline = Date.now() + 20_000;
			for (;;) {
				const [row] = await queue.recentBackfills(world.id);
				if (row && row.entitiesScheduled > 0) break;
				if (Date.now() > deadline) throw new Error('the backfill never ran a pass');
				await delay(25);
			}

			const rowsForQueued = await db
				.select()
				.from(canonSaveJob)
				.where(and(eq(canonSaveJob.universeId, world.id), eq(canonSaveJob.entityId, queued.id)));
			expect(rowsForQueued, 'no second row for an entry that already had one').toHaveLength(1);
			expect(rowsForQueued[0]!.id).toBe(pendingRow!.id);
			expect(
				rowsForQueued[0]!.runAfter.getTime(),
				'the queued save is still due exactly when it was'
			).toBe(parkedAt.getTime());
			// And its diff survived: an index-only write into this row would have blanked both
			// bodies and silently dropped the propagation it was scheduled for.
			expect(rowsForQueued[0]!.oldBody).toBe('before');
			expect(rowsForQueued[0]!.newBody).toBe('after');
		} finally {
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	}, 45_000);

	it('a second sweep enqueues nothing once a backfill has covered the skips, and a fresh skip enqueues again (issue #709)', async () => {
		// The watermark. Without it the same historical `no-embedding-model` rows would enqueue a
		// backfill on every sweep, forever, which is a full enumeration of every affected universe
		// once a minute for the life of the deployment.
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();
		const queue = testQueue({
			vectorClient: vector,
			embeddingModelFactory: fakeEmbeddingModelFactory()
		});
		try {
			await withoutEmbeddingModel(async () => {
				const row = await insertEntry(world.id, 'First Hold', 'Skipped once.');
				queue.scheduleIndexOnly({
					universeId: world.id,
					entityId: row.id,
					entityName: row.name,
					userId: owner.id,
					locale: 'en'
				});
				await waitForEntityRow(db, world.id, row.id, (r) => r.status === 'done');
			});

			expect(await queue.sweepIndexBackfills()).toContain(world.id);
			await queue.waitForBackfillIdle(world.id);
			expect(await queue.recentBackfills(world.id)).toHaveLength(1);

			// Nothing new has happened, so nothing is owed.
			expect(await queue.sweepIndexBackfills()).not.toContain(world.id);
			expect(await queue.recentBackfills(world.id)).toHaveLength(1);

			// The row is deactivated again, which is the case #709 says matters: "the day a model
			// change makes somebody deactivate a row to swap it".
			await withoutEmbeddingModel(async () => {
				const row = await insertEntry(world.id, 'Second Hold', 'Skipped again, later.');
				queue.scheduleIndexOnly({
					universeId: world.id,
					entityId: row.id,
					entityName: row.name,
					userId: owner.id,
					locale: 'en'
				});
				await waitForEntityRow(db, world.id, row.id, (r) => r.status === 'done');
			});

			expect(await queue.sweepIndexBackfills()).toContain(world.id);
			expect(await queue.recentBackfills(world.id)).toHaveLength(2);
		} finally {
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	}, 45_000);

	it('gives up on a backfill that cannot make progress, rather than verifying it forever (issue #745)', async () => {
		// #745: `resumeIndexBackfill` documented a dead-letter that could not happen.
		// `claimNextIndexBackfill` consults `maxAttempts` in exactly one place, gated on
		// `status = 'claimed' and lease_expires_at <= now()`, and a pass that finishes cleanly
		// goes back to `pending` with the lease cleared, so the row is never in the state the cap
		// is checked in. The attempts climbed and nothing read them: #737 saw one reach 69 in
		// about thirteen seconds.
		//
		// The stuck shape, which is that issue's own example made reachable: the entry already
		// has a `pending` job of its own parked an hour out, so the fan-out's `on conflict do
		// nothing` writes nothing for it, the point never appears, and every pass re-finds
		// exactly the same shortfall. No pass is ever capped and the missing count never falls,
		// so nothing here is progress and the cap is the only thing that can end it.
		const { owner, world } = await fixture();
		const embeddingModel = await resolveModel(db, 'embedding');
		const collectionName = loreCollectionNameForModel(embeddingModel, world.id);
		const vector = createVectorClient();
		const queue = testQueue({
			maxAttempts: 2,
			vectorClient: vector,
			embeddingModelFactory: fakeEmbeddingModelFactory()
		});
		try {
			const skipped = await insertEntry(world.id, 'Stuck Hold', 'Recorded, never indexed.');
			await withoutEmbeddingModel(async () => {
				queue.scheduleIndexOnly({
					universeId: world.id,
					entityId: skipped.id,
					entityName: skipped.name,
					userId: owner.id,
					locale: 'en'
				});
				await waitForEntityRow(db, world.id, skipped.id, (r) => r.status === 'done');
			});

			// Parked far enough out that it is unambiguously still `pending` on every pass, which
			// is what the fan-out's partial unique index keys on.
			await db.insert(canonSaveJob).values({
				universeId: world.id,
				entityId: skipped.id,
				entityName: skipped.name,
				userId: owner.id,
				oldBody: 'before',
				newBody: 'after',
				locale: 'en',
				status: 'pending',
				runAfter: new Date(Date.now() + 3_600_000)
			});

			await queue.sweepIndexBackfills();

			const deadline = Date.now() + 30_000;
			let final: UniverseIndexBackfillRow;
			for (;;) {
				const [row] = await queue.recentBackfills(world.id);
				if (row && row.status === 'failed') {
					final = row;
					break;
				}
				if (Date.now() > deadline) {
					throw new Error(
						`the backfill never gave up (status ${row?.status}, attempts ${row?.attemptCount})`
					);
				}
				await delay(25);
			}

			expect(final.attemptCount, 'gave up at the cap, not before or after it').toBe(2);
			expect(final.entitiesMissing).toBe(1);
			expect(final.finishedAt).not.toBeNull();
			// The record a human reads, since there is no admin surface for this (#709, #761).
			expect(final.lastError).toMatch(
				/gave up after 2 pass\(es\) that reduced nothing: 1 entity\/entities still have no index point/
			);

			// And it stays given up, which is the whole point: the polling stops. Several verify
			// delays (100ms here) pass without the attempts moving or the status changing back.
			await delay(800);
			const [after] = await queue.recentBackfills(world.id);
			expect(after?.status, 'a dead-lettered backfill is not reclaimed').toBe('failed');
			expect(after?.attemptCount, 'and it stops counting').toBe(2);
		} finally {
			await queue.stop();
			await dropCollection(vector, collectionName).catch(() => undefined);
		}
	}, 45_000);

	// The two halves of "what counts as progress", driven against the store directly. These
	// deliberately do not call `claimNextIndexBackfill`: it claims the oldest *due* row in the
	// whole table, so in this file's shared database it would claim whatever backfill another
	// test just enqueued. Bumping the attempt count on a row this test created is the same
	// write the claim makes, scoped to a row it owns, which is the rule this repo learned from
	// #658, #682, #691 and #737.
	async function backfillRowFor(worldId: string) {
		const [row] = await db
			.insert(universeIndexBackfill)
			.values({ universeId: worldId, reason: 'no-embedding-model' })
			.returning();
		if (!row) throw new Error('backfill insert returned no row');
		return row;
	}

	function bumpAttempt(id: string) {
		// Exactly what claiming the row does to it.
		return db
			.update(universeIndexBackfill)
			.set({ attemptCount: sql`${universeIndexBackfill.attemptCount} + 1` })
			.where(eq(universeIndexBackfill.id, id));
	}

	function pass(id: string, entitiesMissing: number, capped = false) {
		return resumeIndexBackfill(db, id, {
			entitiesTotal: 10,
			entitiesMissing,
			scheduled: 0,
			nextRunAfterMs: 0,
			capped,
			maxAttempts: 2
		});
	}

	function backfillById(id: string) {
		return db
			.select()
			.from(universeIndexBackfill)
			.where(eq(universeIndexBackfill.id, id))
			.then((rows) => rows[0]);
	}

	it('counts only the passes that reduced nothing, so a slow backfill is never given up on (issue #745)', async () => {
		// The reason the cap is safe to enforce at all. Before #745 the only thing that reset the
		// attempts was a *capped* pass, and a universe under the per-pass cap whose index jobs
		// simply drain more slowly than one verify delay produces no capped pass at all: it would
		// have spent its attempts while perfectly healthy and been dead-lettered mid-catch-up.
		const { world } = await fixture();
		const row = await backfillRowFor(world.id);

		// First pass has nothing to compare against, so it cannot be a pass that reduced nothing.
		await bumpAttempt(row.id);
		expect((await pass(row.id, 5)).deadLettered).toBe(false);
		expect((await backfillById(row.id))?.attemptCount).toBe(0);

		// The shortfall keeps shrinking: points are landing and the queue is draining, so the
		// attempts keep resetting however many passes it takes.
		for (const missing of [4, 3, 2, 1]) {
			await bumpAttempt(row.id);
			expect((await pass(row.id, missing)).deadLettered, `missing ${missing}`).toBe(false);
			const current = await backfillById(row.id);
			expect(current?.attemptCount, `missing ${missing}`).toBe(0);
			expect(current?.status).toBe('pending');
		}

		// A flat count still resets when the pass was capped, because there is different work
		// waiting and the next pass is not a repeat.
		for (let i = 0; i < 4; i++) {
			await bumpAttempt(row.id);
			expect((await pass(row.id, 1, true)).deadLettered).toBe(false);
			expect((await backfillById(row.id))?.attemptCount).toBe(0);
		}
	}, 45_000);

	it('gives up once the attempts are spent on passes that reduced nothing (issue #745)', async () => {
		const { world } = await fixture();
		const row = await backfillRowFor(world.id);

		// Establish a shortfall to compare against.
		await bumpAttempt(row.id);
		await pass(row.id, 3);
		expect((await backfillById(row.id))?.attemptCount).toBe(0);

		// Two passes that reduce nothing. The first is under the cap and resumes.
		await bumpAttempt(row.id);
		expect((await pass(row.id, 3)).deadLettered).toBe(false);
		const midway = await backfillById(row.id);
		expect(midway?.attemptCount, 'the attempts are kept rather than reset').toBe(1);
		expect(midway?.status).toBe('pending');

		// The second reaches `maxAttempts`, and this is where the promise in the comment is now
		// actually kept.
		await bumpAttempt(row.id);
		const gaveUp = await pass(row.id, 3);
		expect(gaveUp.deadLettered).toBe(true);
		expect(gaveUp.attemptCount).toBe(2);

		const failed = await backfillById(row.id);
		expect(failed?.status).toBe('failed');
		expect(failed?.finishedAt).not.toBeNull();
		expect(failed?.leaseHolder).toBeNull();
		expect(failed?.lastError).toMatch(/gave up after 2 pass\(es\) that reduced nothing: 3 entity/);
		// Terminal releases the partial unique index, so a genuinely new skip can enqueue a fresh
		// backfill later. Nothing retries this one, which is #761.
		expect(failed?.entitiesMissing).toBe(3);
	}, 45_000);
});
