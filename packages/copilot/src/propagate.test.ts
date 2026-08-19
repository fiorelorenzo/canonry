/**
 * End-to-end integration tests for the propagation pipeline (issues #47-52, #56), against
 * the real database with fake models - the acceptance criteria this package exists to
 * satisfy: a save produces a capped plan with reasons, dropping an entry reduces the
 * estimate, generating diffs charges the premium model, accepting writes exactly one
 * revision and is idempotent, and the AI switch stops all of it.
 */
import { closeDb, eq, type Db } from '@canonry/db';
import { entity, modelCall } from '@canonry/db/schema';
import {
	acceptProposal,
	dropCandidateFromPlan,
	listProposalsForPlan,
	rejectProposal
} from '@canonry/db';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { AiDisabledError, DEFAULT_CAP, generatePlanDiffs, planPropagation } from './propagate.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
	insertRelation,
	insertRelationType,
	insertUser,
	systemPromptOf
} from './test-helpers.js';
import { openTestDb } from './test-db.js';

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

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** Scripted cheap model: echoes back a rationale for every candidate id it was actually
 * offered (read out of the prompt), so this test exercises the real deterministic capping
 * in candidates.ts/reject-signal.ts rather than a hand-picked answer. */
function dynamicRankingModel(): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: async (options) => {
			const promptText = JSON.stringify(options.prompt);
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

/** Scripted premium model: always drafts the same recognisable replacement body, so a
 * test can assert on it directly without depending on the prompt. */
function fixedDiffModel(afterText: string): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-premium',
		doGenerate: {
			content: [
				{ type: 'text', text: JSON.stringify({ summary: 'Drafted update.', after: afterText }) }
			],
			finishReason: { unified: 'stop', raw: undefined },
			usage: usage(300, 200),
			warnings: []
		}
	}) as unknown as LanguageModel;
}

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

function modelFactoryFor(cheap: LanguageModel, premium: LanguageModel): ModelFactory {
	return (resolved: ResolvedModel) => (resolved.purpose === 'cheap' ? cheap : premium);
}

describe('propagation pipeline against the real database', () => {
	let db: Db;

	beforeAll(async () => {
		db = openTestDb();
		// One active model_config row per purpose for the whole file - the unique index is
		// on (purpose) where active, so a second insert per test would collide with itself.
		await insertModelConfig(db, 'cheap');
		await insertModelConfig(db, 'premium');
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function baseUniverse() {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		return { owner, universe };
	}

	/** Inserts `count` character entities, each related to `edited` via `rt`, so a test
	 * can build a candidate pool bigger than whatever cap it is checking against. */
	async function insertNeighbours(
		universeId: string,
		edited: { id: string },
		rt: { id: string },
		count: number
	): Promise<void> {
		for (let i = 0; i < count; i++) {
			const neighbour = await insertEntity(db, universeId, {
				type: 'character',
				name: `Contact ${i}`,
				body: 'An unremarkable local.'
			});
			await insertRelation(db, universeId, {
				relationTypeId: rt.id,
				fromEntityId: edited.id,
				toEntityId: neighbour.id
			});
		}
	}

	it('a universe-set cap truncates the plan to exactly that number', async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'Dismissed from the watch, he now works in the harbour district.'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'knows',
			inverseLabel: 'known by'
		});
		// Twelve direct neighbours - more than the cap under test - so the plan has to
		// actually cut candidates, not merely happen to fit under it.
		await insertNeighbours(universe.id, edited, rt, 12);

		const result = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: edited.body,
			newBody: `${edited.body} Word of it reached the harbourmaster within the hour.`,
			locale: 'en',
			cap: 10,
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});

		expect(result).not.toBeNull();
		expect(result!.plan.candidateCap).toBe(10);
		expect(result!.proposals).toHaveLength(10);
		expect(result!.plan.summary.length).toBeGreaterThan(0);
		for (const proposal of result!.proposals) {
			expect(proposal.rationale.length).toBeGreaterThan(0);
			expect(proposal.outcome).toBe('pending');
			expect(proposal.kind).toBe('update');
		}
	});

	it('the cap defaults to DEFAULT_CAP when the caller reads no universe setting', async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Branwen Solt',
			body: 'A harbour clerk with too many friends.'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'knows',
			inverseLabel: 'known by'
		});
		// More neighbours than DEFAULT_CAP, so the default actually has to cut
		// candidates rather than happen to fit under it.
		await insertNeighbours(universe.id, edited, rt, DEFAULT_CAP + 2);

		const result = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: edited.body,
			newBody: `${edited.body} Word reached the docks by evening.`,
			locale: 'en',
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});

		expect(result).not.toBeNull();
		expect(result!.plan.candidateCap).toBe(DEFAULT_CAP);
		expect(result!.proposals).toHaveLength(DEFAULT_CAP);
	});

	it('cap: null produces every ranked candidate, with no truncation', async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Old Hettie',
			body: 'Runs the harbour tavern.'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'knows',
			inverseLabel: 'known by'
		});
		// More neighbours than DEFAULT_CAP would allow through - "no limit" is only
		// proven if every one of them survives, since fewer surviving would look the
		// same as a real numeric cap that happened not to bind.
		const count = DEFAULT_CAP + 5;
		await insertNeighbours(universe.id, edited, rt, count);

		const result = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: edited.body,
			newBody: `${edited.body} A round on the house tonight.`,
			locale: 'en',
			cap: null,
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});

		expect(result).not.toBeNull();
		expect(result!.plan.candidateCap).toBeNull();
		expect(result!.proposals).toHaveLength(count);
	});

	it('dropping an entry from the plan reduces the estimate', async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: 'A merchant bank.'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'employs',
			inverseLabel: 'employed by'
		});
		const employee = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'x'
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: edited.id,
			toEntityId: employee.id
		});

		const result = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: edited.body,
			newBody: `${edited.body} It just doubled its collections staff.`,
			locale: 'en',
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});
		expect(result!.proposals).toHaveLength(1);
		const before = result!.plan.estimatedCredits;

		const dropped = await dropCandidateFromPlan(db, result!.proposals[0]!.id);

		expect(dropped.plan.estimatedCredits).toBeLessThan(before);
	});

	it('generating diffs charges the premium model, records usage, and marks the plan spent', async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: 'A merchant bank.'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'employs',
			inverseLabel: 'employed by'
		});
		const employee = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'A dismissed watch captain.'
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: edited.id,
			toEntityId: employee.id
		});

		const plan = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: edited.body,
			newBody: `${edited.body} It just doubled its collections staff.`,
			locale: 'en',
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});

		const draftedBody = 'A dismissed watch captain, recently hired by the Ashen Ledger.';
		const diffed = await generatePlanDiffs({
			db,
			userId: owner.id,
			universeId: universe.id,
			planId: plan!.plan.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			diff: plan!.diff,
			locale: 'en',
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel(draftedBody)),
			gateway: IDENTITY_GATEWAY
		});

		expect(diffed.written).toHaveLength(1);
		expect(diffed.written[0]?.patch).toMatchObject({ after: draftedBody });
		expect(diffed.written[0]?.credits).toBeGreaterThan(0);
		expect(diffed.plan.status).toBe('spent');

		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, 'propagate.diff'));
		const matching = calls.filter((c) => c.userId === owner.id);
		expect(matching).toHaveLength(1);
		expect(matching[0]?.agent).toBe('propagate');
		expect(matching[0]?.inputTokens).toBe(300);
	});

	it('runs the full loop: plan, diff, accept one, reject one - the entity body actually changes on accept', async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'Dismissed from the watch.'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'knows',
			inverseLabel: 'known by'
		});
		const keep = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Iselde Wrenn',
			body: 'x'
		});
		const drop = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: 'y'
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: edited.id,
			toEntityId: keep.id
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: edited.id,
			toEntityId: drop.id
		});

		const plan = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: edited.body,
			newBody: `${edited.body} Word reached the harbourmaster.`,
			locale: 'en',
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});
		expect(plan!.proposals).toHaveLength(2);

		const draftedBody = "x, now aware of Aldric Vane's dismissal.";
		await generatePlanDiffs({
			db,
			userId: owner.id,
			universeId: universe.id,
			planId: plan!.plan.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			diff: plan!.diff,
			locale: 'en',
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel(draftedBody)),
			gateway: IDENTITY_GATEWAY
		});

		const proposals = await listProposalsForPlan(db, plan!.plan.id);
		const keepProposal = proposals.find((p) => p.targetEntityId === keep.id)!;
		const dropProposal = proposals.find((p) => p.targetEntityId === drop.id)!;

		const accepted = await acceptProposal(db, { proposalId: keepProposal.id });
		expect(accepted.outcome).toBe('accepted');
		const [updatedEntity] = await db.select().from(entity).where(eq(entity.id, keep.id));
		expect(updatedEntity?.body).toBe(draftedBody);

		const rejected = await rejectProposal(db, { proposalId: dropProposal.id, reason: 'wrong' });
		expect(rejected.outcome).toBe('rejected');
		expect(rejected.rejectReason).toBe('wrong');
		const [untouchedEntity] = await db.select().from(entity).where(eq(entity.id, drop.id));
		expect(untouchedEntity?.body).toBe('y');
	});

	it('refuses to plan when the universe has generation switched off (guardrail 4)', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id, aiEnabled: false });
		const edited = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'x'
		});

		await expect(
			planPropagation({
				db,
				userId: owner.id,
				universeId: universe.id,
				editedEntityId: edited.id,
				editedEntityName: edited.name,
				oldBody: 'x',
				newBody: 'x changed',
				locale: 'en',
				modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
				gateway: IDENTITY_GATEWAY
			})
		).rejects.toBeInstanceOf(AiDisabledError);
	});

	it('returns null and charges nothing for a whitespace-only save with no semantic change', async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'x.'
		});

		const result = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: 'x.',
			newBody: 'x.  ',
			locale: 'en',
			modelFactory: modelFactoryFor(dynamicRankingModel(), fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});

		expect(result).toBeNull();
	});

	it("SPEC.md §17 rules two and three (issues #123/#124): an Italian locale produces an Italian plan rationale and diff summary, while the drafted body stays in the target entry's own English", async () => {
		const { owner, universe } = await baseUniverse();
		const edited = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: 'A merchant bank.'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'employs',
			inverseLabel: 'employed by'
		});
		const employee = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: 'A dismissed watch captain.'
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: edited.id,
			toEntityId: employee.id
		});

		let planSystem = '';
		const rankingModel = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-cheap',
			doGenerate: async (options) => {
				planSystem = systemPromptOf(options);
				const promptText = JSON.stringify(options.prompt);
				const ids = Array.from(new Set(Array.from(promptText.matchAll(UUID_RE)).map((m) => m[0])));
				const object = {
					summary: 'Questo cambiamento tocca una voce.',
					candidates: ids.map((id) => ({ entityId: id, rationale: 'Perché lo impiegano ora.' }))
				};
				return {
					content: [{ type: 'text', text: JSON.stringify(object) }],
					finishReason: { unified: 'stop', raw: undefined },
					usage: usage(80, 40),
					warnings: []
				};
			}
		}) as unknown as LanguageModel;

		const plan = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			oldBody: edited.body,
			newBody: `${edited.body} It just doubled its collections staff.`,
			locale: 'it',
			modelFactory: modelFactoryFor(rankingModel, fixedDiffModel('unused')),
			gateway: IDENTITY_GATEWAY
		});

		expect(planSystem).toContain('Italiano');
		expect(planSystem).toContain('locale "it"');
		expect(planSystem).toContain('never translate a proper noun');
		expect(plan!.plan.summary).toBe('Questo cambiamento tocca una voce.');
		expect(plan!.proposals[0]?.rationale).toBe('Perché lo impiegano ora.');
		expect(plan!.proposals[0]?.locale).toBe('it');

		let diffSystem = '';
		const draftedBody = 'A dismissed watch captain, recently hired by the Ashen Ledger.';
		const diffModel = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-premium',
			doGenerate: async (options) => {
				diffSystem = systemPromptOf(options);
				const object = { summary: 'Annota che ora lo impiega.', after: draftedBody };
				return {
					content: [{ type: 'text', text: JSON.stringify(object) }],
					finishReason: { unified: 'stop', raw: undefined },
					usage: usage(300, 200),
					warnings: []
				};
			}
		}) as unknown as LanguageModel;

		const diffed = await generatePlanDiffs({
			db,
			userId: owner.id,
			universeId: universe.id,
			planId: plan!.plan.id,
			editedEntityId: edited.id,
			editedEntityName: edited.name,
			diff: plan!.diff,
			locale: 'it',
			modelFactory: modelFactoryFor(dynamicRankingModel(), diffModel),
			gateway: IDENTITY_GATEWAY
		});

		// Neither entity has a recorded or detectable language (both bodies are under the
		// detector's MIN_WORDS floor) - canonLanguageFor's chain bottoms out at English,
		// deliberately never at the Italian reader's locale.
		expect(diffSystem).toContain('locale "it"');
		expect(diffSystem).toContain('content language "en"');
		expect(diffed.written[0]?.patch).toMatchObject({
			summary: 'Annota che ora lo impiega.',
			after: draftedBody
		});
	});
});
