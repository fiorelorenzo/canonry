/**
 * Issue #613: how much of a first import's relation graph the merge engine throws away,
 * measured on a real notebook rather than on the sample corpus.
 *
 * The sample corpus cannot answer the question. `packages/bench/src/corpus` renders one
 * world into every format, and its OneNote rendering has no deep page hierarchy, so the
 * relations it produces are few and mostly between entities the same document already
 * matched onto canon. The case #613 is about is the opposite: a real notebook whose whole
 * shape is a parent/subpage tree, imported into an empty universe, where every endpoint is
 * new. That corpus is a third party's private campaign, so it is passed in by path and
 * nothing about its content is committed.
 *
 *   pnpm --filter @canonry/bench onenote-relations -- \
 *     --corpus "/path/to/Notebook.onepkg" --record
 *   pnpm --filter @canonry/bench onenote-relations -- \
 *     --corpus "/path/to/Notebook.onepkg" --replay
 *
 * **Record once, replay for free, and that is the whole point of the two modes.** A model
 * run costs money and is not reproducible, so a before/after measured as two paid runs
 * measures the change *and* the model's mood, with no way to tell them apart. `--record`
 * runs the real `GatewayDriver` once and writes every `JobEvent` it yielded to a JSONL
 * file, plus every embedding the matcher asked for. `--replay` feeds that same stream back
 * through the same `ImportJobRunner` against a fresh universe, so the merge engine sees
 * byte-identical model output on every run and the only thing that can move the numbers is
 * the code under test. The replay reaches no gateway at all: the recorded `usage` events
 * still write their `model_call` rows, which is what keeps the cost accounting honest about
 * what the recorded run really cost, but nothing new is spent.
 *
 * What it reports is the ledger #613 asks for: of the relations the tool accepted, how many
 * reached the review queue, how many were dropped, and for each dropped one whether its
 * endpoints were entities this same job proposed (so an accept sequence could reach them)
 * or nothing at all (so no sequencing helps).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	ArchiveSourceReader,
	DbModelSelector,
	DEFAULT_ARCHIVE_LIMITS,
	GatewayDriver,
	ImportJobRunner,
	InMemoryImageStore,
	admitAndCreateImportJob,
	bandedSimilarity,
	deriveJobBudget,
	estimateAveragesForPlaybook,
	loadBuiltinPlaybook,
	type ImportDriver,
	type ImportJob,
	type JobDocument,
	type JobEvent,
	type JobStream,
	type SourceReader
} from '@canonry/import';
import {
	createEmbeddingModel,
	createLanguageModel,
	readGatewayCredentials,
	resolveModel
} from '@canonry/ai';
import { createGatewayEmbedder, embeddingDimensionsFor, type Embedder } from '@canonry/indexing';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import {
	importJob,
	proposal,
	proposalPlan,
	universe,
	universeMember,
	user,
	userBilling
} from '@canonry/db/schema';
import { dataDir, loadEnv, requireEnv } from '../env.js';

// ---------------------------------------------------------------------------
// Arguments.
// ---------------------------------------------------------------------------

interface Args {
	corpus: string;
	mode: 'record' | 'replay';
	label: string;
	/** Documents to run, for a smoke test that costs a euro rather than the notebook's
	 * full price. A recording and the replays that read it must agree on it, or the
	 * replay's document ids name pages the run never enumerated. */
	limit: number | null;
}

function parseArgs(argv: string[]): Args {
	let corpus = '';
	let mode: 'record' | 'replay' | null = null;
	let label = 'run';
	let limit: number | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--corpus') corpus = argv[++i] ?? '';
		else if (arg === '--record') mode = 'record';
		else if (arg === '--replay') mode = 'replay';
		else if (arg === '--label') label = argv[++i] ?? 'run';
		else if (arg === '--limit') limit = Number(argv[++i] ?? '0') || null;
	}
	if (!corpus) throw new Error('--corpus <path to a .one/.onepkg/.zip export> is required');
	if (!mode) throw new Error('one of --record or --replay is required');
	return { corpus, mode, label, limit };
}

// ---------------------------------------------------------------------------
// Recording and replaying the driver.
// ---------------------------------------------------------------------------

/** Wraps a real driver and appends every event it yields to a JSONL file, unchanged. */
class RecordingDriver implements ImportDriver {
	constructor(
		private readonly inner: ImportDriver,
		private readonly sink: string[]
	) {}

	startJob(job: ImportJob): JobStream {
		const inner = this.inner.startJob(job);
		const sink = this.sink;
		const stream: JobStream = {
			jobId: inner.jobId,
			async *[Symbol.asyncIterator]() {
				for await (const event of inner) {
					sink.push(JSON.stringify(event));
					yield event;
				}
			}
		};
		return stream;
	}

	cancel(jobId: string): void {
		this.inner.cancel(jobId);
	}
}

/** Yields a recorded stream back, with the job id rewritten to this run's own so the
 * runner's own bookkeeping lines up. Nothing else is touched: same documents, same
 * payloads, same order, same usage figures. */
class ReplayDriver implements ImportDriver {
	constructor(private readonly events: JobEvent[]) {}

	startJob(job: ImportJob): JobStream {
		const events = this.events;
		const stream: JobStream = {
			jobId: job.id,
			async *[Symbol.asyncIterator]() {
				for (const event of events) yield { ...event, jobId: job.id };
			}
		};
		return stream;
	}

	cancel(): void {
		// A replay has nothing to interrupt: the whole stream is already in memory.
	}
}

// ---------------------------------------------------------------------------
// A disk-backed embedding cache, so a replay costs nothing and never moves.
// ---------------------------------------------------------------------------

function cachedEmbedder(inner: Embedder | null, cachePath: string): Embedder {
	const cache: Record<string, number[]> = existsSync(cachePath)
		? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, number[]>)
		: {};
	let dirty = false;

	return async (texts: string[]): Promise<number[][]> => {
		const keys = texts.map((text) => createHash('sha256').update(text).digest('hex'));
		const missing = texts.filter((_, i) => cache[keys[i]!] === undefined);
		if (missing.length > 0) {
			if (!inner) {
				throw new Error(
					`replay asked for ${missing.length} embedding(s) the recorded run never took. ` +
						'Re-record, or check that the merge engine is being fed the same payloads.'
				);
			}
			const vectors = await inner(missing);
			let m = 0;
			for (let i = 0; i < texts.length; i++) {
				if (cache[keys[i]!] === undefined) cache[keys[i]!] = vectors[m++]!;
			}
			dirty = true;
		}
		if (dirty) {
			writeFileSync(cachePath, JSON.stringify(cache));
			dirty = false;
		}
		return keys.map((key) => cache[key]!);
	};
}

// ---------------------------------------------------------------------------
// Fixture rows: this harness owns its own user and a fresh universe per run, because a
// first import into an empty universe is the case under test.
// ---------------------------------------------------------------------------

const HARNESS_USER_ID = 'onenote-relations-owner';
const HARNESS_CREDITS = 500_000;

async function ensureUser(db: Db): Promise<string> {
	await db
		.insert(user)
		.values({
			id: HARNESS_USER_ID,
			name: 'OneNote relation loss',
			email: 'onenote-relations@canonry.invalid',
			emailVerified: true
		})
		.onConflictDoNothing();
	await db
		.insert(userBilling)
		.values({
			userId: HARNESS_USER_ID,
			subscriptionCredits: HARNESS_CREDITS,
			warmBudgetCredits: HARNESS_CREDITS
		})
		.onConflictDoUpdate({
			target: userBilling.userId,
			set: { subscriptionCredits: HARNESS_CREDITS, warmBudgetSpent: 0 }
		});
	return HARNESS_USER_ID;
}

async function freshUniverse(db: Db, userId: string, label: string): Promise<string> {
	const slug = `onenote-relations-${label}-${Date.now().toString(36)}`;
	const [row] = await db
		.insert(universe)
		.values({ ownerUserId: userId, name: `OneNote relations (${label})`, slug, kind: 'homebrew' })
		.returning({ id: universe.id });
	if (!row) throw new Error('universe insert returned no row');
	await db
		.insert(universeMember)
		.values({ universeId: row.id, userId, role: 'owner' })
		.onConflictDoNothing();
	return row.id;
}

// ---------------------------------------------------------------------------
// Documents. Same rule apps/web's `documentsForPlaybook` applies for the onenote
// playbook: one document per exported page, and a "<page>_files" folder is that page's
// own attachments rather than a page of its own.
// ---------------------------------------------------------------------------

async function walkAllPaths(reader: SourceReader, prefix = ''): Promise<string[]> {
	const entries = await reader.list(prefix);
	const out: string[] = [];
	for (const entry of entries) {
		if (entry.kind === 'file') out.push(entry.path);
		else out.push(...(await walkAllPaths(reader, entry.path)));
	}
	return out;
}

async function oneNoteDocuments(reader: SourceReader): Promise<JobDocument[]> {
	const paths = await walkAllPaths(reader);
	return paths
		.filter((p) => /\.html?$/i.test(p))
		.filter((p) => !p.split('/').some((segment) => segment.endsWith('_files')))
		.map((p, i) => ({ id: `doc-${i + 1}`, sourcePath: p }));
}

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

interface RelationLedger {
	proposedByTool: number;
	reachedQueue: number;
	dropped: number;
	droppedBothEndsProposed: number;
	droppedOneEndProposed: number;
	droppedNoEndProposed: number;
	droppedSelfLoop: number;
	deferred: number;
}

async function proposalsByKind(db: Db, jobId: string): Promise<Record<string, number>> {
	const rows = await db
		.select({ kind: proposal.kind })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(eq(proposalPlan.importJobId, jobId));
	const counts: Record<string, number> = {};
	for (const row of rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
	return counts;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}

	const outDir = path.join(dataDir, 'onenote-relations');
	mkdirSync(outDir, { recursive: true });
	const corpusKey = createHash('sha256')
		.update(path.resolve(args.corpus))
		.digest('hex')
		.slice(0, 12);
	const scope = args.limit === null ? 'all' : `first${args.limit}`;
	const eventsPath = path.join(outDir, `${corpusKey}.${scope}.events.jsonl`);
	const embedPath = path.join(outDir, `${corpusKey}.${scope}.embeddings.json`);

	const db = createDb(url, { max: 4, quiet: true });
	try {
		const userId = await ensureUser(db);
		const universeId = await freshUniverse(db, userId, args.label);

		const bytes = readFileSync(args.corpus);
		const sources = ArchiveSourceReader.openUpload(
			bytes,
			path.basename(args.corpus),
			DEFAULT_ARCHIVE_LIMITS
		);
		const allDocuments = await oneNoteDocuments(sources);
		const documents = args.limit === null ? allDocuments : allDocuments.slice(0, args.limit);
		const playbook = await loadBuiltinPlaybook('onenote');

		const averages = await estimateAveragesForPlaybook(db, 'onenote');
		const { estimate, budgetCredits } = deriveJobBudget(averages, documents.length);
		const admitted = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'onenote',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: args.corpus,
			artefactBytes: bytes.byteLength,
			artefactSha256: createHash('sha256').update(bytes).digest('hex'),
			documentCount: documents.length,
			budgetCredits,
			estimate,
			concurrencyLimit: 20
		});
		if (!admitted.admitted) throw new Error('job was not admitted');

		const recorded: string[] = [];
		let driver: ImportDriver;
		let embedInner: Embedder | null = null;

		if (args.mode === 'record') {
			const credentials = readGatewayCredentials(process.env);
			driver = new RecordingDriver(
				new GatewayDriver({
					models: new DbModelSelector({
						resolvePurpose: async (purpose) => resolveModel(db, purpose),
						createLanguageModel: (provider, modelId) =>
							createLanguageModel(provider, modelId, credentials)
					}),
					gateway: (model) => model
				}),
				recorded
			);
			const embeddingModel = await resolveModel(db, 'embedding');
			embedInner = createGatewayEmbedder({
				db,
				model: {
					...embeddingModel,
					model: createEmbeddingModel(embeddingModel.provider, embeddingModel.modelId, credentials)
				},
				userId,
				universeId,
				operation: 'import.match.embed'
			});
		} else {
			if (!existsSync(eventsPath)) {
				throw new Error(`no recorded run at ${eventsPath} - run with --record first`);
			}
			const events = readFileSync(eventsPath, 'utf8')
				.split('\n')
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line) as JobEvent);
			driver = new ReplayDriver(events);
		}

		const embeddingModel = await resolveModel(db, 'embedding');
		const banded = bandedSimilarity({
			embed: cachedEmbedder(embedInner, embedPath),
			vectorSize: embeddingDimensionsFor(embeddingModel.provider, embeddingModel.modelId)
		});

		const started = Date.now();
		const runner = new ImportJobRunner();
		const result = await runner.run({
			db,
			driver,
			dbJobId: admitted.jobId,
			universeId,
			sourceSystem: 'onenote',
			userId,
			playbook,
			documents,
			budget: { maxCredits: budgetCredits },
			sources,
			images: new InMemoryImageStore(),
			similarity: banded.similarity,
			thresholds: banded.thresholds,
			embedRelationLabel: cachedEmbedder(embedInner, embedPath),
			timeoutMs: 60 * 60 * 1000
		});
		const seconds = (Date.now() - started) / 1000;

		if (args.mode === 'record') {
			writeFileSync(eventsPath, recorded.join('\n') + '\n');
		}

		const [jobRow] = await db
			.select({
				status: importJob.status,
				outcomeNote: importJob.outcomeNote,
				spentCredits: importJob.spentCredits,
				inputTokens: importJob.inputTokens,
				outputTokens: importJob.outputTokens
			})
			.from(importJob)
			.where(eq(importJob.id, admitted.jobId))
			.limit(1);

		const byKind = await proposalsByKind(db, admitted.jobId);
		const ledger: RelationLedger = {
			proposedByTool: result.documents.reduce((sum, d) => sum + d.relationCount, 0),
			reachedQueue: byKind.relation ?? 0,
			dropped: 0,
			droppedBothEndsProposed: 0,
			droppedOneEndProposed: 0,
			droppedNoEndProposed: 0,
			droppedSelfLoop: 0,
			deferred: 0
		};
		for (const doc of result.documents) {
			const drop = doc.droppedRelations;
			if (!drop) continue;
			ledger.dropped += drop.total;
			ledger.droppedBothEndsProposed += drop.bothEndsProposed;
			ledger.droppedOneEndProposed += drop.oneEndProposed;
			ledger.droppedNoEndProposed += drop.noEndProposed;
			ledger.droppedSelfLoop += drop.selfLoop;
			ledger.deferred += drop.deferred;
		}

		const report = {
			mode: args.mode,
			label: args.label,
			corpus: path.basename(args.corpus),
			documents: documents.length,
			status: jobRow?.status ?? result.finalStatus,
			outcomeNote: jobRow?.outcomeNote ?? null,
			seconds: Math.round(seconds),
			spentCredits: Number(jobRow?.spentCredits ?? 0),
			inputTokens: jobRow?.inputTokens ?? 0,
			outputTokens: jobRow?.outputTokens ?? 0,
			proposalsByKind: byKind,
			relations: ledger,
			documentStatuses: result.documents.reduce<Record<string, number>>((acc, d) => {
				acc[d.status] = (acc[d.status] ?? 0) + 1;
				return acc;
			}, {}),
			universeId,
			jobId: admitted.jobId
		};
		const reportPath = path.join(outDir, `${corpusKey}.${args.label}.report.json`);
		writeFileSync(reportPath, JSON.stringify(report, null, 2));
		console.log(JSON.stringify(report, null, 2));
		console.log(`\nreport: ${reportPath}`);
		if (args.mode === 'record') console.log(`events: ${eventsPath}`);
	} finally {
		await closeDb(db);
	}
}

await main();
