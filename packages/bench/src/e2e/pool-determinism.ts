/**
 * Issue #627: the merge engine's candidate pools took an unordered `LIMIT 200`, so which
 * candidates a large job scored against was whatever the heap happened to hold, and the
 * fold decisions that followed were neither reproducible nor complete.
 *
 * `onenote-relations.ts` is the harness that found it, and it cannot answer it: its corpus
 * is a third party's private notebook, passed in by path, and the recording lives on the
 * box that made it. This one needs neither, because nothing about the defect involves a
 * model. **The driver here is scripted, not recorded**: it yields a fixed stream of entity
 * sightings, the same bytes on every run, and the similarity scorer is
 * `lexicalTrigramSimilarity`, which is what CI and a box with no credentials already
 * resolve to. So it costs nothing, reaches no gateway, and the only thing that can move
 * its numbers is the code under test, which is the property the recorded replay was for.
 *
 *   DATABASE_URL=postgres://canonry:canonry@127.0.0.1:55432/canonry_w627_e2e \
 *     pnpm --filter @canonry/bench pool-determinism
 *
 * **The notebook it imitates.** 90 documents, 5 sightings each, 450 in total. Four of the
 * five are new entities; the fifth names an entity the *previous* document introduced, by
 * the same name, which is the shape a page hierarchy produces and the case issue #160's
 * pending pool exists for. A repeat sighting has to fold into that still-pending `create`
 * rather than write a second one, and whether it can depends entirely on whether the pool
 * it is scored against still holds the proposal it should fold into.
 *
 * **What to read in the output.** `creates` is the count that moved between two replays of
 * byte-identical model output on the real notebook, 383 and then 386. `folds` is the same
 * number seen from the other side. `truncatedPools` is issue #627's own addition: how many
 * sightings were decided against a pool the cap cut short, which is zero for a job that
 * fits under it and was invisible before.
 */
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { closeDb, createDb, createImportJob, admitImportJob, type Db } from '@canonry/db';
import {
	operationPrice,
	proposal,
	proposalPlan,
	universe,
	user,
	userBilling
} from '@canonry/db/schema';
import { hashingEmbedder } from '@canonry/indexing';
import {
	ImportJobRunner,
	InMemoryImageStore,
	InMemorySourceReader,
	lexicalTrigramSimilarity,
	loadBuiltinPlaybook,
	MATCH_THRESHOLDS,
	type ImportDriver,
	type ImportJob,
	type JobDocument,
	type JobEvent,
	type JobStream
} from '@canonry/import';
import { loadEnv, requireEnv } from '../env.js';

const DOCUMENTS = 90;
const NEW_PER_DOCUMENT = 4;
const TYPES = ['character', 'place', 'faction', 'item', 'event', 'session'] as const;

interface Sighting {
	localId: string;
	type: (typeof TYPES)[number];
	name: string;
}

/** A name no other name in this corpus shares trigrams with, derived from the entity's
 * index so it is the same string on every run. Gibberish on purpose: the lexical scorer this
 * harness runs with is character-trigram Jaccard at 0.85/0.50, so "Thornwick 0001 of
 * Saltmere" and "Thornwick 0011 of Saltmere" score near 1 and fold into each other, and the
 * harness would be measuring its own name generator rather than the pool. Two distinct names
 * here score under 0.1, so every fold this run reports is a repeat sighting and nothing
 * else. */
function distinctName(n: number): string {
	const digest = createHash('sha256').update(`canonry-627-${n}`).digest('hex');
	const letters = [...digest.slice(0, 14)].map((c) => 'bcdfghjklmnpqrstv'[parseInt(c, 16)]!);
	const vowels = [...digest.slice(14, 28)].map((c) => 'aeiouy'[parseInt(c, 16) % 6]!);
	const word = letters.map((l, i) => `${l}${vowels[i] ?? 'a'}`).join('');
	return word[0]!.toUpperCase() + word.slice(1);
}

/** The scripted notebook. Deterministic in every field, so two runs are the same input in
 * the strict sense: the same names, the same order, the same spans. */
function notebook(): {
	documents: JobDocument[];
	sightings: Map<string, Sighting[]>;
	text: Record<string, string>;
} {
	const documents: JobDocument[] = [];
	const sightings = new Map<string, Sighting[]>();
	const text: Record<string, string> = {};
	let n = 0;
	for (let d = 0; d < DOCUMENTS; d += 1) {
		const path = `pages/page-${String(d).padStart(3, '0')}.md`;
		documents.push({ id: `doc-${d}`, sourcePath: path });
		const own: Sighting[] = [];
		for (let i = 0; i < NEW_PER_DOCUMENT; i += 1) {
			own.push({ localId: `e${n}`, type: TYPES[n % TYPES.length]!, name: distinctName(n) });
			n += 1;
		}
		// The repeat sighting: the first entity the previous page introduced, named exactly as
		// it was named there. Nothing about it is ambiguous, which is the point - if it does
		// not fold, no threshold is to blame.
		const previous = d > 0 ? sightings.get(`doc-${d - 1}`)![0]! : null;
		if (previous) own.push({ localId: 'repeat', type: previous.type, name: previous.name });
		sightings.set(`doc-${d}`, own);
		text[path] = own
			.map((s) => `${s.name} is written about at length on this page, in this sentence.`)
			.join('\n\n');
	}
	return { documents, sightings, text };
}

/** Yields the scripted stream. No model, no gateway, no recording to keep in step. */
class ScriptedDriver implements ImportDriver {
	constructor(
		private readonly sightings: Map<string, Sighting[]>,
		private readonly text: Record<string, string>
	) {}

	startJob(job: ImportJob): JobStream {
		const { sightings, text } = this;
		async function* stream(): AsyncGenerator<JobEvent> {
			for (const document of job.documents) {
				const own = sightings.get(document.id) ?? [];
				const body = text[document.sourcePath] ?? '';
				for (const sighting of own) {
					const start = body.indexOf(sighting.name);
					yield {
						type: 'proposal',
						jobId: job.id,
						documentId: document.id,
						step: 1,
						proposal: {
							kind: 'entity',
							payload: {
								localId: sighting.localId,
								type: sighting.type,
								name: sighting.name,
								aliases: [],
								summary: `${sighting.name} is written about at length on this page, in this sentence.`,
								sourceRef: { documentId: document.id, path: document.sourcePath },
								evidenceSpan: {
									start: Math.max(start, 0),
									end: Math.max(start, 0) + sighting.name.length + 60
								},
								images: [],
								language: 'en'
							}
						}
					};
				}
				yield {
					type: 'progress',
					jobId: job.id,
					documentId: document.id,
					step: 1,
					status: 'finished',
					entityCount: own.length,
					relationCount: 0,
					detail: 'done'
				};
			}
		}
		const iterable = stream();
		return Object.assign(iterable, { jobId: job.id });
	}

	async cancel(): Promise<void> {}
}

interface RunReport {
	label: string;
	creates: number;
	folds: number;
	truncatedPools: number;
	documentsWithTruncatedPool: number;
	seconds: number;
}

async function runOnce(db: Db, label: string): Promise<RunReport> {
	const userId = `pool-determinism-${randomUUID()}`;
	await db.insert(user).values({
		id: userId,
		name: 'pool determinism',
		email: `${userId}@canonry.invalid`,
		emailVerified: true
	});
	await db
		.insert(userBilling)
		.values([{ userId, subscriptionCredits: 1_000_000 }])
		.onConflictDoNothing({ target: userBilling.userId });
	const [universeRow] = await db
		.insert(universe)
		.values({
			ownerUserId: userId,
			name: 'Pool determinism',
			slug: `pool-determinism-${randomUUID()}`,
			kind: 'homebrew'
		})
		.returning();

	const { documents, sightings, text } = notebook();
	const playbook = await loadBuiltinPlaybook('onenote');
	const job = await createImportJob(db, {
		universeId: universeRow!.id,
		createdBy: userId,
		sourceType: 'onenote',
		playbook: playbook.id,
		playbookVersion: playbook.version,
		artefactPath: `scripted://${label}`,
		artefactBytes: 0,
		artefactSha256: '0'.repeat(64),
		documentCount: documents.length,
		budgetCredits: 1_000_000
	});
	const admitted = await admitImportJob(db, job.id, 50);
	if (!admitted.admitted) throw new Error('job was not admitted');

	const started = Date.now();
	const result = await new ImportJobRunner().run({
		db,
		driver: new ScriptedDriver(sightings, text),
		dbJobId: job.id,
		universeId: universeRow!.id,
		sourceSystem: 'onenote',
		userId,
		playbook,
		documents,
		sources: new InMemorySourceReader({ files: text }),
		images: new InMemoryImageStore(),
		budget: { maxCredits: 1_000_000 },
		similarity: lexicalTrigramSimilarity,
		thresholds: MATCH_THRESHOLDS,
		embedRelationLabel: hashingEmbedder,
		timeoutMs: 30 * 60 * 1000
	});
	const seconds = (Date.now() - started) / 1000;

	const [creates] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposalPlan.id, proposal.planId))
		.where(sql`${proposalPlan.importJobId} = ${job.id} and ${proposal.kind} = 'create'`);
	const [folded] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposalPlan.id, proposal.planId))
		.where(
			sql`${proposalPlan.importJobId} = ${job.id} and jsonb_array_length(coalesce(${proposal.evidence}->'foldedSources', '[]'::jsonb)) > 0`
		);

	// `truncatedPools` is #627's own field, and it does not exist before the fix, so read it
	// defensively: this harness has to run against both sides to be worth anything.
	const outcomes = result.documents as Array<{ truncatedPools?: number }>;
	return {
		label,
		creates: creates!.n,
		folds: folded!.n,
		truncatedPools: outcomes.reduce((sum, d) => sum + (d.truncatedPools ?? 0), 0),
		documentsWithTruncatedPool: outcomes.filter((d) => (d.truncatedPools ?? 0) > 0).length,
		seconds: Math.round(seconds * 10) / 10
	};
}

/** Leaves `proposal` with free space scattered through it rather than a heap that reads in
 * insertion order. Deliberately crude: a batch of rows written, deleted and vacuumed away is
 * the cheapest thing that makes the next writer's rows land out of order. */
async function perturbHeap(db: Db): Promise<void> {
	const userId = `pool-filler-${randomUUID()}`;
	await db.insert(user).values({
		id: userId,
		name: 'filler',
		email: `${userId}@canonry.invalid`,
		emailVerified: true
	});
	const [universeRow] = await db
		.insert(universe)
		.values({
			ownerUserId: userId,
			name: 'Filler',
			slug: `pool-filler-${randomUUID()}`,
			kind: 'homebrew'
		})
		.returning();
	const [plan] = await db
		.insert(proposalPlan)
		.values({ universeId: universeRow!.id, trigger: 'import', summary: 'filler' })
		.returning();
	for (let batch = 0; batch < 8; batch += 1) {
		await db.insert(proposal).values(
			Array.from({ length: 500 }, (_, i) => ({
				universeId: universeRow!.id,
				planId: plan!.id,
				trigger: 'import' as const,
				kind: 'create' as const,
				patch: { type: 'character', name: `Filler ${batch}-${i}`, slug: `filler-${batch}-${i}` },
				rank: i
			}))
		);
	}
	await db.delete(proposal).where(eq(proposal.planId, plan!.id));
	await db.execute(sql`vacuum proposal`);
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	const db = createDb(url, { max: 4, quiet: true });
	try {
		await db
			.insert(operationPrice)
			.values({
				operation: 'import.document',
				label: 'Import extraction per document',
				credits: 1,
				kind: 'import'
			})
			.onConflictDoNothing({ target: operationPrice.operation });

		const reports: RunReport[] = [];
		// Twice, into two fresh universes, off the identical scripted stream. Equal counts is
		// the property under test.
		reports.push(await runOnce(db, 'run-a'));
		// And the second run under the one condition that separated the two replays on the real
		// notebook: a `proposal` table whose physical layout is not the order things were
		// written in. On the notebook that came from the run's own churn (126 vocabulary
		// proposals written while it went, autovacuum reclaiming space behind it over 45
		// minutes); here it is produced deliberately, by filling the table and emptying it
		// again so this run's rows land in reclaimed pages rather than at the end. Nothing
		// about the input changes, and an unordered `LIMIT` is the only thing that can notice.
		await perturbHeap(db);
		reports.push(await runOnce(db, 'run-b-perturbed-heap'));
		const expectedSightings = DOCUMENTS * NEW_PER_DOCUMENT + (DOCUMENTS - 1);
		console.log(
			JSON.stringify(
				{
					documents: DOCUMENTS,
					sightings: expectedSightings,
					distinctEntities: DOCUMENTS * NEW_PER_DOCUMENT,
					repeatSightings: DOCUMENTS - 1,
					runs: reports,
					reproducible: reports[0]!.creates === reports[1]!.creates,
					// One create per distinct entity and not one more is the whole of issue #160:
					// every repeat sighting folded into the proposal it should have.
					allRepeatsFolded: reports.every((r) => r.creates === DOCUMENTS * NEW_PER_DOCUMENT)
				},
				null,
				2
			)
		);
	} finally {
		await closeDb(db);
	}
}

await main();
