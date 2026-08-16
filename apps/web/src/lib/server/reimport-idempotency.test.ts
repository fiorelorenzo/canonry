/**
 * Issue #161, SPEC.md §6.4: "importing the same export twice produces zero changes on
 * the second run... It goes in CI, with a fixture export per source." That acceptance
 * test never existed. Running it by hand against `packages/bench`'s rendered corpus
 * found two of seven sources broke it - obsidian and world-anvil - because of the
 * duplicate-create bug issue #160 fixed (`packages/import/src/job-runner.ts`'s
 * `materializeDocumentProposals`, merged as #175, folding a repeat entity sighting into
 * the job's own still-pending create rather than proposing a second one).
 *
 * This is the CI version of that same check: no live gateway (CI carries no
 * AI_GATEWAY_* credentials and should not), so it drives `DeterministicExtractionDriver`
 * - the same fake driver onboarding already runs on a box with none - instead of
 * `GatewayDriver`.
 *
 * Why this file lives in apps/web rather than packages/import: `DeterministicExtractionDriver`
 * lives in `./onboarding.ts`, and AGENTS.md's own rule on `packages/import` is the reverse
 * direction ("nothing outside this package knows which driver runs behind
 * startJob/cancel") - it says nothing about apps/web depending on packages/import, which
 * is the normal, existing direction every route in this app already uses. Moving the
 * driver down into packages/import as a test double was the other option; it was not
 * taken because `DeterministicExtractionDriver` is not a generic test double, it is
 * ~300 lines of onboarding-specific extraction logic (Kanka's relation table, World
 * Anvil's template map, the heading-as-name heuristic) that belongs with the feature
 * that owns its correctness, not duplicated into a package that cannot see it.
 *
 * Fixtures: the small, hand-made per-source exports already checked in at
 * `packages/import/test/fixtures/` (used here, not `packages/bench`'s rendered corpus,
 * which needs pandoc and a real Chrome to build via `pnpm --filter @canonry/bench
 * corpus` and has no place shelling out to either in CI). What that choice costs: these
 * fixtures are one to four documents each, and every document in a given source names a
 * distinct entity, so none of them actually exercises the specific shape #160 fixed (an
 * entity named by more than one document in the same job). They do exercise the two
 * other second-run vectors §6.4 has to hold across (an exact per-document content-hash
 * match on skip, and every document's own extraction round-tripping through a real
 * accept), and pdf/docx additionally exercise the real archive reader's PDF/DOCX text
 * extraction, not a stand-in. onenote is excluded: issue #161's own table records it
 * importing zero documents against any driver, which is a detection/enumeration
 * question, not a re-import one.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	acceptRelationTypeProposal,
	and,
	closeDb,
	createDb,
	eq,
	rejectProposal,
	type Db
} from '@canonry/db';
import {
	entity,
	operationPrice,
	proposal,
	proposalPlan,
	relationType,
	universe,
	user
} from '@canonry/db/schema';
import {
	acceptAnyImportProposal,
	admitAndCreateImportJob,
	ArchiveSourceReader,
	estimateImportJob,
	ImportJobRunner,
	InMemoryImageStore,
	InMemorySourceReader,
	loadBuiltinPlaybook,
	type SourceReader
} from '@canonry/import';
import { hashingEmbedder } from '@canonry/indexing';
import {
	DeterministicExtractionDriver,
	documentsForPlaybook,
	importMatchSimilarity,
	MATCH_THRESHOLDS,
	type KnownPlaybookId
} from './onboarding.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

const FIXTURE_ROOT = fileURLToPath(
	new URL('../../../../../packages/import/test/fixtures/', import.meta.url)
);

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

// Mirrors packages/import/src/playbooks/fixture-source.ts's own test-only loader (not
// imported from there: that module is private to packages/import's own test tree, and
// this file cannot reach past @canonry/import's public surface, which is the same
// boundary production code observes). Walks a fixture directory into the InMemorySourceReader
// every playbook test in that package already drives GatewayDriver with.
const TEXT_EXTENSIONS: Record<string, true> = {
	'.md': true,
	'.json': true,
	'.html': true,
	'.htm': true,
	'.txt': true
};
const BINARY_MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg'
};

async function loadDirectoryFixture(rootDir: string): Promise<InMemorySourceReader> {
	const files: Record<string, string> = {};
	const binaries: Record<string, { mimeType: string; base64: string }> = {};

	async function walk(dir: string, prefix: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const absolute = `${dir}/${entry.name}`;
			const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				await walk(absolute, relative);
				continue;
			}
			const dot = entry.name.lastIndexOf('.');
			const ext = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
			if (TEXT_EXTENSIONS[ext]) {
				files[relative] = await readFile(absolute, 'utf8');
			} else {
				const mimeType = BINARY_MIME_TYPES[ext];
				if (!mimeType)
					throw new Error(`fixture file "${relative}" has an unhandled extension: ${ext}`);
				binaries[relative] = { mimeType, base64: (await readFile(absolute)).toString('base64') };
			}
		}
	}

	await walk(rootDir, '');
	return new InMemorySourceReader({ files, binaries });
}

async function loadArchiveFixture(entryName: string, absolutePath: string): Promise<SourceReader> {
	const bytes = await readFile(absolutePath);
	return ArchiveSourceReader.open(zipSync({ [entryName]: new Uint8Array(bytes) }));
}

interface FixtureSource {
	source: KnownPlaybookId;
	buildReader: () => Promise<SourceReader>;
}

const FIXTURE_SOURCES: FixtureSource[] = [
	{
		source: 'obsidian',
		buildReader: () => loadDirectoryFixture(`${FIXTURE_ROOT}obsidian/vault`)
	},
	{ source: 'kanka', buildReader: () => loadDirectoryFixture(`${FIXTURE_ROOT}kanka/export`) },
	{
		source: 'world-anvil',
		buildReader: () => loadDirectoryFixture(`${FIXTURE_ROOT}world-anvil/export`)
	},
	{ source: 'generic', buildReader: () => loadDirectoryFixture(`${FIXTURE_ROOT}generic/export`) },
	{
		source: 'pdf',
		buildReader: () => loadArchiveFixture('handout.pdf', `${FIXTURE_ROOT}pdf/handout.pdf`)
	},
	{
		source: 'docx',
		buildReader: () => loadArchiveFixture('notes.docx', `${FIXTURE_ROOT}docx/notes.docx`)
	}
];

async function countProposals(db: Db, jobId: string): Promise<number> {
	const rows = await db
		.select({ id: proposal.id })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(eq(proposalPlan.importJobId, jobId));
	return rows.length;
}

/** Accepts every pending proposal a job produced - `entity_source_ref` is only written
 * on accept, and that row is what the second run's exact-path match reads, exactly like
 * packages/bench/src/e2e/import.ts's own acceptAll. Failures are collected rather than
 * thrown so one bad accept does not hide what the rest of the sweep did.
 *
 * Issue #190: dispatches by kind (acceptAnyImportProposal), and loops rather than
 * taking one pass over the set fetched at the start - accepting a relation-type
 * vocabulary proposal can itself create new pending 'relation' proposals (the
 * relations that were waiting on it), and "accept everything this job produced" has
 * to mean everything, including what accepting produces, or this sweep would leave
 * exactly the newly-unblocked relations pending and defeat the second run's own
 * idempotency check for no reason a caller could see. A row that fails once is never
 * retried - it already reported its failure - so the loop still terminates on a
 * genuine, persistent refusal. */
async function acceptAll(
	db: Db,
	jobId: string,
	userId: string,
	sourceSystem: string
): Promise<{ accepted: number; failures: Array<{ kind: string; error: string }> }> {
	let accepted = 0;
	const failures: Array<{ kind: string; error: string }> = [];
	const alreadyFailed = new Set<string>();

	for (let round = 0; round < 10; round++) {
		const rows = await db
			.select({ id: proposal.id, kind: proposal.kind, evidence: proposal.evidence })
			.from(proposal)
			.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
			.where(and(eq(proposalPlan.importJobId, jobId), eq(proposal.outcome, 'pending')));
		const pending = rows.filter((row) => !alreadyFailed.has(row.id));
		if (pending.length === 0) break;

		for (const row of pending) {
			const evidence = row.evidence as { sourceRef?: { path?: unknown }; contentHash?: unknown };
			const externalId =
				typeof evidence?.sourceRef?.path === 'string' ? evidence.sourceRef.path : null;
			const contentHash = typeof evidence?.contentHash === 'string' ? evidence.contentHash : '';
			try {
				await acceptAnyImportProposal(db, row.kind, {
					proposalId: row.id,
					decidedBy: userId,
					sourceSystem,
					externalId,
					sourceUrl: null,
					contentHash,
					importJobId: jobId
				});
				accepted++;
			} catch (error) {
				failures.push({
					kind: row.kind,
					error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
				});
				alreadyFailed.add(row.id);
			}
		}
	}
	return { accepted, failures };
}

describe('re-import idempotency, per source (issue #161, SPEC.md §6.4)', () => {
	let db: Db;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 4 });
		// materializeDocumentProposals charges chargeFor(db, 'import.document') once
		// documentsToRun is non-empty - without a priced row that call throws instead of
		// the job ever reaching a proposal.
		await db
			.insert(operationPrice)
			.values({
				operation: 'import.document',
				label: 'Import extraction per document',
				credits: 1,
				kind: 'import'
			})
			.onConflictDoNothing({ target: operationPrice.operation });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	for (const { source, buildReader } of FIXTURE_SOURCES) {
		it(`${source}: importing the same export twice produces zero proposals the second time`, async () => {
			const playbook = await loadBuiltinPlaybook(source);
			const reader = await buildReader();
			const documents = await documentsForPlaybook(source, reader);
			expect(documents.length, `${source} fixture enumerated no documents`).toBeGreaterThan(0);

			const userId = unique(`reimport-${source}`);
			await db
				.insert(user)
				.values({ id: userId, name: `Reimport ${source}`, email: `${userId}@canonry.invalid` });
			const [universeRow] = await db
				.insert(universe)
				.values({
					ownerUserId: userId,
					name: `Reimport ${source}`,
					slug: unique(`reimport-${source}`),
					kind: 'homebrew'
				})
				.returning();
			if (!universeRow) throw new Error('universe insert did not return a row');

			async function runOnce(): Promise<string> {
				const estimate = estimateImportJob({
					documentCount: documents.length,
					avgCreditsPerDocument: 1,
					avgSecondsPerDocument: 1
				});
				const admitted = await admitAndCreateImportJob(db, {
					universeId: universeRow.id,
					createdBy: userId,
					sourceType: source,
					playbook: playbook.id,
					playbookVersion: playbook.version,
					artefactPath: `test-fixture://${source}`,
					artefactBytes: 0,
					artefactSha256: '0'.repeat(64),
					documentCount: documents.length,
					budgetCredits: 1000,
					estimate,
					concurrencyLimit: 20
				});
				expect(admitted.admitted, `${source} job was not admitted`).toBe(true);

				const runner = new ImportJobRunner();
				await runner.run({
					db,
					driver: new DeterministicExtractionDriver(),
					dbJobId: admitted.jobId,
					universeId: universeRow.id,
					sourceSystem: source,
					userId,
					playbook,
					documents,
					sources: reader,
					images: new InMemoryImageStore(),
					budget: { maxCredits: 1000 },
					similarity: importMatchSimilarity,
					thresholds: MATCH_THRESHOLDS,
					embedRelationLabel: hashingEmbedder,
					timeoutMs: 60_000
				});
				return admitted.jobId;
			}

			const firstJobId = await runOnce();
			const firstCount = await countProposals(db, firstJobId);
			expect(
				firstCount,
				`${source} fixture produced no proposals on the first import - this test would prove nothing`
			).toBeGreaterThan(0);

			const sweep = await acceptAll(db, firstJobId, userId, source);
			expect(
				sweep.failures,
				`${source}: ${sweep.failures.length} proposal(s) refused on accept: ${JSON.stringify(sweep.failures)}`
			).toEqual([]);

			const secondJobId = await runOnce();
			const secondCount = await countProposals(db, secondJobId);
			expect(
				secondCount,
				`${source}: re-importing the identical export produced ${secondCount} proposal(s) on the second run, not zero`
			).toBe(0);
		});
	}
});

/**
 * None of the six fixtures above happen to exercise issue #160's specific defect: every
 * document in a given source names a distinct entity, and the bug (`materializeDocumentProposals`
 * proposing a second `create` for a name a job had already proposed once, in
 * `packages/import/src/job-runner.ts`, fixed by #175) only fires when two documents in
 * the *same* job name the *same* entity. Confirmed by reverting #175 locally and
 * re-running the suite above: all six still pass unchanged, because none of these small
 * hand-made exports repeats a name across documents - see this PR's description for the
 * exact command.
 *
 * This is the targeted case that does trigger it, run against both states of the code
 * to prove the assertion is not a tautology:
 *
 * - Pre-#175 (`git revert --no-commit aa42f73` locally, then restored, never committed):
 *   the first import proposes two `create`s for "Aldric Voss". Accepting the first
 *   creates the entity; accepting the second throws a raw `entity_universe_slug_key`
 *   violation, caught by `acceptAll` below as one failure - exactly the "187 of 326
 *   proposals refused" the #175 commit message measured, at fixture scale.
 * - On this branch (#175 applied): one `create`, folded from both sightings, zero
 *   accept failures.
 *
 * issue #178: folding stopped the accept-time crash, but the surviving `create`'s own
 * `evidence.sourceRef` only ever points at the *first* document (doc1.md here) - the one
 * doc2.md folded into never became its own entity_source_ref row. The test below now
 * re-imports the same two documents a second time and asserts both are skipped, which
 * fails without #178: doc1.md skips correctly, doc2.md comes back as a fresh `update`
 * proposal every time, exactly the "one proposal, not zero" this issue's own Evidence
 * section measured.
 */
describe('regression: two documents naming the same entity in one job (issue #160, #175, #178)', () => {
	let db: Db;
	let userId: string;
	let universeId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 2 });
		userId = unique('dup-name-user');
		await db.insert(user).values({
			id: userId,
			name: 'Duplicate Name Regression',
			email: `${userId}@canonry.invalid`
		});
		const [row] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Duplicate Name Regression',
				slug: unique('dup-name-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!row) throw new Error('universe insert did not return a row');
		universeId = row.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	it('folds into one create and accepts cleanly, instead of a second create that fails on accept', async () => {
		const playbook = await loadBuiltinPlaybook('obsidian');
		const reader = new InMemorySourceReader({
			files: {
				'doc1.md': '# Aldric Voss\n\nFirst sighting of Aldric.',
				'doc2.md': '# Aldric Voss\n\nSecond sighting of Aldric, worded differently.'
			}
		});
		const documents = await documentsForPlaybook('obsidian', reader);

		async function runOnce() {
			const estimate = estimateImportJob({
				documentCount: documents.length,
				avgCreditsPerDocument: 1,
				avgSecondsPerDocument: 1
			});
			const admitted = await admitAndCreateImportJob(db, {
				universeId,
				createdBy: userId,
				sourceType: 'obsidian',
				playbook: playbook.id,
				playbookVersion: playbook.version,
				artefactPath: 'test-fixture://dup-name',
				artefactBytes: 0,
				artefactSha256: '0'.repeat(64),
				documentCount: documents.length,
				budgetCredits: 1000,
				estimate,
				concurrencyLimit: 20
			});
			expect(admitted.admitted).toBe(true);

			const runner = new ImportJobRunner();
			return runner.run({
				db,
				driver: new DeterministicExtractionDriver(),
				dbJobId: admitted.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents,
				sources: reader,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: importMatchSimilarity,
				thresholds: MATCH_THRESHOLDS,
				embedRelationLabel: hashingEmbedder,
				timeoutMs: 60_000
			});
		}

		const firstRun = await runOnce();

		// The pre-#175 bug: two documents naming "Aldric Voss" produced two `create`
		// proposals, not one folded proposal.
		const firstCount = await countProposals(db, firstRun.jobId);
		expect(firstCount, 'expected one folded create, not one per document').toBe(1);

		// The pre-#175 bug's own observable: accepting the second `create` for the same
		// name raises `entity_universe_slug_key`, caught here as a failure rather than a
		// thrown test error.
		const sweep = await acceptAll(db, firstRun.jobId, userId, 'obsidian');
		expect(
			sweep.failures,
			`accept sweep should be clean; got ${JSON.stringify(sweep.failures)}`
		).toEqual([]);

		// issue #178: doc2.md's sighting folded into doc1.md's create and never got its
		// own entity_source_ref row, so it was never skipped on a later import. Re-running
		// the identical two documents has to skip both, not just doc1.md (the one the
		// surviving proposal's evidence happened to keep pointing at).
		const secondRun = await runOnce();
		expect(
			await countProposals(db, secondRun.jobId),
			"a document folded into another one's pending proposal must still be skipped on re-import"
		).toBe(0);
		expect(
			secondRun.documents.map((d) => ({ documentId: d.documentId, status: d.status }))
		).toEqual([
			{ documentId: 'doc-1', status: 'skipped_unchanged' },
			{ documentId: 'doc-2', status: 'skipped_unchanged' }
		]);
	});
});

/**
 * Issue #178's own harder case: `entity_source_ref` is unique on `(source_system,
 * external_id)`, `external_id` a single document's path - but a document can name more
 * than one entity (a Kanka per-type export like the one below routinely does: one
 * `characters.json` lists several characters) just as one entity can be named by more
 * than one document (the fold above). This fixture drives both at once: `characters-a.json`
 * names two entities (Aldric, Mira), `characters-b.json` repeats one of them (Aldric),
 * folding into `characters-a.json`'s still-pending Aldric create.
 *
 * What makes re-import correct here is `entity_source_ref.content_hash`, not which entity
 * a row happens to point at: accepting Aldric's and Mira's creates in some order both
 * write to the row keyed on `characters-a.json`'s own path, so that row ends up pointing
 * at whichever of the two was accepted last - but `ImportJobRunner.run`'s skip check only
 * ever compares content hashes, never entity ids, so the ambiguity does not defeat the
 * guarantee for either document. See this PR's description for why that narrower
 * limitation (an entity's *identity* on a later *changed* re-import, not the skip itself)
 * was left alone rather than a shape this issue also had to fix.
 */
describe('one document naming two entities, another repeating one of them (issue #178)', () => {
	let db: Db;
	let userId: string;
	let universeId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 2 });
		userId = unique('fold-doc-user');
		await db.insert(user).values({
			id: userId,
			name: 'Fold Document Regression',
			email: `${userId}@canonry.invalid`
		});
		const [row] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Fold Document Regression',
				slug: unique('fold-doc-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!row) throw new Error('universe insert did not return a row');
		universeId = row.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	it('skips both documents on an identical re-import', async () => {
		const playbook = await loadBuiltinPlaybook('kanka');
		const reader = new InMemorySourceReader({
			files: {
				'characters-a.json': JSON.stringify([
					{
						entity_id: '1',
						entity_type: 'character',
						name: 'Aldric Voss',
						entry: 'Commands the harbour watch.'
					},
					{
						entity_id: '2',
						entity_type: 'character',
						name: 'Mira Sable',
						entry: 'Holds a seat on the council.'
					}
				]),
				'characters-b.json': JSON.stringify([
					{
						entity_id: '3',
						entity_type: 'character',
						name: 'Aldric Voss',
						entry: 'Second sighting of Aldric, worded differently.'
					}
				])
			}
		});
		const documents = await documentsForPlaybook('kanka', reader);
		expect(documents.map((d) => d.sourcePath)).toEqual(['characters-a.json', 'characters-b.json']);

		async function runOnce() {
			const estimate = estimateImportJob({
				documentCount: documents.length,
				avgCreditsPerDocument: 1,
				avgSecondsPerDocument: 1
			});
			const admitted = await admitAndCreateImportJob(db, {
				universeId,
				createdBy: userId,
				sourceType: 'kanka',
				playbook: playbook.id,
				playbookVersion: playbook.version,
				artefactPath: 'test-fixture://fold-doc',
				artefactBytes: 0,
				artefactSha256: '0'.repeat(64),
				documentCount: documents.length,
				budgetCredits: 1000,
				estimate,
				concurrencyLimit: 20
			});
			expect(admitted.admitted).toBe(true);

			const runner = new ImportJobRunner();
			return runner.run({
				db,
				driver: new DeterministicExtractionDriver(),
				dbJobId: admitted.jobId,
				universeId,
				sourceSystem: 'kanka',
				userId,
				playbook,
				documents,
				sources: reader,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: importMatchSimilarity,
				thresholds: MATCH_THRESHOLDS,
				embedRelationLabel: hashingEmbedder,
				timeoutMs: 60_000
			});
		}

		const firstRun = await runOnce();
		// characters-a.json proposes Aldric and Mira as two separate creates;
		// characters-b.json's own Aldric sighting folds into characters-a.json's still-
		// pending Aldric create rather than proposing a third.
		expect(
			await countProposals(db, firstRun.jobId),
			'expected two creates - Aldric (folded) and Mira'
		).toBe(2);

		const sweep = await acceptAll(db, firstRun.jobId, userId, 'kanka');
		expect(
			sweep.failures,
			`accept sweep should be clean; got ${JSON.stringify(sweep.failures)}`
		).toEqual([]);

		const secondRun = await runOnce();
		expect(
			await countProposals(db, secondRun.jobId),
			'both documents named an entity this job already recorded an entity_source_ref for - re-importing must skip both, not just the one whose path the surviving proposal happened to keep'
		).toBe(0);
		expect(
			secondRun.documents.map((d) => ({ documentId: d.documentId, status: d.status }))
		).toEqual([
			{ documentId: 'doc-1', status: 'skipped_unchanged' },
			{ documentId: 'doc-2', status: 'skipped_unchanged' }
		]);
	});
});

/**
 * Decision K1, issue #190: the import loop's own half of "relation types are free
 * labels, reconciled" - an unfamiliar relation label never writes a relation_type row
 * by itself any more (`packages/db/src/queries/import.ts`'s deleted
 * `findOrCreateRelationType` did exactly that, with no human in the loop). It becomes
 * a vocabulary proposal instead, one per distinct question per job rather than one per
 * relation, and SPEC 6.4's idempotency guarantee extends to the catalogue: re-running
 * the same import after the question is settled proposes nothing new.
 *
 * The labels under test ("mentors", "confides in") are chosen for the same reason the
 * checked-in kanka fixture's own "leads" and "rival" already exercise this path today
 * (neither is one of the ten shipped labels - `packages/db/migrations/
 * 0001_seed_relation_type_catalogue.sql`, `0029_containment_and_protects_relations.sql`):
 * the network-free `hashingEmbedder` scores each at zero cosine similarity against
 * every shipped label (single, distinct tokens, no shared trigram buckets), so the
 * semantic rung reliably misses and the resolution is deterministically 'new-proposed'
 * rather than depending on a live embedding model's judgement call.
 */
describe('relation-type vocabulary proposals, then idempotency (decision K1, issue #190)', () => {
	let db: Db;
	let userId: string;
	let universeId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 2 });
		userId = unique('relvocab-user');
		await db.insert(user).values({
			id: userId,
			name: 'Relation Vocabulary Regression',
			email: `${userId}@canonry.invalid`
		});
		const [row] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Relation Vocabulary Regression',
				slug: unique('relvocab-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!row) throw new Error('universe insert did not return a row');
		universeId = row.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	async function proposalsForJob(jobId: string) {
		const rows = await db
			.select({ proposal })
			.from(proposal)
			.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
			.where(eq(proposalPlan.importJobId, jobId));
		return rows.map((r) => r.proposal);
	}

	// materializeDocumentProposals drops a relation whose endpoint is a brand-new,
	// not-yet-accepted entity (job-runner.ts's own doc comment) - these two characters
	// have to already exist as real entity rows before the relation between them can
	// be proposed at all, exactly like reimport-idempotency's own self-relation test
	// above pre-inserts `existingEntity` for the same structural reason.
	async function seedCharacter(name: string): Promise<void> {
		await db.insert(entity).values({
			universeId,
			type: 'character',
			name,
			slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`,
			body: `${name} appears in this export.`
		});
	}

	const sameNameSimilarity = (subject: { name: string }, candidate: { name: string }): number =>
		subject.name === candidate.name ? 1 : 0;

	// entity_source_ref is unique on (source_system, external_id) globally, not scoped
	// to a job - reusing the same file paths across the two `it` blocks below (which
	// share one universe) would make the second scenario's own documents collide with
	// entity_source_ref rows the first scenario's accept already wrote for those exact
	// paths. `pathPrefix` keeps every scenario's file paths, and so its
	// entity_source_ref rows, disjoint from every other scenario's.
	function kankaCharacterFixture(
		pathPrefix: string,
		label: string,
		names: [string, string, string, string]
	): Record<string, string> {
		const [ownerA, targetA, ownerB, targetB] = names;
		return {
			[`${pathPrefix}-a.json`]: JSON.stringify([
				{
					entity_id: '1',
					entity_type: 'character',
					name: ownerA,
					entry: `${ownerA} appears in this export.`,
					relations: [{ owner_id: '1', target_id: '2', relation: label, attitude: 50 }]
				},
				{
					entity_id: '2',
					entity_type: 'character',
					name: targetA,
					entry: `${targetA} appears in this export.`
				}
			]),
			[`${pathPrefix}-b.json`]: JSON.stringify([
				{
					entity_id: '3',
					entity_type: 'character',
					name: ownerB,
					entry: `${ownerB} appears in this export.`,
					relations: [{ owner_id: '3', target_id: '4', relation: label, attitude: 60 }]
				},
				{
					entity_id: '4',
					entity_type: 'character',
					name: targetB,
					entry: `${targetB} appears in this export.`
				}
			])
		};
	}

	async function runKankaImport(
		files: Record<string, string>,
		artefactPath: string
	): Promise<string> {
		const playbook = await loadBuiltinPlaybook('kanka');
		const reader = new InMemorySourceReader({ files });
		const documents = await documentsForPlaybook('kanka', reader);
		const estimate = estimateImportJob({
			documentCount: documents.length,
			avgCreditsPerDocument: 1,
			avgSecondsPerDocument: 1
		});
		const admitted = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'kanka',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath,
			artefactBytes: 0,
			artefactSha256: '0'.repeat(64),
			documentCount: documents.length,
			budgetCredits: 1000,
			estimate,
			concurrencyLimit: 20
		});
		expect(admitted.admitted).toBe(true);
		const runner = new ImportJobRunner();
		await runner.run({
			db,
			driver: new DeterministicExtractionDriver(),
			dbJobId: admitted.jobId,
			universeId,
			sourceSystem: 'kanka',
			userId,
			playbook,
			documents,
			sources: reader,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: sameNameSimilarity,
			thresholds: MATCH_THRESHOLDS,
			embedRelationLabel: hashingEmbedder,
			timeoutMs: 60_000
		});
		return admitted.jobId;
	}

	it('two relations sharing an unfamiliar label fold into one vocabulary proposal; accepting it creates exactly one type and unblocks both; re-importing then proposes nothing new', async () => {
		const names: [string, string, string, string] = [
			'Mira Sable',
			'Corvin Ashe',
			'Talia Wren',
			'Bram Ostley'
		];
		for (const name of names) await seedCharacter(name);
		const files = kankaCharacterFixture('accept-characters', 'Mentors', names);

		const firstJobId = await runKankaImport(files, 'test-fixture://relvocab-accept');

		// Nothing under this label exists in the catalogue yet, and the two sightings
		// asked one question, not two.
		const typesBefore = await db
			.select()
			.from(relationType)
			.where(and(eq(relationType.universeId, universeId), eq(relationType.label, 'mentors')));
		expect(typesBefore, 'no relation_type row before any accept').toHaveLength(0);

		let rows = await proposalsForJob(firstJobId);
		const vocabRows = rows.filter((r) => r.kind === 'relation_type_new');
		expect(
			vocabRows,
			'one vocabulary proposal for the shared "mentors" label, not one per relation'
		).toHaveLength(1);
		const vocabProposal = vocabRows[0]!;
		const patchBefore = vocabProposal.patch as { label: string; relations: unknown[] };
		expect(patchBefore.label).toBe('mentors');
		expect(patchBefore.relations, 'both documents folded into the same proposal').toHaveLength(2);
		expect(
			rows.filter((r) => r.kind === 'relation'),
			'both relations are still waiting on the vocabulary question, not independently proposable yet'
		).toHaveLength(0);

		// Accept it: exactly one relation_type row, and the two waiting relations
		// unblock into their own pending 'relation' proposals rather than a direct write.
		const accepted = await acceptRelationTypeProposal(db, {
			proposalId: vocabProposal.id,
			decidedBy: userId
		});
		expect(accepted.unblockedProposalIds).toHaveLength(2);

		const typesAfter = await db
			.select()
			.from(relationType)
			.where(and(eq(relationType.universeId, universeId), eq(relationType.label, 'mentors')));
		expect(typesAfter, 'accepting created exactly one type').toHaveLength(1);

		rows = await proposalsForJob(firstJobId);
		const unblockedRelations = rows.filter((r) => r.kind === 'relation' && r.outcome === 'pending');
		expect(unblockedRelations).toHaveLength(2);
		expect(unblockedRelations.every((r) => r.relationTypeId === typesAfter[0]!.id)).toBe(true);

		// Drain the rest of the job (the two now-unblocked relations, plus the entity
		// updates the same-name match produced) so entity_source_ref exists for every
		// document - the second run's skip check reads that, not the relation
		// vocabulary at all.
		const sweep = await acceptAll(db, firstJobId, userId, 'kanka');
		expect(
			sweep.failures,
			`accept sweep should be clean; got ${JSON.stringify(sweep.failures)}`
		).toEqual([]);

		// SPEC 6.4's idempotency guarantee, extended to the catalogue (issue #190):
		// re-running the identical import after the vocabulary question is settled
		// proposes nothing new - no second vocabulary question and no duplicate relation.
		const secondJobId = await runKankaImport(files, 'test-fixture://relvocab-accept');
		expect(
			await countProposals(db, secondJobId),
			're-importing the identical export after accepting its vocabulary must propose nothing new'
		).toBe(0);
	});

	it('rejecting a new-proposed vocabulary proposal drops the relations that waited on it and leaves the catalogue untouched', async () => {
		const names: [string, string, string, string] = [
			'Elowen Vance',
			'Petra Doyle',
			'Ines Calder',
			'Warrick Fenn'
		];
		for (const name of names) await seedCharacter(name);
		const files = kankaCharacterFixture('reject-characters', 'Confides in', names);
		const jobId = await runKankaImport(files, 'test-fixture://relvocab-reject');

		const rows = await proposalsForJob(jobId);
		const vocabRows = rows.filter((r) => r.kind === 'relation_type_new');
		expect(vocabRows).toHaveLength(1);
		const vocabProposal = vocabRows[0]!;

		const rejected = await rejectProposal(db, {
			proposalId: vocabProposal.id,
			reason: null,
			decidedBy: userId
		});
		expect(rejected.outcome).toBe('rejected');

		const types = await db
			.select()
			.from(relationType)
			.where(and(eq(relationType.universeId, universeId), eq(relationType.label, 'confides in')));
		expect(types, 'rejecting leaves the catalogue untouched').toHaveLength(0);

		const rowsAfter = await proposalsForJob(jobId);
		expect(
			rowsAfter.filter((r) => r.kind === 'relation'),
			'rejecting drops the waiting relations - nothing else was ever written for them'
		).toHaveLength(0);
	});
});
