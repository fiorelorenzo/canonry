/**
 * How often `AUDIT_PAIR_CAP` actually binds (issue #278).
 *
 *   pnpm --filter @canonry/bench audit-pairs
 *   pnpm --filter @canonry/bench audit-pairs -- --vault=../../.data/corpus/valdris
 *
 * `packages/copilot/src/audit.ts` caps one audit run at five candidate pairs, and that
 * five is a reading of SPEC.md §5.2's "at most a handful of flags" rather than a
 * measurement. Two questions sit behind it. Whether a GM stops finding flags useful above
 * or below five needs accept and dismiss outcomes keyed by a flag's position in its run,
 * which is instrumentation (`auditFlagOutcomes` in `packages/db`, and the panel on
 * `/admin/metrics`) and not a number anyone can produce today. Whether the search even
 * finds five pairs to cap is measurable right now, deterministically, with no model call
 * and no gateway credential: run `findCandidatePairs` uncapped over real worlds and count.
 *
 * That is all this file does. It needs a database only because a real universe's graph
 * lives in one, and `--vault` adds a second, larger world read straight off disk as an
 * in-memory graph, since the question is about the body text and the mention density, not
 * about anything Postgres holds.
 *
 * The edit shape matters and the report gives both. A GM's ordinary save changes one
 * sentence, so the per-sentence distribution is the realistic one; writing a whole entry
 * from scratch changes all of them at once, which is the ceiling. If the cap does not bind
 * on either, it is not costing anything and the number is moot until universes grow.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb, createDb, type Db } from '@canonry/db';
import {
	AUDIT_PAIR_CAP,
	findCandidatePairs,
	loadCandidateGraph,
	splitIntoSentences,
	type CandidateGraph,
	type FactChange,
	type GraphEntity
} from '@canonry/copilot';
import { dataDir, loadEnv, requireEnv } from './env.js';
import { benchFixture } from './fixture.js';
import { seedWorld } from './corpus/seed.js';
import { worldV1 } from './corpus/valdoria-reach.js';
import { VaultWikiClient } from './corpus/vault.js';

/** Caps worth pricing against the measured distribution: everything from "one flag a run"
 * up to twice the shipped number. */
const CAP_CANDIDATES = [1, 2, 3, 4, 5, 6, 8, 10];

export interface PairDistribution {
	/** How many simulated edits went into this distribution. */
	edits: number;
	mean: number;
	median: number;
	p90: number;
	max: number;
	/** Share of edits that found no pair at all, so audit stays silent without spending. */
	shareZero: number;
	/** Share of edits the shipped cap turned pairs away from. */
	shareAtOrOverCap: number;
	/** Share of edits each candidate cap would have trimmed, keyed by the cap. */
	shareTrimmedByCap: Record<number, number>;
}

export interface WorldPairReport {
	world: string;
	entities: number;
	/** Sentences across every body, which is how many single-sentence edits the world admits
	 * in total. `perSentenceEdit.edits` is how many of them were actually simulated. */
	sentences: number;
	perSentenceEdit: PairDistribution;
	wholeEntryEdit: PairDistribution;
}

export interface AuditPairsReport {
	ranAt: string;
	shippedCap: number;
	worlds: WorldPairReport[];
}

function distribution(counts: number[]): PairDistribution {
	const sorted = [...counts].sort((a, b) => a - b);
	const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
	const shareTrimmedByCap: Record<number, number> = {};
	for (const cap of CAP_CANDIDATES) {
		shareTrimmedByCap[cap] = counts.filter((c) => c > cap).length / counts.length;
	}
	return {
		edits: counts.length,
		mean: counts.reduce((sum, c) => sum + c, 0) / counts.length,
		median: at(0.5),
		p90: at(0.9),
		max: sorted[sorted.length - 1] ?? 0,
		shareZero: counts.filter((c) => c === 0).length / counts.length,
		shareAtOrOverCap: counts.filter((c) => c >= AUDIT_PAIR_CAP).length / counts.length,
		shareTrimmedByCap
	};
}

/** Every pair the search would offer, with the cap removed. `runAudit` calls the same
 * function with the cap in place; nothing here is a reimplementation of it. */
function uncappedPairs(graph: CandidateGraph, edited: GraphEntity, diff: FactChange[]): number {
	return findCandidatePairs(graph, edited, edited.body, diff, Number.POSITIVE_INFINITY).length;
}

/**
 * Sentences to simulate a single-sentence edit on, per entry: every `ceil(total / cap)`-th
 * one, so the sample is spread across the whole body rather than clustered at the top, and
 * is the same on every run.
 *
 * A cap is needed because the uncapped search is quadratic in the world's prose - one call
 * against a 78-entry vault takes about 40 ms, and that vault has 9768 sentences, so the
 * exhaustive version is six minutes of one measurement. The distribution is what matters
 * here, not the exact count of edits, and it is reported alongside the sample size.
 */
function sampledSentences(sentences: string[], perEntry: number): string[] {
	if (sentences.length <= perEntry) return sentences;
	const step = Math.ceil(sentences.length / perEntry);
	return sentences.filter((_, index) => index % step === 0);
}

function measure(world: string, graph: CandidateGraph, perEntry: number): WorldPairReport {
	const perSentence: number[] = [];
	const wholeEntry: number[] = [];
	let sentences = 0;

	for (const edited of graph.entities) {
		const bodySentences = splitIntoSentences(edited.body);
		sentences += bodySentences.length;
		for (const sentence of sampledSentences(bodySentences, perEntry)) {
			perSentence.push(uncappedPairs(graph, edited, [{ kind: 'added', statement: sentence }]));
		}
		wholeEntry.push(
			uncappedPairs(
				graph,
				edited,
				bodySentences.map((statement) => ({ kind: 'added' as const, statement }))
			)
		);
	}

	return {
		world,
		entities: graph.entities.length,
		sentences,
		perSentenceEdit: distribution(perSentence),
		wholeEntryEdit: distribution(wholeEntry)
	};
}

/** The vault as the graph audit would see for a universe of that many entries: one entity
 * per note, the note's own prose as its body. No relations, which is the conservative
 * direction - `findCandidatePairs` reads mentions only, so relations would not add a pair. */
function vaultGraph(dir: string): CandidateGraph {
	const client = new VaultWikiClient({ dir, urlBase: 'https://valdris.example/wiki' });
	return {
		entities: client.all().map((page, index) => ({
			id: `vault-${index}`,
			type: 'note',
			name: page.title,
			aliases: [],
			body: page.wikitext,
			language: 'en'
		})),
		relations: []
	};
}

function printDistribution(label: string, d: PairDistribution): void {
	console.log(
		`  ${label.padEnd(16)} n=${d.edits.toString().padStart(5)}  mean ${d.mean.toFixed(2)}  ` +
			`median ${d.median}  p90 ${d.p90}  max ${d.max}  none ${(d.shareZero * 100).toFixed(1)}%  ` +
			`>=cap ${(d.shareAtOrOverCap * 100).toFixed(1)}%`
	);
	console.log(
		`  ${' '.repeat(16)} trimmed by cap: ` +
			CAP_CANDIDATES.map(
				(cap) => `${cap}:${((d.shareTrimmedByCap[cap] ?? 0) * 100).toFixed(1)}%`
			).join('  ')
	);
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}

	const argv = process.argv.slice(2);
	const vaultDir = argv.find((arg) => arg.startsWith('--vault='))?.slice('--vault='.length);
	const sampleArg = argv.find((arg) => /^--sample=\d+$/.test(arg));
	const perEntry = sampleArg === undefined ? 20 : Number(sampleArg.slice('--sample='.length));

	const db: Db = createDb(url, { max: 4, quiet: true });
	const worlds: WorldPairReport[] = [];
	try {
		const fixture = await benchFixture(db);
		await seedWorld(db, fixture.universeId, worldV1);
		worlds.push(
			measure(
				'Valdoria Reach (bench canon)',
				await loadCandidateGraph(db, fixture.universeId),
				perEntry
			)
		);
	} finally {
		await closeDb(db);
	}

	if (vaultDir !== undefined) {
		worlds.push(measure('Valdris (community vault)', vaultGraph(vaultDir), perEntry));
	}

	const report: AuditPairsReport = {
		ranAt: new Date().toISOString(),
		shippedCap: AUDIT_PAIR_CAP,
		worlds
	};
	mkdirSync(dataDir, { recursive: true });
	const file = path.join(dataDir, 'audit-pairs.json');
	writeFileSync(file, JSON.stringify(report, null, '\t'));

	console.log(`shipped AUDIT_PAIR_CAP = ${AUDIT_PAIR_CAP}\n`);
	for (const world of worlds) {
		console.log(`${world.world}: ${world.entities} entities, ${world.sentences} sentences`);
		printDistribution('one sentence', world.perSentenceEdit);
		printDistribution('whole entry', world.wholeEntryEdit);
		console.log('');
	}
	console.log(`written to ${file}`);
}

await main();
