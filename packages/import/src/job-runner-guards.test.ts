/**
 * Issue #479 end to end: the real reproduction's proposal set, through the real engine.
 *
 * **What is replayed and what is real.** The four notes are `/tmp/r17-vault.zip`'s own
 * files, byte for byte (`artefact_sha256`
 * 5943416d7a3c9e34881a3ebe2417e1607722da8644b0df6b60da80dcc3240b0c matched the vault on
 * disk). The entities seeded here are the two the reproduction's universe carried that the
 * import collided with, with their real bodies. Every `entity_propose` scripted below is a
 * recorded payload from job `955b60ba-4c53-4987-ba27-c5aea892c0ac` in `canonry_r17_demo`,
 * read out of `proposal.patch` and `proposal.evidence`. The playbook is the real
 * `obsidian` one, the driver is the real `GatewayDriver`, and `materializeDocumentProposals`
 * is untouched by this file.
 *
 * **The one substitution, and why it is faithful rather than convenient.** The scorer is a
 * lookup table of the numbers the recorded run actually produced: 0.7746 and 0.7634 for the
 * two Ashen Ledger pairs, straight out of `proposal.evidence.similarity`, and 0.5446 for the
 * Cairnmouth pair, measured afterwards by embedding both sides' `matchTextFor` text with
 * `alibaba/qwen3-embedding-4b`, the `embedding` row that job ran with. A live gateway call
 * would cost money and be non-deterministic, and it would test the model rather than the
 * engine. Pinning the scorer's answers is what makes this a test of the decision the engine
 * takes *given* those answers, which is where the defect was.
 *
 * **Why the numbers matter.** 0.5446 sits under `EMBEDDING_MATCH_THRESHOLDS.newBelow`
 * (0.60), so the scorer answered `new` for a case-identical name, and the in-between band
 * that SPEC.md §6.4 says must be asked about was never reached. The candidate pool was not
 * at fault: the seeded Cairnmouth is a `place`, the proposal is a `place`, and the pool held
 * four rows against a pre-filter limit of 20, so it was scored and rejected.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { closeDb, eq, type Db } from '@canonry/db';
import {
	entity,
	operationPrice,
	proposal as proposalTable,
	universe,
	user
} from '@canonry/db/schema';
import { openTestDb } from './test-db.js';
import {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector
} from './gateway-driver.js';
import { loadBuiltinPlaybook } from './playbook.js';
import { InMemorySourceReader } from './sources.js';
import { InMemoryImageStore } from './images.js';
import { admitAndCreateImportJob, ImportJobRunner } from './job-runner.js';
import { EMBEDDING_MATCH_THRESHOLDS, normalizeForMatching } from './matching.js';
import type { SimilarityFn } from './matching.js';
import type { Embedder } from '@canonry/copilot';

// This file drops and creates nothing. `test-global-setup.ts` has already dropped,
// recreated and migrated the one database `TEST_DATABASE_URL` names, and a second dropper
// inside a test file is the collision AGENTS.md describes: CI sets `TEST_DATABASE_URL` to a
// single deterministic name, so every file in the run collapses onto it, and dropping it
// mid-run terminates the other files' backends. Locally that hides, because an unset
// `TEST_DATABASE_URL` gives each file its own suffixed name; in CI it showed up as
// `42P01 relation "operation_price" does not exist` in a file that had nothing to do with
// this one. Every fixture below is scoped to a universe of its own, so a shared database is
// all it needs.

const stubEmbedRelationLabel: Embedder = async (texts) => texts.map(() => [0, 0, 0]);
const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;
const TEST_PARAMS = { pricePerInputMTok: 1, pricePerOutputMTok: 2, creditsPerEur: 100 };

// ---------------------------------------------------------------------------------------
// The vault, byte for byte.
// ---------------------------------------------------------------------------------------

const VAULT: Record<string, string> = {
	'Valdoria Vault/Characters/Harrow Blackfen.md': `---
tags: [character, npc]
aliases: [The Fen Warden]
---

# Harrow Blackfen

Warden of the marsh road east of [[Cairnmouth]]. He took the post the winter after the thaw and has not been relieved since.

He keeps a tally of everyone who crosses, and sells it to [[The Ashen Ledger]] when the tally is worth more than the toll.
`,
	'Valdoria Vault/Factions/The Toll Company.md': `---
tags: [faction]
---

# The Toll Company

A chartered company that collects on [[The Marsh Road]]. It answers to nobody in Valdoria and pays a tithe to [[The Ashen Ledger]].
`,
	'Valdoria Vault/Places/The Marsh Road.md': `---
tags: [place]
---

# The Marsh Road

The only land route between [[Cairnmouth]] and the inland farms. Three days in summer, impassable for six weeks after the first freeze.

[[Harrow Blackfen]] wardens it.
`,
	'Valdoria Vault/Sessions/Session 4.md': `---
tags: [session]
date: 2026-03-11
---

# Session 4

The party walked the marsh road and met [[Harrow Blackfen]], who wanted a name before he wanted a toll.

They learned that [[The Toll Company]] has been selling crossings twice.
`
};

const DOCUMENTS = [
	{ id: 'doc-1', sourcePath: 'Valdoria Vault/Characters/Harrow Blackfen.md' },
	{ id: 'doc-2', sourcePath: 'Valdoria Vault/Factions/The Toll Company.md' },
	{ id: 'doc-3', sourcePath: 'Valdoria Vault/Places/The Marsh Road.md' },
	{ id: 'doc-4', sourcePath: 'Valdoria Vault/Sessions/Session 4.md' }
];

/** The two seeded Valdoria Reach entries the import collided with, with the bodies
 * `canonry_r17_demo` actually holds. Left as the reproduction ran them: #566 has since
 * reworded the `:::secret` line in `seed-fixture.ts` ("on its payroll" to "on the Ashen
 * Ledger's payroll"), and no guard here reads that sentence - `bodyWriteVerdict` reads
 * that a `:::secret` fence exists at all, and the retention ratio. */
const SEEDED = [
	{
		type: 'place' as const,
		name: 'Cairnmouth',
		slug: 'cairnmouth',
		body: 'A fishing town two days up the coast. A third of it starved in [[The Sable Winter]] when [[The Sable Reach]] froze, and the harbour has never carried the same traffic since.'
	},
	{
		type: 'faction' as const,
		name: 'The Ashen Ledger',
		slug: 'the-ashen-ledger',
		body: `A merchant bank that lends at knife point and keeps better records than the magistrate.

:::secret
Aldric Vane, the dismissed captain of the Valdoria Watch, is now on its payroll.
:::

:::gmnote
Iselde Wrenn appointed Aldric, then broke him. Play this reveal as her fault circling back, not his.
:::`
	}
];

// ---------------------------------------------------------------------------------------
// The recorded extraction, one scripted `entity_propose` per payload the job emitted.
// ---------------------------------------------------------------------------------------

interface Proposed {
	localId: string;
	type: string;
	name: string;
	aliases: string[];
	summary: string;
	documentId: string;
	span: { start: number; end: number };
}

const RECORDED: Proposed[] = [
	{
		localId: 'e1',
		type: 'character',
		name: 'Harrow Blackfen',
		aliases: ['The Fen Warden'],
		summary:
			'Warden of the marsh road east of Cairnmouth. He took the post the winter after the thaw and has not been relieved since. He keeps a tally of everyone who crosses, and sells it to The Ashen Ledger.',
		documentId: 'doc-1',
		span: { start: 0, end: 72 }
	},
	// #479's first and third defects in one payload: a create for an entry that exists, a
	// body that is a sentence about the import, and another entry's name as an alias.
	{
		localId: 'e2',
		type: 'place',
		name: 'Cairnmouth',
		aliases: ['The Marsh Road'],
		summary: 'A place mentioned in relation to the marsh road.',
		documentId: 'doc-1',
		span: { start: 95, end: 112 }
	},
	// #479's second defect, second of the two as ranked.
	{
		localId: 'e3',
		type: 'faction',
		name: 'The Ashen Ledger',
		aliases: [],
		summary: 'An organization to which Harrow Blackfen sells tally records.',
		documentId: 'doc-1',
		span: { start: 200, end: 260 }
	},
	{
		localId: 'e4',
		type: 'faction',
		name: 'The Toll Company',
		aliases: [],
		summary:
			'A chartered company that collects on The Marsh Road. It answers to nobody in Valdoria and pays a tithe to The Ashen Ledger.',
		documentId: 'doc-2',
		span: { start: 2, end: 18 }
	},
	// #479's second defect, first of the two as ranked.
	{
		localId: 'e5',
		type: 'faction',
		name: 'The Ashen Ledger',
		aliases: [],
		summary:
			'A faction to which The Toll Company pays a tithe. Harrow Blackfen sells his tallies to them.',
		documentId: 'doc-2',
		span: { start: 60, end: 130 }
	},
	{
		localId: 'e6',
		type: 'place',
		name: 'The Marsh Road',
		aliases: [],
		summary:
			'The only land route between Cairnmouth and the inland farms. Impassable for six weeks after the first freeze.',
		documentId: 'doc-3',
		span: { start: 0, end: 15 }
	},
	{
		localId: 'e7',
		type: 'session',
		name: 'Session 4',
		aliases: [],
		summary:
			'The fourth session of the campaign. The party travels the marsh road and encounters Harrow Blackfen.',
		documentId: 'doc-4',
		span: { start: 0, end: 11 }
	}
];

/** The similarity the recorded job produced, keyed by the pair being compared. Anything
 * not listed scored low enough to be a decisive `new`, which is what every other pair in
 * that run did. */
const RECORDED_SIMILARITY: Record<string, number> = {
	// proposal.evidence.similarity on the two update rows.
	'the ashen ledger|the ashen ledger': 0.7746,
	// Measured on alibaba/qwen3-embedding-4b over both sides' matchTextFor text.
	'cairnmouth|cairnmouth': 0.5446,
	'the marsh road|cairnmouth': 0.5446
};

const recordedSimilarity: SimilarityFn = (subject, candidate) =>
	RECORDED_SIMILARITY[
		`${normalizeForMatching(subject.name)}|${normalizeForMatching(candidate.name)}`
	] ?? 0.1;

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

function toolCallStep(calls: Array<{ id: string; name: string; input: unknown }>) {
	return {
		content: calls.map((call) => ({
			type: 'tool-call' as const,
			toolCallId: call.id,
			toolName: call.name,
			input: JSON.stringify(call.input)
		})),
		finishReason: { unified: 'tool-calls' as const, raw: undefined },
		usage: usage(10, 5),
		warnings: []
	};
}

/** The recorded run's step stream: per document, one `source_read`, one `entity_propose`
 * per payload it emitted, then `job_finish`. Relations are left out on purpose - #479 is
 * about the entity proposals, and `relation_propose` would add rows that say nothing about
 * the three defects. */
function recordedSteps() {
	return DOCUMENTS.flatMap((doc) => [
		toolCallStep([{ id: `read-${doc.id}`, name: 'source_read', input: { path: doc.sourcePath } }]),
		...RECORDED.filter((payload) => payload.documentId === doc.id).map((payload) =>
			toolCallStep([
				{
					id: `propose-${payload.localId}`,
					name: 'entity_propose',
					input: {
						localId: payload.localId,
						type: payload.type,
						name: payload.name,
						aliases: payload.aliases,
						summary: payload.summary,
						sourceRef: { documentId: doc.id },
						evidenceSpan: payload.span,
						images: []
					}
				}
			])
		),
		toolCallStep([
			{ id: `finish-${doc.id}`, name: 'job_finish', input: { outcome: 'completed', summary: '' } }
		])
	]);
}

function fixedModelSelector(languageModel: LanguageModel): ModelSelector {
	const resolved: ImportModel = {
		languageModel,
		provider: 'test',
		modelId: 'test-cheap',
		params: TEST_PARAMS
	};
	return { resolve: async () => resolved };
}

interface ProposalShape {
	kind: string;
	name: string | undefined;
	slug: string | undefined;
	after: string | undefined;
	aliases: string[] | undefined;
	targetName: string | undefined;
}

function field(patch: unknown, key: string): unknown {
	return patch && typeof patch === 'object' && key in patch
		? (patch as Record<string, unknown>)[key]
		: undefined;
}

describe('issue #479: the seven proposals a four note vault produced against Valdoria Reach', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function seedReproduction() {
		await db
			.insert(operationPrice)
			.values({
				operation: 'import.document',
				label: 'Import extraction per document',
				credits: 1,
				kind: 'import'
			})
			.onConflictDoNothing({ target: operationPrice.operation });

		const userId = `r17-${randomUUID().slice(0, 8)}`;
		await db.insert(user).values({
			id: userId,
			name: 'Valdoria GM',
			email: `${userId}@canonry.invalid`,
			emailVerified: true
		});
		const [u] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Valdoria Reach',
				slug: `valdoria-reach-${randomUUID().slice(0, 8)}`,
				kind: 'homebrew'
			})
			.returning();
		if (!u) throw new Error('fixture setup failed');
		await db.insert(entity).values(SEEDED.map((row) => ({ ...row, universeId: u.id })));
		return { userId, universeId: u.id };
	}

	async function runTheReproduction(): Promise<ProposalShape[]> {
		const { userId, universeId } = await seedReproduction();
		const playbook = await loadBuiltinPlaybook('obsidian');
		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: '/tmp/r17-vault.zip',
			artefactBytes: 2048,
			artefactSha256: createHash('sha256').update('r17-vault').digest('hex'),
			documentCount: DOCUMENTS.length,
			budgetCredits: 1000,
			estimate: { documentCount: DOCUMENTS.length, estimatedMinutes: 2, estimatedCredits: 40 },
			concurrencyLimit: 5
		});
		expect(admission.admitted).toBe(true);

		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(
				new MockLanguageModelV4({
					provider: 'test',
					modelId: 'test-cheap',
					doGenerate: recordedSteps()
				})
			)
		});

		const result = await new ImportJobRunner().run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: DOCUMENTS,
			sources: new InMemorySourceReader({ files: VAULT }),
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: recordedSimilarity,
			thresholds: EMBEDDING_MATCH_THRESHOLDS,
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 60_000
		});
		expect(result.finalStatus).toBe('finished');

		const rows = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		const names = new Map(
			(await db.select().from(entity).where(eq(entity.universeId, universeId))).map((row) => [
				row.id,
				row.name
			])
		);
		return rows
			.map((row) => ({
				kind: row.kind as string,
				name: field(row.patch, 'name') as string | undefined,
				slug: field(row.patch, 'slug') as string | undefined,
				after: field(row.patch, 'after') as string | undefined,
				aliases: field(row.patch, 'aliases') as string[] | undefined,
				targetName: row.targetEntityId ? names.get(row.targetEntityId) : undefined
			}))
			.sort((a, b) => `${a.kind}${a.name}`.localeCompare(`${b.kind}${b.name}`));
	}

	it('never proposes a create for a name the universe already carries', async () => {
		const proposals = await runTheReproduction();
		// The defect: `kind = create`, `name = "Cairnmouth"`, `slug = "cairnmouth"`, in a
		// universe holding an entry called Cairnmouth with that exact slug. Accepting it
		// either fails `entity_universe_slug_key` or gives the GM two Cairnmouths.
		expect(proposals.filter((p) => p.kind === 'create' && p.slug === 'cairnmouth')).toHaveLength(0);
		expect(proposals.some((p) => p.kind === 'create' && p.name === 'Cairnmouth')).toBe(false);
	});

	it('never proposes an update whose after would replace The Ashen Ledger with one sentence', async () => {
		const proposals = await runTheReproduction();
		const bodyWrites = proposals.filter(
			(p) => p.targetName === 'The Ashen Ledger' && p.after !== undefined
		);
		expect(bodyWrites).toEqual([]);
		// Both of them offered nothing else, so neither survives as a proposal at all: an
		// update repeating the entity's own name is a decision that costs the GM attention
		// and changes nothing (SPEC.md §6.4's "field edited by the user, unchanged at the
		// source: leave it alone").
		expect(proposals.filter((p) => p.targetName === 'The Ashen Ledger')).toEqual([]);
	});

	it("never writes another entry's name into an entity's aliases", async () => {
		const proposals = await runTheReproduction();
		for (const p of proposals) {
			expect(p.aliases ?? []).not.toContain('The Marsh Road');
		}
	});

	it('proposes nothing at all for a name the vault only mentioned', async () => {
		const proposals = await runTheReproduction();
		// The vault never describes Cairnmouth: it appears as a `[[Cairnmouth]]` link inside
		// two other notes. The model wrote "A place mentioned in relation to the marsh road",
		// which is a sentence about the import. Guardrail 3 wants the evidence for a
		// proposal, and there is none, so there is no proposal - of either kind.
		expect(
			proposals.filter((p) => p.name === 'Cairnmouth' || p.targetName === 'Cairnmouth')
		).toEqual([]);
	});

	it('keeps every proposal the vault does support, so the guards are not just a mute button', async () => {
		const proposals = await runTheReproduction();
		const creates = proposals.filter((p) => p.kind === 'create').map((p) => p.name);
		expect(creates.sort()).toEqual([
			'Harrow Blackfen',
			'Session 4',
			'The Marsh Road',
			'The Toll Company'
		]);
		// And each one still carries its body, since none of them collides or shrinks
		// anything: the guards refuse writes, they never soften a good one.
		const harrow = proposals.find((p) => p.name === 'Harrow Blackfen');
		expect(harrow?.aliases).toEqual(['The Fen Warden']);
	});
});
