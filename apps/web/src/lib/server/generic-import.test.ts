/**
 * Issue #305, end to end: a mixed upload of HTML and CSV, the kind the generic guide has
 * always promised Canonry reads, enumerated zero documents and finished having proposed
 * nothing, because `documentsForPlaybook('generic', ...)` shared obsidian's `.md`/`.txt`
 * filter. `onboarding.test.ts` covers the enumeration rule itself; this file drives the
 * whole path the onboarding route drives, against a real Postgres: the real
 * `ArchiveSourceReader` over a real zip, `documentsForPlaybook`, `admitAndCreateImportJob`
 * and `ImportJobRunner`, so "documents enumerated" is worth nothing here unless real
 * proposals come out the other end.
 *
 * `DeterministicExtractionDriver` rather than `GatewayDriver`, for the same reason
 * `reimport-idempotency.test.ts` gives: CI carries no AI_GATEWAY_* credentials and should
 * not, and that driver is what a deployment without them actually runs, so this is the
 * product's own no-credentials path rather than a test double invented for the occasion.
 *
 * The second describe covers the other half of the issue: an upload where nothing reads as
 * text has to end saying so. Two layers already do that and neither is new here, so these
 * tests exist to keep them from regressing quietly - the onboarding route refuses at the
 * confirm step (`noDocumentsFound`, before anything is spent), and a job that reaches the
 * runner with nothing to run settles with a `no_documents` outcome note, which is what the
 * job page and the review banner render.
 */
import { randomUUID } from 'node:crypto';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { operationPrice, proposal, proposalPlan, universe, user } from '@canonry/db/schema';
import {
	admitAndCreateImportJob,
	ArchiveSourceReader,
	estimateImportJob,
	ImportJobRunner,
	InMemoryImageStore,
	lexicalTrigramSimilarity,
	loadBuiltinPlaybook,
	parseOutcomeNote
} from '@canonry/import';
import { hashingEmbedder } from '@canonry/indexing';
import {
	DeterministicExtractionDriver,
	documentsForPlaybook,
	getImportJobRow,
	MATCH_THRESHOLDS
} from './onboarding.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

const encoder = new TextEncoder();

/** A GM's folder out of some tool Canonry has never heard of: one HTML page, one CSV, and
 * a map image and a `.DS_Store` beside them, which is what makes it a mixed upload rather
 * than a tidy fixture. Nothing in here ends in `.md` or `.txt`, so the pre-#305 rule
 * matched none of it. */
const MIXED_UPLOAD: Record<string, Uint8Array> = {
	'Ashgate/trading-post.html': encoder.encode(
		'<html><head><title>The Ashgate Trading Post</title></head>\n' +
			'<body><p>Sera Bellweather runs the trading post on the north road, two days ' +
			'ride from the nearest guard post.</p><p>She answers to nobody but her own ' +
			'ledger.</p></body></html>\n'
	),
	'Ashgate/people.csv': encoder.encode(
		'name,role,owes\nSera Bellweather,trader,\nTorvin Hale,carter,Sera Bellweather\n'
	),
	'Ashgate/map.png': new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
	]),
	'Ashgate/.DS_Store': new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31])
};

// Both tests here run a whole import, and `DeterministicExtractionDriver` sleeps 700ms
// between documents on purpose, so vitest's five-second default is too tight on a loaded
// box - `reimport-idempotency.test.ts` carries the same line and the full account of why.
vi.setConfig({ testTimeout: 60_000 });

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('a generic upload of HTML and CSV imports and proposes (issue #305)', () => {
	let db: Db;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });
		// materializeDocumentProposals charges chargeFor(db, 'import.document') as soon as
		// there is a document to run, so without a priced row the job throws instead of
		// reaching a proposal.
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

	async function universeFor(prefix: string): Promise<{ userId: string; universeId: string }> {
		const userId = unique(prefix);
		await db
			.insert(user)
			.values({ id: userId, name: `Generic ${prefix}`, email: `${userId}@canonry.invalid` });
		const [universeRow] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: `Generic ${prefix}`,
				slug: unique(prefix),
				kind: 'homebrew'
			})
			.returning();
		if (!universeRow) throw new Error('universe insert did not return a row');
		return { userId, universeId: universeRow.id };
	}

	it('enumerates both documents and produces real proposals from them', async () => {
		const reader = ArchiveSourceReader.open(zipSync(MIXED_UPLOAD));
		const documents = await documentsForPlaybook('generic', reader);
		expect(documents.map((d) => d.sourcePath).sort()).toEqual([
			'Ashgate/people.csv',
			'Ashgate/trading-post.html'
		]);

		const playbook = await loadBuiltinPlaybook('generic');
		const { userId, universeId } = await universeFor('generic-mixed');
		const estimate = estimateImportJob({
			documentCount: documents.length,
			avgCreditsPerDocument: 1,
			avgSecondsPerDocument: 1
		});
		const admitted = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'generic',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 'test-fixture://generic-mixed',
			artefactBytes: 0,
			artefactSha256: '0'.repeat(64),
			documentCount: documents.length,
			budgetCredits: 1000,
			estimate,
			concurrencyLimit: 20
		});
		expect(admitted.admitted).toBe(true);

		const result = await new ImportJobRunner().run({
			db,
			driver: new DeterministicExtractionDriver(),
			dbJobId: admitted.jobId,
			universeId,
			sourceSystem: 'generic',
			userId,
			playbook,
			documents,
			sources: reader,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: lexicalTrigramSimilarity,
			thresholds: MATCH_THRESHOLDS,
			embedRelationLabel: hashingEmbedder,
			timeoutMs: 60_000
		});

		expect(result.finalStatus).toBe('finished');
		expect(result.proposalsEmitted).toBeGreaterThan(0);

		const rows = await db
			.select({ kind: proposal.kind, patch: proposal.patch })
			.from(proposal)
			.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
			.where(eq(proposalPlan.importJobId, admitted.jobId));
		expect(rows.length).toBe(documents.length);
		const patches = rows.map((row) => row.patch as { name?: string; body?: string });

		// The HTML document's proposal is named after the page's own <title>, not after its
		// file: this driver reads a first heading and a first paragraph, so before #305
		// taught it to flatten markup an HTML page would have been proposed under the file
		// name with "<!DOCTYPE html>" for a body.
		expect(patches.map((patch) => patch.name)).toContain('The Ashgate Trading Post');
		const page = patches.find((patch) => patch.name === 'The Ashgate Trading Post');
		expect(page?.body ?? '').toContain('Sera Bellweather');
		expect(page?.body ?? '').not.toContain('<');
	});

	it('ends with a no_documents outcome note when nothing in the upload reads as text', async () => {
		// The onboarding route refuses this upload at the confirm step, before a job exists
		// (`+page.server.ts`'s `noDocumentsFound`), so this is the second layer: a job that
		// reaches the runner with nothing to run settles saying so rather than looking like
		// a finished import that proposed nothing.
		const reader = ArchiveSourceReader.open(
			zipSync({
				'Ashgate/map.png': MIXED_UPLOAD['Ashgate/map.png']!,
				'Ashgate/.DS_Store': MIXED_UPLOAD['Ashgate/.DS_Store']!
			})
		);
		const documents = await documentsForPlaybook('generic', reader);
		expect(documents).toEqual([]);

		const playbook = await loadBuiltinPlaybook('generic');
		const { userId, universeId } = await universeFor('generic-binaries');
		const admitted = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'generic',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 'test-fixture://generic-binaries',
			artefactBytes: 0,
			artefactSha256: '1'.repeat(64),
			documentCount: 0,
			budgetCredits: 1000,
			estimate: estimateImportJob({
				documentCount: 0,
				avgCreditsPerDocument: 1,
				avgSecondsPerDocument: 1
			}),
			concurrencyLimit: 20
		});
		expect(admitted.admitted).toBe(true);

		const result = await new ImportJobRunner().run({
			db,
			driver: new DeterministicExtractionDriver(),
			dbJobId: admitted.jobId,
			universeId,
			sourceSystem: 'generic',
			userId,
			playbook,
			documents,
			sources: reader,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: lexicalTrigramSimilarity,
			thresholds: MATCH_THRESHOLDS,
			embedRelationLabel: hashingEmbedder,
			timeoutMs: 60_000
		});

		expect(result.finalStatus).toBe('finished');
		expect(result.proposalsEmitted).toBe(0);
		const jobRow = await getImportJobRow(db, admitted.jobId);
		expect(parseOutcomeNote(jobRow?.outcomeNote ?? '')).toEqual({ v: 1, kind: 'no_documents' });
	});
});
