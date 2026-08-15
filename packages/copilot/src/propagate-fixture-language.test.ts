/**
 * The invariant SPEC.md §17 rule three exists for, against the real bilingual fixture
 * (issue #122's `la-casa-dei-mercanti` and `smugglers-ledger`, mirrored exactly from
 * `packages/db/src/seed-fixture.ts` - not a synthetic body, on purpose: this is the case
 * `packages/copilot/src/zz-scratch.test.ts` was left probing and never turned into an
 * assertion). `smugglers-ledger`'s body is genuinely mixed English/Italian, so
 * `detectLanguage` refuses to pick a winner and its `entity.language` column is null - the
 * honest "unknown", never a guess.
 *
 * When a save to `la-casa-dei-mercanti` (a real, substantial Italian body - the fixture's
 * own comment: `detectLanguage` -> 'it') propagates into `smugglers-ledger`, `@canonry/lang`'s
 * `canonLanguageFor` chain has nothing on the target to go on (null recorded language, an
 * undetectable mixed body) and falls back to the *triggering* entry's language - Italian -
 * never to the reader's interface locale. That reader's locale is set to English here,
 * deliberately the opposite of the correct answer, so a regression to "draft in the
 * interface language" (the exact vandalism SPEC.md §17 rule three forbids) fails loudly
 * instead of silently agreeing with a coincidental match.
 *
 * `la-casa-dei-mercanti` and `smugglers-ledger` are never given a direct relation here -
 * both are only ever related to `valdoria` in the real fixture (`packages/db/src/seed-fixture.ts`),
 * exactly as `zz-scratch.test.ts` found: `buildCandidatePool`'s graph search treats relations
 * as undirected for reachability (`candidates.ts`), so `smugglers-ledger` surfaces as a
 * genuine 2-hop neighbour of `la-casa-dei-mercanti` through `valdoria`, the same path
 * production traverses.
 */
import { closeDb, type Db } from '@canonry/db';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { generatePlanDiffs, planPropagation } from './propagate.js';
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

// Mirrored exactly from packages/db/src/seed-fixture.ts (issue #122) - the fixture's own
// Italian entry. Long and genuine enough that `detectLanguage` calls it 'it' on its own
// merits, not because the test says so.
const LA_CASA_BODY =
	'La Casa dei Mercanti tiene i suoi registri nel Quartiere della Lanterna, non lontano dal porto di [[Valdoria]]. Nessuno entra senza un debito da saldare o una lettera di credito da mostrare, e il vecchio Contabile non dimentica mai un nome.\n\n' +
	'## Il libro nero\n\n' +
	"Ogni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa. [[The Ashen Ledger]] la considera una concorrente, mai un'alleata, e i loro uomini non bevono mai allo stesso tavolo.";

// Mirrored exactly from packages/db/src/seed-fixture.ts (issue #122) - deliberately mixed
// English and Italian sentences, so `detectLanguage` refuses to pick a winner and the row's
// own `entity.language` stays null, the honest "unknown" rather than a guess.
const SMUGGLERS_LEDGER_BODY =
	'A ledger nobody at the table has read yet, kept by whoever is running goods through the Lantern Quarter that week. The handwriting changes hands more than the goods do, and nobody has ever admitted to owning it.\n\n' +
	'Il carico di questa settimana non è passato dal molo, ma dalla porta sul retro della locanda, dove nessuno guarda mai due volte. Chi scrive non firma mai con il proprio nome, e questo non è un caso.\n\n' +
	'Half the entries are crossed out, and the other half do not match what actually left the harbour that night. Whoever kept it after [[Aldric Vane]] stopped writing has a different hand entirely, but the same habit of saying less than they know.';

/** Scripted cheap model: echoes back a rationale for every candidate id it was actually
 * offered (read out of the prompt) - exercises the real deterministic candidate search in
 * candidates.ts rather than a hand-picked answer, matching propagate.test.ts's own
 * convention. */
function dynamicRankingModel(): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: async (options) => {
			const promptText = JSON.stringify(options.prompt);
			const ids = Array.from(new Set(Array.from(promptText.matchAll(UUID_RE)).map((m) => m[0])));
			const object = {
				summary: `This change touches ${ids.length} entries.`,
				candidates: ids.map((id) => ({ entityId: id, rationale: 'Because it is nearby.' }))
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

function modelFactoryFor(cheap: LanguageModel, premium: LanguageModel): ModelFactory {
	return (resolved: ResolvedModel) => (resolved.purpose === 'cheap' ? cheap : premium);
}

describe('propagation against the real bilingual fixture (issue #128, SPEC.md §17 rule three)', () => {
	let db: Db;

	beforeAll(async () => {
		db = openTestDb();
		await insertModelConfig(db, 'cheap');
		await insertModelConfig(db, 'premium');
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it("drafts into smugglers-ledger (language null, mixed body) in the Italian triggering entry's language, never in the reader's English interface locale", async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });

		// Only relation each fixture entity actually carries in packages/db/src/seed-fixture.ts:
		// both are "located in" valdoria, never each other. smugglers-ledger is therefore a
		// genuine 2-hop graph neighbour of la-casa-dei-mercanti, not a fabricated direct link.
		const rt = await insertRelationType(db, universe.id, {
			label: 'located in',
			inverseLabel: 'hosts'
		});
		const valdoria = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Valdoria',
			body: 'A free port of six quarters.'
		});
		const laCasa = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'La Casa dei Mercanti',
			aliases: ['The Merchant House'],
			body: LA_CASA_BODY
		});
		const smugglersLedger = await insertEntity(db, universe.id, {
			type: 'item',
			name: "The Smugglers' Ledger",
			body: SMUGGLERS_LEDGER_BODY
			// language deliberately left unset (null): the fixture's own honest "mixed, unknown".
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: laCasa.id,
			toEntityId: valdoria.id
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: smugglersLedger.id,
			toEntityId: valdoria.id
		});

		// The reader's interface locale, deliberately the opposite of the trigger's Italian -
		// a regression to "draft in the interface language" would read 'en' here and fail loudly.
		const readerLocale = 'en';

		const newBody =
			LA_CASA_BODY +
			"\n\nDa quest'inverno, la Casa ha iniziato a comprare i debiti che nessun altro riesce più a riscuotere.";

		const plan = await planPropagation({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityId: laCasa.id,
			editedEntityName: laCasa.name,
			oldBody: LA_CASA_BODY,
			newBody,
			locale: readerLocale,
			modelFactory: modelFactoryFor(dynamicRankingModel(), dynamicRankingModel()),
			gateway: IDENTITY_GATEWAY
		});

		expect(plan).not.toBeNull();
		const smugglersProposal = plan!.proposals.find((p) => p.targetEntityId === smugglersLedger.id);
		expect(smugglersProposal).toBeDefined();
		expect(smugglersProposal?.locale).toBe(readerLocale);

		let diffSystem = '';
		const draftedBody = SMUGGLERS_LEDGER_BODY + ' Qualcosa è cambiato.';
		const diffModel = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-premium',
			doGenerate: async (options) => {
				diffSystem = systemPromptOf(options);
				const object = { summary: 'Nota un nuovo prestito.', after: draftedBody };
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
			editedEntityId: laCasa.id,
			editedEntityName: laCasa.name,
			diff: plan!.diff,
			locale: readerLocale,
			modelFactory: modelFactoryFor(dynamicRankingModel(), diffModel),
			gateway: IDENTITY_GATEWAY
		});

		const smugglersWritten = diffed.written.find((p) => p.id === smugglersProposal!.id);
		expect(smugglersWritten).toBeDefined();
		expect(smugglersWritten?.patch).toMatchObject({ after: draftedBody });

		// The reader's own locale still governs the rationale/summary...
		expect(diffSystem).toContain('locale "en"');
		// ...but the drafted body's content language is the Italian trigger's, the fallback
		// canonLanguageFor takes when the target's own language and body are both unknown -
		// and it is asserted absent, not merely present, so a regression that silently reused
		// the reader's locale for both spans fails loudly rather than passing by coincidence.
		expect(diffSystem).toContain('content language "it"');
		expect(diffSystem).not.toContain('content language "en"');
	});
});
