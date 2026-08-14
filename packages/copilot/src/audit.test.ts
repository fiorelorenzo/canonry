/**
 * Integration tests for audit (issue #55, SPEC.md §5.2) against the real database with a
 * fake model - the fixture's own contradiction from docs/ux/c9-audit-flags.html (Aldric
 * Vane against Cairnmouth, "who led the watch through the second freeze") drives the main
 * case, so this exercises the exact scenario the UX artifact and the acceptance criteria
 * both name.
 */
import { closeDb, eq, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import { AiDisabledError } from './propagate.js';
import { buildFlagRationale, isGuardrailSafeTopic, runAudit } from './audit.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
	insertUser
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
			modelFactory: modelFactoryFor(judgmentModel([{ disagree: true, topic: 'x' }])),
			gateway: IDENTITY_GATEWAY
		});

		expect(result).toEqual({ examined: 0, plan: null, flags: [] });
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
				modelFactory: modelFactoryFor(judgmentModel([{ disagree: true, topic: 'x' }])),
				gateway: IDENTITY_GATEWAY
			})
		).rejects.toBeInstanceOf(AiDisabledError);
	});
});

describe('buildFlagRationale and isGuardrailSafeTopic (guardrail 7)', () => {
	it('builds the exact framing docs/ux/c9-audit-flags.html locks in', () => {
		expect(
			buildFlagRationale('Aldric Vane', 'Cairnmouth', 'who led the watch through the second freeze')
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

		expect(buildFlagRationale('A', 'B', '92% likely inconsistent')).toBe('A and B do not agree.');
		expect(buildFlagRationale('A', 'B', 'fix this automatically')).toBe('A and B do not agree.');
	});
});
