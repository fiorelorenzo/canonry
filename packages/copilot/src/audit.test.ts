/**
 * Integration tests for audit (issue #55, SPEC.md §5.2) against the real database with a
 * fake model - the fixture's own contradiction from docs/ux/c9-audit-flags.html (Aldric
 * Vane against Cairnmouth, "who led the watch through the second freeze") drives the main
 * case, so this exercises the exact scenario the UX artifact and the acceptance criteria
 * both name.
 */
import { closeDb, eq, priceOf, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import { AiDisabledError } from './propagate.js';
import {
	buildFlagRationale,
	findCandidatePairs,
	isGuardrailSafeTopic,
	runAudit,
	AUDIT_PAIR_CAP
} from './audit.js';
import type { CandidateGraph, GraphEntity } from './candidates.js';
import type { FactChange } from './diff.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
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

/** Scripted judgment model: returns the same verdict for every pair examined, so a test
 * can assert on exactly what the harness (not the model) decided to examine. */
function judgmentModel(verdicts: Array<{ disagree: boolean; topic: string }>): LanguageModel {
	let call = 0;
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: async () => {
			const verdict = verdicts[call] ?? verdicts[verdicts.length - 1]!;
			call += 1;
			return {
				content: [{ type: 'text', text: JSON.stringify(verdict) }],
				finishReason: { unified: 'stop', raw: undefined },
				usage: usage(60, 20),
				warnings: []
			};
		}
	}) as unknown as LanguageModel;
}

/** Like `judgmentModel`, but hands the real call `options` to `capture` first - for
 * asserting on "the prompt actually sent" (SPEC.md §17, issue #123) rather than only on
 * the verdict that comes back. */
function capturingJudgmentModel(
	verdict: { disagree: boolean; topic: string },
	capture: (options: { prompt: Array<{ role: string; content: unknown }> }) => void
): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: async (options) => {
			capture(options);
			return {
				content: [{ type: 'text', text: JSON.stringify(verdict) }],
				finishReason: { unified: 'stop', raw: undefined },
				usage: usage(60, 20),
				warnings: []
			};
		}
	}) as unknown as LanguageModel;
}

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

function modelFactoryFor(cheap: LanguageModel): ModelFactory {
	return (_resolved: ResolvedModel) => cheap;
}

describe('runAudit (issue #55, SPEC.md §5.2)', () => {
	let db: Db;

	beforeAll(async () => {
		db = openTestDb();
		// One active model_config row for 'cheap', shared with whichever other file in this
		// same test run (propagate.test.ts, currently) claims it first: the unique index is
		// on (purpose) where active, and `vitest run` shares one database across every file
		// in the run, so two files racing to insert the same purpose is expected, not a bug
		// in either file - the loser's insert failing here is fine, since it only needed
		// *some* active 'cheap' row to exist, not to be the one that created it.
		try {
			await insertModelConfig(db, 'cheap');
		} catch {
			// Another file's beforeAll already provided one; nothing left to do.
		}
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture() {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });

		const aldricBody =
			'Dismissed from the watch in the thaw after the Sable Winter, he now answers to ' +
			'the Ashen Ledger.';
		const aldric = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			aliases: ['Captain Vane', 'the broken captain'],
			body: aldricBody
		});

		const cairnmouthOldBody =
			'A fishing town two days up the coast. A third of it starved in the Sable Winter ' +
			'when the Sable Reach froze, and the rest remember exactly who did not come.';
		const cairnmouth = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: cairnmouthOldBody
		});

		return { owner, universe, aldric, cairnmouth, cairnmouthOldBody };
	}

	it('flags the fixture contradiction: Cairnmouth naming Aldric Vane against his own entry', async () => {
		const { owner, universe, aldric, cairnmouth, cairnmouthOldBody } = await fixture();
		const newBody =
			`${cairnmouthOldBody} Captain Vane led the watch through the second freeze, ` +
			'the winter after the thaw.';

		const model = judgmentModel([
			{ disagree: true, topic: 'who led the watch through the second freeze' }
		]);

		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: cairnmouth.id,
			oldBody: cairnmouthOldBody,
			newBody,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.examined).toBe(1);
		expect(result.flags).toHaveLength(1);
		const flag = result.flags[0]!;
		expect(flag.proposal.trigger).toBe('audit');
		expect(flag.proposal.kind).toBe('flag');
		expect(flag.proposal.outcome).toBe('pending');
		expect(flag.proposal.patch).toEqual({});
		expect([flag.proposal.targetEntityId, flag.proposal.relatedEntityId].sort()).toEqual(
			[aldric.id, cairnmouth.id].sort()
		);
		expect(flag.proposal.rationale).toBe(
			'Cairnmouth and Aldric Vane do not agree on who led the watch through the second freeze.'
		);

		const [statementA, statementB] = flag.statements;
		const names = [statementA.entityId, statementB.entityId].sort();
		expect(names).toEqual([aldric.id, cairnmouth.id].sort());
		// Guardrail 3: the flag carries the two statements verbatim, with real spans into
		// their own entity's current body.
		for (const statement of flag.statements) {
			const body = statement.entityId === aldric.id ? aldric.body : newBody;
			expect(body.slice(statement.spanStart, statement.spanEnd)).toBe(statement.statement);
		}

		const calls = await db.select().from(modelCall).where(eq(modelCall.operation, 'audit.flag'));
		const matching = calls.filter((c) => c.userId === owner.id);
		expect(matching).toHaveLength(1);
		expect(matching[0]?.agent).toBe('loremaster');
	});

	it('charges the examined pair even when the model finds no disagreement, and writes no flag', async () => {
		const { owner, universe, cairnmouth, cairnmouthOldBody } = await fixture();
		const newBody = `${cairnmouthOldBody} Captain Vane still drinks at the Gilded Rat some nights.`;

		const model = judgmentModel([{ disagree: false, topic: '' }]);

		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: cairnmouth.id,
			oldBody: cairnmouthOldBody,
			newBody,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.examined).toBe(1);
		expect(result.flags).toEqual([]);
		expect(result.plan).toBeNull();

		const calls = await db.select().from(modelCall).where(eq(modelCall.operation, 'audit.flag'));
		expect(calls.filter((c) => c.userId === owner.id)).toHaveLength(1);
	});

	it('examines nothing and spends nothing when the edit names no other entity in the universe', async () => {
		const { owner, universe, cairnmouth, cairnmouthOldBody } = await fixture();
		const newBody = `${cairnmouthOldBody} The harbour smells of salt and tar most mornings.`;

		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: cairnmouth.id,
			oldBody: cairnmouthOldBody,
			newBody,
			locale: 'en',
			modelFactory: modelFactoryFor(judgmentModel([{ disagree: true, topic: 'x' }])),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.examined).toBe(0);
		expect(result.flags).toEqual([]);
		expect(result.plan).toBeNull();
	});

	it('returns nothing for a whitespace-only save with no semantic change', async () => {
		const { owner, universe, cairnmouth, cairnmouthOldBody } = await fixture();

		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: cairnmouth.id,
			oldBody: cairnmouthOldBody,
			newBody: `${cairnmouthOldBody}   `,
			locale: 'en',
			modelFactory: modelFactoryFor(judgmentModel([{ disagree: true, topic: 'x' }])),
			gateway: IDENTITY_GATEWAY
		});

		expect(result).toEqual({ examined: 0, available: null, plan: null, flags: [] });
	});

	it('refuses to run when the universe has generation switched off (guardrail 4)', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id, aiEnabled: false });
		const entity = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: 'A fishing town.'
		});

		await expect(
			runAudit({
				db,
				userId: owner.id,
				universeId: universe.id,
				editedEntityId: entity.id,
				oldBody: 'A fishing town.',
				newBody: 'A fishing town, rebuilt after the fire.',
				locale: 'en',
				modelFactory: modelFactoryFor(judgmentModel([{ disagree: true, topic: 'x' }])),
				gateway: IDENTITY_GATEWAY
			})
		).rejects.toBeInstanceOf(AiDisabledError);
	});

	it('SPEC.md §17 rule two (issue #123): the prompt states the locale explicitly, and an Italian locale produces an Italian flag rationale from English statements', async () => {
		const { owner, universe, aldric, cairnmouth, cairnmouthOldBody } = await fixture();
		const newBody =
			`${cairnmouthOldBody} Captain Vane led the watch through the second freeze, ` +
			'the winter after the thaw.';

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const model = capturingJudgmentModel(
			{ disagree: true, topic: 'chi guidava la ronda durante il secondo gelo' },
			(options) => {
				captured = options;
			}
		);

		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: cairnmouth.id,
			oldBody: cairnmouthOldBody,
			newBody,
			locale: 'it',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain('Italiano');
		expect(system).toContain('locale "it"');
		expect(system).toContain('never translate a proper noun');
		expect(system).toContain('never translate a quoted sentence');

		expect(result.flags).toHaveLength(1);
		const flag = result.flags[0]!;
		expect(flag.proposal.rationale).toBe(
			"Cairnmouth e Aldric Vane non sono d'accordo su chi guidava la ronda durante il secondo gelo."
		);
		// Guardrail 3: the quoted statements themselves stay in English, byte-identical to
		// their source entity's body - only the rationale beside them is in Italian.
		for (const statement of flag.statements) {
			const body = statement.entityId === aldric.id ? aldric.body : newBody;
			expect(body.slice(statement.spanStart, statement.spanEnd)).toBe(statement.statement);
		}

		expect(result.plan?.summary).toBe(
			"Cairnmouth e Aldric Vane non sono d'accordo su chi guidava la ronda durante il secondo gelo."
		);
	});

	it('survives a body whose paragraph spans several lines, and still spans it correctly', async () => {
		// `splitIntoSentences` joins a paragraph's lines with a single space, so a sentence it
		// produces from a wrapped paragraph appears nowhere in the body verbatim. `spanOf`
		// used to throw on that ("is not in its own source body"), which took the whole audit
		// down. The two bodies below are the ordinary shapes that hit it: a `:::secret` block,
		// which the sample world itself uses, and prose wrapped at a column.
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });

		const ledgerBody =
			'A merchant bank that lends at knife point.\n\n:::secret\nAldric Vane, the dismissed ' +
			'captain of the Valdoria Watch,\nis now on its payroll.\n:::';
		await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: ledgerBody
		});

		const aldricOldBody = 'Captain of the Valdoria Watch.';
		const aldric = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			body: aldricOldBody
		});

		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: aldric.id,
			oldBody: aldricOldBody,
			newBody:
				'Dismissed from the watch in the thaw, he now answers to\nThe Ashen Ledger and no ' +
				'longer commands anyone.',
			locale: 'en',
			modelFactory: modelFactoryFor(
				judgmentModel([{ disagree: true, topic: 'whether he still commands the watch' }])
			),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.examined).toBe(1);
		expect(result.flags).toHaveLength(1);

		// The span is the point: a flag whose evidence cannot be found in the body would be a
		// guardrail-3 failure, so the recorded offsets have to select the real text.
		const evidence = result.flags[0]!.proposal.evidence as Array<{
			entityName: string;
			spanStart: number;
			spanEnd: number;
		}>;
		const ledgerSide = evidence.find((e) => e.entityName === 'The Ashen Ledger');
		expect(ledgerSide).toBeDefined();
		const quoted = ledgerBody.slice(ledgerSide!.spanStart, ledgerSide!.spanEnd);
		expect(quoted).toContain('Aldric Vane');
		expect(quoted).toContain('payroll');
		// #556: the same defect for the *other* place this file calls `splitIntoSentences`
		// directly on a fenced body - a quoted sentence must never carry the fence's own
		// marker syntax, even though (audit is GM-only) the secret's content is fine to
		// surface.
		expect(quoted).not.toContain(':::');
	});

	it('#556: a sentence right after a closing :::secret marker is quoted on its own, never joined to the fence', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });

		// No blank line before `:::secret` or after the closing `:::`: unfenced
		// `splitIntoSentences` joins both marker lines into whichever sentence sits next to
		// them. The secret's own content never names Aldric, so the mention search's first
		// hit is exactly the sentence right after the closing fence - the shape #556 reports
		// for `mostSimilarSentence` and for this file's other direct `splitIntoSentences`
		// call, `findCandidatePairs`'s reverse pass.
		const ledgerBody =
			'A merchant bank that lends at knife point.\n' +
			':::secret\n' +
			'Its ledgers show three unmarked accounts.\n' +
			':::\n' +
			'Captain Vane commands the night watch still.';
		await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: ledgerBody
		});

		const aldricOldBody = 'Captain of the Valdoria Watch.';
		const aldric = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Aldric Vane',
			aliases: ['Captain Vane'],
			body: aldricOldBody
		});

		const newBody = 'Dismissed from the watch, he no longer commands anyone.';

		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: aldric.id,
			oldBody: aldricOldBody,
			newBody,
			locale: 'en',
			modelFactory: modelFactoryFor(
				judgmentModel([{ disagree: true, topic: 'whether he still commands the watch' }])
			),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.flags).toHaveLength(1);
		const [statementA, statementB] = result.flags[0]!.statements;
		const ledgerSide = statementA.entityId === aldric.id ? statementB : statementA;

		// The point of #556: the evidence is the real sentence after the fence, quoted
		// verbatim and alone - no `:::secret`/`:::` marker joined onto it, and the recorded
		// span selects exactly that sentence in the source body.
		expect(ledgerSide.statement).toBe('Captain Vane commands the night watch still.');
		expect(ledgerSide.statement).not.toContain(':::');
		expect(ledgerBody.slice(ledgerSide.spanStart, ledgerSide.spanEnd)).toBe(ledgerSide.statement);
	});
});

describe('buildFlagRationale and isGuardrailSafeTopic (guardrail 7)', () => {
	it('builds the exact framing docs/ux/c9-audit-flags.html locks in', () => {
		expect(
			buildFlagRationale(
				'Aldric Vane',
				'Cairnmouth',
				'who led the watch through the second freeze',
				'en'
			)
		).toBe(
			'Aldric Vane and Cairnmouth do not agree on who led the watch through the second freeze.'
		);
	});

	it('never lets a forbidden phrase reach the rationale, even if the model produces one', () => {
		expect(isGuardrailSafeTopic('92% likely inconsistent')).toBe(false);
		expect(isGuardrailSafeTopic('this is a contradiction detected here')).toBe(false);
		expect(isGuardrailSafeTopic('your canon is consistent')).toBe(false);
		expect(isGuardrailSafeTopic('no conflicts found')).toBe(false);
		expect(isGuardrailSafeTopic('who led the watch through the second freeze')).toBe(true);

		expect(buildFlagRationale('A', 'B', '92% likely inconsistent', 'en')).toBe(
			'A and B do not agree.'
		);
		expect(buildFlagRationale('A', 'B', 'fix this automatically', 'en')).toBe(
			'A and B do not agree.'
		);
	});
});

describe('findCandidatePairs uncapped, and the pair census (issue #278)', () => {
	let db: Db;

	beforeAll(async () => {
		db = openTestDb();
		try {
			await insertModelConfig(db, 'cheap');
		} catch {
			// Another describe or file in this run already provided the active 'cheap' row.
		}
	});

	afterAll(async () => {
		await closeDb(db);
	});

	/** Six entities that all name the one being edited, so the shipped cap of five has
	 * something to turn away. Every body is real prose rather than filler, because
	 * `mostSimilarSentence` has to find a topically similar sentence on the other side or
	 * the pair is dropped before any cap applies. */
	function crowdedGraph(): CandidateGraph {
		const edited: GraphEntity = {
			id: 'watch',
			type: 'faction',
			name: 'The Valdoria Watch',
			aliases: [],
			body: 'The Valdoria Watch keeps the harbour and answers to the magistrate.',
			language: 'en'
		};
		const others: GraphEntity[] = Array.from({ length: 6 }, (_, i) => ({
			id: `witness-${i}`,
			type: 'character',
			name: `Witness ${i}`,
			aliases: [],
			body: `Witness ${i} says The Valdoria Watch has kept the harbour badly since the thaw.`,
			language: 'en'
		}));
		return { entities: [edited, ...others], relations: [] };
	}

	it('returns everything the search found when the cap is removed, and exactly the cap when it is not', () => {
		const graph = crowdedGraph();
		const edited = graph.entities[0]!;
		const diff: FactChange[] = [
			{
				kind: 'added',
				statement: 'The Valdoria Watch keeps the harbour and answers to the magistrate.'
			}
		];

		const capped = findCandidatePairs(graph, edited, edited.body, diff, AUDIT_PAIR_CAP);
		const uncapped = findCandidatePairs(graph, edited, edited.body, diff, Number.POSITIVE_INFINITY);

		expect(capped).toHaveLength(AUDIT_PAIR_CAP);
		expect(uncapped.length).toBe(6);
		// The cap only truncates: what it keeps is a prefix of what the search offered, so a
		// census can never change which pairs a real run examines.
		expect(capped.map((p) => p.b.entityId)).toEqual(
			uncapped.slice(0, AUDIT_PAIR_CAP).map((p) => p.b.entityId)
		);
	});

	it('leaves `available` null unless the census env var is set, and never changes what is examined', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const watch = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Valdoria Watch',
			body: 'The Valdoria Watch keeps the harbour.'
		});
		for (let i = 0; i < 6; i++) {
			await insertEntity(db, universe.id, {
				type: 'character',
				name: `Witness ${i}`,
				body: `Witness ${i} says The Valdoria Watch has kept the harbour badly since the thaw.`
			});
		}

		const oldBody = 'The Valdoria Watch keeps the harbour.';
		const newBody = 'The Valdoria Watch keeps the harbour and answers to nobody at all.';
		const run = () =>
			runAudit({
				db,
				userId: owner.id,
				universeId: universe.id,
				editedEntityId: watch.id,
				oldBody,
				newBody,
				locale: 'en',
				modelFactory: modelFactoryFor(judgmentModel([{ disagree: false, topic: '' }])),
				gateway: IDENTITY_GATEWAY
			});

		const off = await run();
		expect(off.available).toBeNull();
		expect(off.examined).toBe(AUDIT_PAIR_CAP);

		process.env.CANONRY_AUDIT_PAIR_CENSUS = '1';
		try {
			const on = await run();
			expect(on.examined).toBe(off.examined);
			expect(on.available).toBe(6);
		} finally {
			delete process.env.CANONRY_AUDIT_PAIR_CENSUS;
		}
	});

	it('#508: the plan carries what its flags are worth, and every flag carries its own credits', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const watch = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Valdoria Watch',
			body: 'The Valdoria Watch keeps the harbour.'
		});
		for (let i = 0; i < 6; i++) {
			await insertEntity(db, universe.id, {
				type: 'character',
				name: `Witness ${i}`,
				body: `Witness ${i} says The Valdoria Watch has kept the harbour badly since the thaw.`
			});
		}

		// Only the first pair examined disagrees, so this run charges for every pair it looked
		// at (`model_call`, one row each) and writes exactly one flag.
		const result = await runAudit({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: watch.id,
			oldBody: 'The Valdoria Watch keeps the harbour.',
			newBody: 'The Valdoria Watch keeps the harbour and answers to nobody at all.',
			locale: 'en',
			modelFactory: modelFactoryFor(
				judgmentModel([
					{ disagree: true, topic: 'who the watch answers to' },
					{ disagree: false, topic: '' }
				])
			),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.examined).toBe(AUDIT_PAIR_CAP);
		expect(result.flags).toHaveLength(1);

		const flagPrice = (await priceOf(db, 'audit.flag')).credits;
		// `estimated_credits` is what the plan's open candidates are worth, so one flag's
		// price - never the five examined pairs it used to record, which made this column a
		// spend figure while every other trigger treats it as a per-candidate one. The run's
		// real cost stays in `model_call`, asserted below.
		expect(result.plan?.estimatedCredits).toBe(flagPrice);
		// And the flag's own row figure means something now: it used to be 0 for every audit
		// flag ever written, which is #489's complaint one trigger over.
		expect(result.flags[0]!.proposal.credits).toBe(flagPrice);

		const charged = await db.select().from(modelCall).where(eq(modelCall.universeId, universe.id));
		expect(charged).toHaveLength(AUDIT_PAIR_CAP);
	});
});
