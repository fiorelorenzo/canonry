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
import { and, closeDb, createDb, eq, type Db } from '@canonry/db';
import { operationPrice, proposal, proposalPlan, universe, user } from '@canonry/db/schema';
import {
	acceptImportProposal,
	admitAndCreateImportJob,
	ArchiveSourceReader,
	estimateImportJob,
	ImportJobRunner,
	InMemoryImageStore,
	InMemorySourceReader,
	loadBuiltinPlaybook,
	type SourceReader
} from '@canonry/import';
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
 * thrown so one bad accept does not hide what the rest of the sweep did. */
async function acceptAll(
	db: Db,
	jobId: string,
	userId: string,
	sourceSystem: string
): Promise<{ accepted: number; failures: Array<{ kind: string; error: string }> }> {
	const rows = await db
		.select({ id: proposal.id, kind: proposal.kind, evidence: proposal.evidence })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(and(eq(proposalPlan.importJobId, jobId), eq(proposal.outcome, 'pending')));

	let accepted = 0;
	const failures: Array<{ kind: string; error: string }> = [];
	for (const row of rows) {
		const evidence = row.evidence as { sourceRef?: { path?: unknown }; contentHash?: unknown };
		const externalId =
			typeof evidence?.sourceRef?.path === 'string' ? evidence.sourceRef.path : null;
		const contentHash = typeof evidence?.contentHash === 'string' ? evidence.contentHash : '';
		try {
			await acceptImportProposal(db, {
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
 */
describe('regression: two documents naming the same entity in one job (issue #160, #175)', () => {
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
		await runner.run({
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
			timeoutMs: 60_000
		});

		// The pre-#175 bug: two documents naming "Aldric Voss" produced two `create`
		// proposals, not one folded proposal.
		const firstCount = await countProposals(db, admitted.jobId);
		expect(firstCount, 'expected one folded create, not one per document').toBe(1);

		// The pre-#175 bug's own observable: accepting the second `create` for the same
		// name raises `entity_universe_slug_key`, caught here as a failure rather than a
		// thrown test error.
		const sweep = await acceptAll(db, admitted.jobId, userId, 'obsidian');
		expect(
			sweep.failures,
			`accept sweep should be clean; got ${JSON.stringify(sweep.failures)}`
		).toEqual([]);
	});
});
