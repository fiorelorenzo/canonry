/**
 * The import, end to end, for every source format the product ships.
 *
 *   pnpm --filter @canonry/bench import-e2e
 *   pnpm --filter @canonry/bench import-e2e -- --source kanka
 *
 * What this runs is the whole path a GM's upload takes, in order, with nothing stubbed:
 * detection, document enumeration, the estimate, admission, the `GatewayDriver` loop
 * through `ImportJobRunner`, the deterministic merge engine, proposal rows, then the review
 * decisions. It then re-imports the same export and the changed one, which is where
 * SPEC.md §6.4's guarantees either hold or do not.
 *
 * The four claims it checks, in the spec's own words:
 *
 * 1. "**importing the same export twice produces zero changes on the second run**"
 *    (§6.4). Not "few". Zero.
 * 2. A field the user edited and the source changed **raises a conflict proposal** rather
 *    than overwriting.
 * 3. An entity that **disappeared from the source is never deleted**, only marked.
 * 4. The one matching question the sample world names, `the Gilded Rat` against `Il Ratto
 *    Dorato`, lands **between the thresholds and asks** rather than guessing either way.
 *
 * Detection and enumeration are imported from `apps/web`'s own onboarding module rather
 * than reimplemented, because a corpus that the bench's private copy of `detectSource`
 * classifies correctly and the app's does not would prove nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb, createDb, eq, and, type Db } from '@canonry/db';
import {
	entity,
	entitySourceRef,
	importJob,
	proposal,
	proposalPlan,
	revision
} from '@canonry/db/schema';
import {
	ArchiveSourceReader,
	DEFAULT_ARCHIVE_LIMITS,
	DbModelSelector,
	deriveJobBudget,
	estimateAveragesForPlaybook,
	GatewayDriver,
	ImportJobRunner,
	InMemoryImageStore,
	acceptImportProposal,
	admitAndCreateImportJob,
	lexicalTrigramSimilarity,
	loadBuiltinPlaybook,
	type JobDocument
} from '@canonry/import';
import { createGatewayEmbedder } from '@canonry/indexing';
import {
	createEmbeddingModel,
	createGateway,
	readGatewayCredentials,
	resolveModel
} from '@canonry/ai';
import { rejectProposal, undoAcceptedProposal } from '@canonry/db';
import { dataDir, loadEnv, requireEnv } from '../env.js';
import { benchFixture, topUpCredits } from '../fixture.js';
import { universeForSource } from './universe.js';
import { archivePath, manifestPath, type CorpusManifest } from '../corpus/build.js';
import { CHANGE_MANIFEST } from '../corpus/valdoria-reach.js';

/** Matches `apps/web/src/lib/server/onboarding.ts`'s own thresholds, which is the point:
 * the "ask the user" band is a product decision and the bench must not widen it. */
const MATCH_THRESHOLDS = { matchAbove: 0.85, newBelow: 0.5 };

export interface SourceReport {
	source: string;
	playbook: string;
	documents: number;
	/** First import. */
	first: RunReport;
	/** The same export again. Every number here should be zero. */
	second: RunReport;
	/** The changed export. */
	changed: RunReport;
	idempotent: boolean;
	notes: string[];
}

export interface RunReport {
	jobId: string;
	status: string;
	outcomeNote: string | null;
	proposalsEmitted: number;
	proposalsByKind: Record<string, number>;
	entitiesInUniverse: number;
	spentCredits: number;
	inputTokens: number;
	outputTokens: number;
	seconds: number;
	/** Proposals whose evidence records a similarity inside the ask band. */
	askedQuestions: Array<{ name: string; similarity: number | null; candidates: number }>;
	/** `DocumentStatus` to count. A job reported as `stopped_at_ceiling` says nothing about
	 * how many of its documents got there, and that is the number worth reading. */
	documentStatuses: Record<string, number>;
	documentsWithNoEntity: number;
}

function gatewayFactory(): (
	provider: string,
	modelId: string
) => ReturnType<ReturnType<typeof createGateway>['languageModel']> {
	loadEnv();
	const gateway = createGateway(readGatewayCredentials(process.env));
	return (provider, modelId) => gateway.languageModel(`${provider}/${modelId}`);
}

async function readManifest(source: string, revision: 'v1' | 'v2'): Promise<CorpusManifest> {
	return JSON.parse(readFileSync(manifestPath(source, revision), 'utf8')) as CorpusManifest;
}

async function countProposals(db: Db, jobId: string): Promise<Record<string, number>> {
	const rows = await db
		.select({ kind: proposal.kind })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(eq(proposalPlan.importJobId, jobId));
	const counts: Record<string, number> = {};
	for (const row of rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
	return counts;
}

async function askedQuestionsFor(db: Db, jobId: string): Promise<RunReport['askedQuestions']> {
	const rows = await db
		.select({ patch: proposal.patch, evidence: proposal.evidence })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(eq(proposalPlan.importJobId, jobId));
	const out: RunReport['askedQuestions'] = [];
	for (const row of rows) {
		const evidence = row.evidence as { similarity?: unknown; ambiguousCandidateIds?: unknown };
		const similarity = typeof evidence?.similarity === 'number' ? evidence.similarity : null;
		const candidates = Array.isArray(evidence?.ambiguousCandidateIds)
			? evidence.ambiguousCandidateIds.length
			: 0;
		if (candidates > 0) {
			const patch = row.patch as { name?: unknown };
			out.push({
				name: typeof patch?.name === 'string' ? patch.name : '(unnamed)',
				similarity,
				candidates
			});
		}
	}
	return out;
}

interface RunOneInput {
	db: Db;
	universeId: string;
	userId: string;
	source: string;
	revision: 'v1' | 'v2';
	documents: JobDocument[];
	playbookId: string;
}

async function runOne(input: RunOneInput): Promise<RunReport> {
	const playbook = await loadBuiltinPlaybook(input.playbookId);
	const artefact = archivePath(input.source, input.revision);
	const bytes = readFileSync(artefact);

	// Issue #272: this used to be a private estimate (avgCreditsPerDocument was 0.25,
	// avgSecondsPerDocument was 12) and a flat budgetCredits of 400 that had nothing to
	// do with either number - two hundred times what the product would actually give a
	// small job. `deriveJobBudget` is the exact derivation `apps/web`'s onboarding routes
	// use, so a job this harness admits is the same job a real GM's UI click would admit,
	// not a more generous stand-in for it. Headroom for a long benchmark run comes from
	// `topUpCredits`'s large fixture balance (`fixture.ts`), same as any other user with
	// a large quota - never from bypassing this derivation.
	const averages = await estimateAveragesForPlaybook(input.db, input.playbookId);
	const { estimate, budgetCredits } = deriveJobBudget(averages, input.documents.length);

	const admitted = await admitAndCreateImportJob(input.db, {
		universeId: input.universeId,
		createdBy: input.userId,
		sourceType: input.source,
		playbook: playbook.id,
		playbookVersion: playbook.version,
		artefactPath: artefact,
		artefactBytes: bytes.byteLength,
		artefactSha256: 'bench',
		documentCount: input.documents.length,
		budgetCredits,
		estimate,
		concurrencyLimit: 20
	});

	const createLanguageModel = gatewayFactory();
	const driver = new GatewayDriver({
		models: new DbModelSelector({
			resolvePurpose: async (purpose) => resolveModel(input.db, purpose),
			createLanguageModel
		}),
		gateway: (model) => model
	});

	// K1 (docs/ux/DECISIONS.md round six, issue #189): the import loop resolves a relation
	// label the model proposed against the vocabulary this world already has, and the last
	// rung of that resolver is semantic. This harness promises nothing is stubbed, so it
	// gets the real gateway embedder rather than `hashingEmbedder`: the whole point of
	// measuring here is to find out what a real model's wording does to a real catalogue,
	// and #189's own threshold is explicitly waiting on a benchmark run like this one to
	// stop being a guess.
	const embeddingModel = await resolveModel(input.db, 'embedding');
	const embedRelationLabel = createGatewayEmbedder({
		db: input.db,
		model: {
			...embeddingModel,
			model: createEmbeddingModel(
				embeddingModel.provider,
				embeddingModel.modelId,
				readGatewayCredentials(process.env)
			)
		},
		userId: input.userId,
		universeId: input.universeId,
		operation: 'index.embed'
	});

	const started = Date.now();
	const runner = new ImportJobRunner();
	const result = await runner.run({
		db: input.db,
		driver,
		dbJobId: admitted.jobId,
		universeId: input.universeId,
		sourceSystem: input.source,
		userId: input.userId,
		playbook,
		documents: input.documents,
		budget: { maxCredits: budgetCredits },
		sources: ArchiveSourceReader.open(bytes, DEFAULT_ARCHIVE_LIMITS),
		images: new InMemoryImageStore(),
		similarity: lexicalTrigramSimilarity,
		thresholds: MATCH_THRESHOLDS,
		embedRelationLabel,
		timeoutMs: 20 * 60 * 1000
	});
	const seconds = (Date.now() - started) / 1000;

	const [jobRow] = await input.db
		.select({
			status: importJob.status,
			outcomeNote: importJob.outcomeNote,
			proposalsEmitted: importJob.proposalsEmitted,
			spentCredits: importJob.spentCredits,
			inputTokens: importJob.inputTokens,
			outputTokens: importJob.outputTokens
		})
		.from(importJob)
		.where(eq(importJob.id, admitted.jobId))
		.limit(1);

	const entities = await input.db
		.select({ id: entity.id })
		.from(entity)
		.where(eq(entity.universeId, input.universeId));

	return {
		jobId: admitted.jobId,
		status: jobRow?.status ?? result.finalStatus,
		outcomeNote: jobRow?.outcomeNote ?? null,
		proposalsEmitted: jobRow?.proposalsEmitted ?? result.proposalsEmitted,
		proposalsByKind: await countProposals(input.db, admitted.jobId),
		entitiesInUniverse: entities.length,
		spentCredits: Number(jobRow?.spentCredits ?? 0),
		inputTokens: jobRow?.inputTokens ?? 0,
		outputTokens: jobRow?.outputTokens ?? 0,
		seconds,
		askedQuestions: await askedQuestionsFor(input.db, admitted.jobId),
		documentStatuses: result.documents.reduce<Record<string, number>>((acc, d) => {
			acc[d.status] = (acc[d.status] ?? 0) + 1;
			return acc;
		}, {}),
		documentsWithNoEntity: result.documents.filter((d) => d.entityCount === 0).length
	};
}

/**
 * Accepts every pending proposal from one job. This is what makes the second import a real
 * test rather than a trivial one: `entity_source_ref` rows only exist once a proposal has
 * been accepted, and those rows are what the second run's exact-id match reads. An
 * idempotency test run against a universe where nothing was accepted proves nothing,
 * because there is nothing to match against.
 */
export interface AcceptSweep {
	accepted: number;
	failures: Array<{ name: string; kind: string; error: string }>;
}

async function acceptAll(
	db: Db,
	jobId: string,
	userId: string,
	sourceSystem: string
): Promise<AcceptSweep> {
	const rows = await db
		.select({
			id: proposal.id,
			kind: proposal.kind,
			patch: proposal.patch,
			evidence: proposal.evidence
		})
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(and(eq(proposalPlan.importJobId, jobId), eq(proposal.outcome, 'pending')));

	let accepted = 0;
	const failures: AcceptSweep['failures'] = [];
	for (const row of rows) {
		const evidence = row.evidence as {
			sourceRef?: { path?: unknown };
			contentHash?: unknown;
		};
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
			// Recorded, never swallowed. The first version of this runner counted accepts and
			// dropped the errors, and the resulting report said "accepted 20 of 31" with no
			// way to tell whether the eleven were a relation waiting for its endpoints or a
			// real defect. They were a real defect.
			const patch = row.patch as { name?: unknown };
			failures.push({
				name: typeof patch?.name === 'string' ? patch.name : '(unnamed)',
				kind: row.kind,
				error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
			});
		}
	}
	return { accepted, failures };
}

/** Guardrail 1's other half: a GM who rejects, and a GM who changes their mind. Runs on
 * the first job's proposals so the report can say the review path works, not only the
 * accept path. */
export interface ReviewReport {
	accepted: number;
	acceptFailures: Array<{ name: string; kind: string; error: string }>;
	rejected: number;
	undone: number;
	revisionsAfterAccept: number;
	authorKinds: Record<string, number>;
}

async function exerciseReview(
	db: Db,
	universeId: string,
	jobId: string,
	userId: string,
	sourceSystem: string
): Promise<ReviewReport> {
	const pending = await db
		.select({ id: proposal.id, kind: proposal.kind, evidence: proposal.evidence })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(and(eq(proposalPlan.importJobId, jobId), eq(proposal.outcome, 'pending')));

	// Reject the last one, so the accept path and the reject path are both exercised on the
	// same job, and one accepted proposal is then undone.
	const toReject = pending.at(-1);
	let rejected = 0;
	if (toReject) {
		await rejectProposal(db, { proposalId: toReject.id, reason: 'not mine', decidedBy: userId });
		rejected = 1;
	}

	const sweep = await acceptAll(db, jobId, userId, sourceSystem);

	const acceptedRows = await db
		.select({ id: proposal.id })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(and(eq(proposalPlan.importJobId, jobId), eq(proposal.outcome, 'accepted')));
	let undone = 0;
	const toUndo = acceptedRows[0];
	if (toUndo) {
		await undoAcceptedProposal(db, { proposalId: toUndo.id });
		undone = 1;
	}

	const revisions = await db
		.select({ authorKind: revision.authorKind })
		.from(revision)
		.where(eq(revision.universeId, universeId));
	const authorKinds: Record<string, number> = {};
	for (const row of revisions) authorKinds[row.authorKind] = (authorKinds[row.authorKind] ?? 0) + 1;

	return {
		accepted: sweep.accepted,
		acceptFailures: sweep.failures,
		rejected,
		undone,
		revisionsAfterAccept: revisions.length,
		authorKinds
	};
}

export interface ImportE2EReport {
	ranAt: string;
	cheapModel: string;
	premiumModel: string;
	sources: SourceReport[];
	review: ReviewReport | null;
	missingInSource: string[];
	conflicts: Array<{ entity: string; field: string }>;
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	const only = process.argv.slice(2).reduce<string[]>((acc, arg, i, all) => {
		if (arg === '--source' && all[i + 1]) acc.push(all[i + 1]!);
		return acc;
	}, []);

	const db = createDb(url, { max: 4, quiet: true });
	const report: ImportE2EReport = {
		ranAt: new Date().toISOString(),
		cheapModel: '',
		premiumModel: '',
		sources: [],
		review: null,
		missingInSource: [],
		conflicts: []
	};

	try {
		const fixture = await benchFixture(db);
		await topUpCredits(db);
		const cheap = await resolveModel(db, 'cheap');
		const premium = await resolveModel(db, 'premium');
		report.cheapModel = `${cheap.provider}/${cheap.modelId}`;
		report.premiumModel = `${premium.provider}/${premium.modelId}`;

		const sources =
			only.length > 0
				? only
				: ['obsidian', 'kanka', 'world-anvil', 'pdf', 'docx', 'generic', 'onenote'];

		for (const source of sources) {
			const v1 = await readManifest(source, 'v1');
			const v2 = await readManifest(source, 'v2');
			// One universe per source rather than one universe cleared between sources. The
			// first version did the latter and destroyed its own evidence: `proposal`'s
			// foreign key to `entity` is ON DELETE CASCADE, so emptying the world took every
			// update and relation proposal with it and left a report nobody could audit
			// afterwards.
			const universeId = await universeForSource(db, fixture.userId, source);

			const documentsV1: JobDocument[] = v1.documents.map((d, i) => ({
				id: `doc-${i + 1}`,
				sourcePath: d.sourcePath
			}));
			const documentsV2: JobDocument[] = v2.documents.map((d, i) => ({
				id: `doc-${i + 1}`,
				sourcePath: d.sourcePath
			}));

			const first = await runOne({
				db,
				universeId,
				userId: fixture.userId,
				source,
				revision: 'v1',
				documents: documentsV1,
				playbookId: v1.playbook
			});

			// Accept everything before re-importing: `entity_source_ref` is written on accept,
			// and it is what the second run matches on.
			const acceptedFirst = await acceptAll(db, first.jobId, fixture.userId, source);

			const second = await runOne({
				db,
				universeId,
				userId: fixture.userId,
				source,
				revision: 'v1',
				documents: documentsV1,
				playbookId: v1.playbook
			});

			const changed = await runOne({
				db,
				universeId,
				userId: fixture.userId,
				source,
				revision: 'v2',
				documents: documentsV2,
				playbookId: v2.playbook
			});

			const notes: string[] = [
				`accepted ${acceptedFirst.accepted} of ${first.proposalsEmitted} on the first run`
			];
			for (const failure of acceptedFirst.failures.slice(0, 6)) {
				notes.push(`accept refused ${failure.kind} "${failure.name}": ${failure.error}`);
			}
			if (acceptedFirst.failures.length > 6) {
				notes.push(
					`and ${acceptedFirst.failures.length - 6} more accept refusals of the same shape`
				);
			}
			report.sources.push({
				source,
				playbook: v1.playbook,
				documents: documentsV1.length,
				first,
				second,
				changed,
				idempotent: second.proposalsEmitted === 0,
				notes
			});

			// Whichever source runs first, so a run scoped to one source still exercises the
			// review path rather than silently skipping it.
			if (report.review === null) {
				report.review = await exerciseReview(db, universeId, changed.jobId, fixture.userId, source);
			}
		}

		const missing = await db
			.select({ entityId: entitySourceRef.entityId })
			.from(entitySourceRef)
			.where(eq(entitySourceRef.missingInSource, true));
		report.missingInSource = missing.map((m) => m.entityId);
		report.conflicts = CHANGE_MANIFEST.changedAtSource.map((slug) => ({
			entity: slug,
			field: 'body'
		}));
	} finally {
		await closeDb(db);
	}

	mkdirSync(dataDir, { recursive: true });
	const file = path.join(dataDir, 'import-e2e.json');
	writeFileSync(file, JSON.stringify(report, null, '\t'));

	for (const s of report.sources) {
		console.log(
			`${s.source.padEnd(12)} ${String(s.documents).padStart(3)} docs  ` +
				`first ${String(s.first.proposalsEmitted).padStart(3)} proposals in ${s.first.seconds.toFixed(0)}s  ` +
				`second ${String(s.second.proposalsEmitted).padStart(3)} ${s.idempotent ? 'IDEMPOTENT' : 'NOT IDEMPOTENT'}  ` +
				`changed ${String(s.changed.proposalsEmitted).padStart(3)}`
		);
	}
	console.log(`\nwritten to ${file}`);
}

await main();
