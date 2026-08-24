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
import {
	createGatewayEmbedder,
	embeddingDimensionsFor,
	hashingEmbedder,
	type Embedder
} from '@canonry/indexing';
import {
	acceptAnyImportProposal,
	and,
	closeDb,
	createDb,
	eq,
	RelationEndpointNotAcceptedError,
	type Db
} from '@canonry/db';
import {
	entity,
	importJob,
	proposal,
	proposalPlan,
	relation,
	universe,
	universeMember,
	user,
	userBilling
} from '@canonry/db/schema';
import { dataDir, loadEnv, requireEnv } from '../env.js';
import { cachedEmbedder } from './embedding-cache.js';

// ---------------------------------------------------------------------------
// Arguments.
// ---------------------------------------------------------------------------

interface Args {
	corpus: string;
	mode: 'record' | 'replay';
	label: string;
	/** After the run, accept every proposal the way a GM would and report what canon it
	 * produced. Issue #613's mechanism only shows end to end here. */
	sweep: boolean;
	/** Which embedder `resolveRelationType`'s semantic rung runs on (issue #629). `gateway`
	 * is the real multilingual model the rung was designed for; `hashing` is
	 * `hashingEmbedder`, which is what `apps/web`'s composition root passed until #629, so a
	 * replay can measure the production path rather than describing it. */
	relationEmbedder: 'gateway' | 'hashing';
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
	let sweep = false;
	let relationEmbedder: 'gateway' | 'hashing' = 'gateway';
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--corpus') corpus = argv[++i] ?? '';
		else if (arg === '--record') mode = 'record';
		else if (arg === '--replay') mode = 'replay';
		else if (arg === '--label') label = argv[++i] ?? 'run';
		else if (arg === '--limit') limit = Number(argv[++i] ?? '0') || null;
		else if (arg === '--sweep') sweep = true;
		else if (arg === '--relation-embedder') {
			const value = argv[++i] ?? '';
			if (value !== 'gateway' && value !== 'hashing') {
				throw new Error('--relation-embedder takes gateway or hashing');
			}
			relationEmbedder = value;
		}
	}
	if (!corpus) throw new Error('--corpus <path to a .one/.onepkg/.zip export> is required');
	if (!mode) throw new Error('one of --record or --replay is required');
	return { corpus, mode, label, limit, sweep, relationEmbedder };
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
// A disk-backed embedding cache, so a replay costs nothing and never moves. Lives in
// `./embedding-cache.ts`, which also records why it exists next to a recording at all: this
// file ends in `await main()`, so a test cannot reach anything declared in it (issue #668).
// ---------------------------------------------------------------------------

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

interface SweepReport {
	rounds: number;
	accepted: number;
	stillWaiting: number;
	failures: Array<{ kind: string; error: string }>;
	outcomes: Record<string, number>;
	relationRowsWritten: number;
	entityRowsWritten: number;
}

/**
 * A GM who accepts everything, walking the queue the way the review screen orders it
 * (plan by plan, rank within a plan), and going round again for whatever the last pass
 * made acceptable.
 *
 * The second pass is the whole point of the sweep. Issue #613's mechanism only shows up
 * end to end here: a relation refuses its accept while an endpoint is still one of this
 * job's own pending proposals, and becomes acceptable the moment that proposal is
 * accepted, so the queue converges rather than deadlocks. A round that accepts nothing
 * ends it, which is what makes a real deadlock a finite run and not a hang.
 *
 * A refusal that is not the endpoint one is recorded and never retried: it is a defect,
 * and retrying it would turn one defect into ten rounds of the same message.
 */
async function acceptEverything(
	db: Db,
	jobId: string,
	universeId: string,
	userId: string
): Promise<SweepReport> {
	let accepted = 0;
	let rounds = 0;
	const failures: SweepReport['failures'] = [];
	const givenUp = new Set<string>();

	for (;;) {
		rounds++;
		const rows = await db
			.select({
				id: proposal.id,
				kind: proposal.kind,
				evidence: proposal.evidence,
				rank: proposal.rank,
				createdAt: proposalPlan.createdAt
			})
			.from(proposal)
			.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
			.where(and(eq(proposalPlan.importJobId, jobId), eq(proposal.outcome, 'pending')))
			.orderBy(proposalPlan.createdAt, proposal.rank);
		const pending = rows.filter((row) => !givenUp.has(row.id));
		if (pending.length === 0) return finishSweep();

		let acceptedThisRound = 0;
		for (const row of pending) {
			const evidence = row.evidence as { sourceRef?: { path?: unknown }; contentHash?: unknown };
			try {
				await acceptAnyImportProposal(db, row.kind, {
					proposalId: row.id,
					decidedBy: userId,
					sourceSystem: 'onenote',
					externalId:
						typeof evidence?.sourceRef?.path === 'string' ? evidence.sourceRef.path : null,
					sourceUrl: null,
					contentHash: typeof evidence?.contentHash === 'string' ? evidence.contentHash : '',
					importJobId: jobId
				});
				accepted++;
				acceptedThisRound++;
			} catch (error) {
				if (error instanceof RelationEndpointNotAcceptedError) continue;
				givenUp.add(row.id);
				failures.push({
					kind: row.kind,
					error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
				});
			}
		}
		if (acceptedThisRound === 0) return finishSweep();
	}

	async function finishSweep(): Promise<SweepReport> {
		const outcomeRows = await db
			.select({ outcome: proposal.outcome, id: proposal.id })
			.from(proposal)
			.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
			.where(eq(proposalPlan.importJobId, jobId));
		const outcomes: Record<string, number> = {};
		for (const row of outcomeRows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
		const relations = await db
			.select({ id: relation.id })
			.from(relation)
			.where(eq(relation.universeId, universeId));
		const entities = await db
			.select({ id: entity.id })
			.from(entity)
			.where(eq(entity.universeId, universeId));
		return {
			rounds,
			accepted,
			stillWaiting: outcomes.pending ?? 0,
			failures,
			outcomes,
			relationRowsWritten: relations.length,
			entityRowsWritten: entities.length
		};
	}
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
		// Only ever used to fill a cache miss. A replay normally has none, and a replay of a
		// change that makes the merge engine do *more* work legitimately does: before issue
		// #613 a relation was dropped before `resolveRelationType` ever ran, so the recorded
		// run took no relation-label embedding at all and the replay of the fix asks for 41.
		// Those are real, and topping them up (once, then cached) is more honest than
		// pretending the two runs did the same work. Nothing about the model's own output
		// changes: that comes from the recorded stream either way.
		//
		// It was a harness cost and not a product one until issue #629: `apps/web` passed
		// `hashingEmbedder` for this rung, which reached no gateway. It now passes the real
		// embedder when the process has a credential, so a real import pays for these too -
		// measured on this notebook at 178 calls, 26,344 embedding tokens and EUR 0.000456.
		let embedInner: Embedder | null = null;
		const credentials = process.env.AI_GATEWAY_API_KEY ? readGatewayCredentials(process.env) : null;
		if (credentials) {
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
		}

		if (args.mode === 'record') {
			if (!credentials) throw new Error('--record needs AI_GATEWAY_API_KEY');
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

		// Issue #629: the two candidates for `resolveRelationType`'s semantic rung, side by
		// side on one recorded stream. `hashingEmbedder` is what `apps/web`'s composition root
		// handed this parameter until #629, so `--relation-embedder hashing` is what a real
		// import used to resolve labels with, and the difference between the two labels is
		// what the wiring fix is actually worth on a real notebook.
		const chosenRelationEmbedder =
			args.relationEmbedder === 'hashing' ? hashingEmbedder : cachedEmbedder(embedInner, embedPath);
		// And how much work it is, because "turn the rung on" is a cost as well as a decision:
		// `bestSemanticMatch` embeds the proposed label plus every shipped locale's label and
		// inverse label, once per relation, so the texts figure is what a real import would pay
		// the gateway for and the reason #629 files the per-job memoisation as a follow-up.
		const rungCost = { calls: 0, texts: 0 };
		const embedRelationLabel: Embedder = async (texts) => {
			rungCost.calls += 1;
			rungCost.texts += texts.length;
			return chosenRelationEmbedder(texts);
		};

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
			embedRelationLabel,
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

		const sweep = args.sweep
			? await acceptEverything(db, admitted.jobId, universeId, userId)
			: null;

		const report = {
			mode: args.mode,
			label: args.label,
			corpus: path.basename(args.corpus),
			relationEmbedder: args.relationEmbedder,
			relationLabelEmbedding: rungCost,
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
			sweep,
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
