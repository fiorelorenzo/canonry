/**
 * Issue #641: should the committed-canon candidate pool keep the alphabetically first 200,
 * or the 200 most likely to be the right answer?
 *
 * #627 made `candidateEntitiesForMatching` order by `entity.slug` and said plainly what that
 * ordering is: reproducible and deliberately arbitrary with respect to matching. It picked
 * slug on cost, because `entity_universe_slug_key` is `(universe_id, slug)` so the index
 * serves the order and the read stops at the cap, while every ordering with a claim to
 * relevance it measured turned that into a full scan of the universe plus a top-N sort. This
 * runner answers the question that left open, in the three parts the issue asks for.
 *
 *   DATABASE_URL=postgres://canonry:canonry@127.0.0.1:55432/canonry_w641_bench \
 *     pnpm --filter @canonry/bench pool-ordering
 *
 * `--scorer lexical` runs without a gateway credential and measures nothing useful about the
 * orderings (see below); the default is `both`, which needs `AI_GATEWAY_API_KEY`.
 *
 * ### Part 1: when the caps bite, measured on the real schema
 *
 * `candidateEntitiesForMatching` filters to one type in SQL, so the 200 cap is 200 entities
 * *of one type in one universe*. What universe size that is depends on the type mix, and this
 * repo has three corpora that state one, so the run reports the size at which the busiest
 * type crosses each cap under each of them rather than picking a mix.
 *
 * There are two caps, and only one of them is in SQL. `resolveMatch` narrows the pool with
 * `preFilterCandidates` to 20 before any similarity call, and that function sorts by name
 * overlap and **breaks ties on the input order**. So among candidates whose name and alias
 * tokens overlap the subject's equally - which for a subject sharing no token with anything
 * is all of them - the SQL `ORDER BY` decides which 20 get scored. The effective cap is
 * therefore 20 of one type, an order of magnitude below the 200 #627 was reasoning about.
 *
 * ### Part 2: the orderings over the labelled corpus
 *
 * `runPoolOrderingBenchmark` (`packages/import/src/matching-benchmark.ts`) scores a pool
 * rather than a scorer: it hands each corpus subject the page one ordering produced, runs the
 * product's own `resolveMatch` over it, and counts the false merges and false splits the
 * ordering caused. This runner supplies the pools from a real Postgres universe holding the
 * corpus's candidates plus filler, so the ordering under test is the SQL one and not a
 * re-implementation of it.
 *
 * Three of the four orderings are SQL. The fourth, `embedding-distance` (issue #679), is the
 * only one the pre-filter is not blind to, and it needs a gateway credential because it ranks
 * by cosine of the same `matchTextFor` text the scorer embeds: it is skipped under
 * `--scorer=lexical`, where the other three still reproduce #641's own table for free. It
 * also reports an exposure line the other three do not need, because "no new false merge"
 * only means something next to how close the invented filler came to winning.
 *
 * ### Part 3: the plan cost of each ordering, at #627's own universe size
 *
 * `EXPLAIN (ANALYZE, BUFFERS)` on 3000 entities, which is what #627 measured, plus the two
 * `pg_trgm` index shapes a proximity ordering would need. Quality without the plan cost next
 * to it is half an answer.
 *
 * ### Part 4: is 20 the right pre-filter limit? (issue #666)
 *
 * Part 1 found that the cap which actually decides is the pre-filter's, so #666 asked the
 * obvious next question: should it be larger. `--pre-filter=20,40,...` sweeps it under the
 * production `slug` ordering and reports, per limit, how many true candidates never reached
 * the scorer and what the limit costs. The cost is two numbers and they are not the same
 * number: `sim calls` is one cosine per candidate scored, which is arithmetic, and `texts`
 * is the distinct texts an embedding scorer would have to embed, which is the euro. They
 * diverge because `createEmbeddingSimilarity` caches per text for the life of the job
 * (`embedding-similarity.ts`), so a candidate the pre-filter admits for the tenth sighting
 * is free and a candidate it admits for the first time is not. SPEC.md §15 puts embeddings
 * outside the user's quota, so the second number is our margin rather than the GM's credits,
 * and §11.5 is where it lands.
 *
 * ### What it answered, on 2026-08-24
 *
 * No. Not because proximity is slow, which was the expectation: `name <-> $1` against a
 * multicolumn GiST on `(universe_id, type, name gist_trgm_ops)` is an index scan at 198
 * buffers and 0.88ms on a 3000-entity six-type universe, against the slug query's own 1158
 * and 0.53ms. It is because the pool order only decides candidates that share no name or
 * alias token with the subject, since `preFilterCandidates` ranks everything that shares one
 * above everything that shares none, and a candidate sharing no token shares no trigram
 * either. In the corpus those candidates are the translated names, which is SPEC.md §6.4's
 * own example of what string normalisation cannot do. At 209 entities of one type slug loses
 * two of the nine true candidates and trigram proximity one; at 1009 slug loses six and
 * trigram proximity two.
 *
 * Two by-products worth more than the ordering. The effective cap is the pre-filter's 20 and
 * not the SQL 200, which one type reaches at 69 to 121 entries, so a run reporting
 * `truncatedPools: 0` can still have decided every sighting on 20 alphabetically chosen
 * candidates. And an ordering that falls back to a sequential scan reads every row of
 * `entity` in every universe, so its cost grows with the deployment and not with the
 * universe, which is worse than #627's write-up of the same measurement says.
 *
 * ### And what part 4 answered, on 2026-08-24 (issue #666)
 *
 * 20 stays. The narrowing is not free: on the `hardest` wording, from 59 entities of one type
 * upwards, the window loses the corpus's two translated names, and under the production
 * embedding scorer recovering them turns two false splits into one match and one question
 * with no new false merge, weighted 14 down to 12. But the limit that recovers scales with
 * the type's population, about half of it (30 at 59, 60 at 109, 120 at 189, 100 at 209), so
 * no constant is the fix, and past 200 of one type the SQL cap has already dropped the
 * candidate and no limit reaches it. Under the lexical scorer the weighted cost does not move
 * at any limit at any size, which is worth knowing before reading a CI run as evidence about
 * this number. `DEFAULT_PRE_FILTER_LIMIT`'s own comment carries the table and the decision;
 * #679 is the ordering that would make the question moot.
 *
 * ### And what the fourth ordering answered, on 2026-08-24 (issue #679)
 *
 * The measurement says yes and the plumbing says not yet, so the pool still orders by `slug`
 * and nothing in production changed here either.
 *
 * On the numbers it is not close. `embedding-distance` scores `unscored: 0` at 29, 209 and
 * 1009 entities of one type, on both wordings and under both scorers, where slug loses two
 * at 209 and six at 1009; and its weighted cost at 1009 is its cost at 29 (6 and 12 under
 * the embedding scorer, 17 and 25 under the lexical one), so it is the only ordering that
 * removes the pool size from the answer rather than delaying it. The false-merge column,
 * which is the column #679 says decides this, does not move: 1 easiest and 2 hardest at
 * every size, the corpus's own traps and no new one, even though the ordering hands the
 * scorer the argmax of a 1009-row population instead of a 20-row window. The exposure line
 * is why that reads as a result rather than as a fixture that cannot see the risk: the best
 * cosine any invented filler reached against any subject is 0.458 at 29 of a type, 0.518 at
 * 209 and 0.528 at 1009, against a `newBelow` of 0.60, so no filler was ever even in the
 * band. It grows the way the maximum of N draws grows, about 0.07 per 35x of population,
 * and the filler carries a name and a type where a real entity carries three lines, so
 * treat that margin as an order of magnitude and not as a bound.
 *
 * What stopped it is that the vector it ranks by does not exist. `indexEntity` embeds an
 * entity's *body*, in chunks, under a payload with no entity type; the only caller that
 * schedules that work is a human editor save, so an entity an import created has no vector
 * at all; an entity with an empty body chunks to nothing and has none either; and half the
 * pool during an import job is `pendingEntityProposalsForJob`, rows in `proposal` that are
 * not entities and were never indexed, which is the half #681 measured doing the narrowing
 * on a real 90-document job. So this arm measures the ceiling on purpose: an exact cosine
 * over every vector, which an ANN index can only lose recall against, over a text no
 * collection currently holds. Three decisions follow and they are on the issue.
 */
import { randomUUID } from 'node:crypto';
import { embedMany } from 'ai';
import type { SQL } from 'drizzle-orm';
import { candidateEntitiesForMatching, closeDb, createDb, sql, type Db } from '@canonry/db';
import { entity, universe, user, type EntityType } from '@canonry/db/schema';
import { createEmbeddingModel, readGatewayCredentials, resolveModel } from '@canonry/ai';
import { embeddingDimensionsFor } from '@canonry/indexing';
import {
	DEFAULT_PRE_FILTER_LIMIT,
	matchTextFor,
	nameOverlapScore,
	oneLineSummary,
	EMBEDDING_MATCH_THRESHOLDS,
	MATCH_THRESHOLDS,
	cosineSimilarity,
	createEmbeddingSimilarity,
	lexicalTrigramSimilarity,
	poolSubjectsFromCorpus,
	runPoolOrderingBenchmark,
	SAMPLE_WORLD_MATCHING_CORPUS,
	type MatchCandidate,
	type MatchSubject,
	type MatchThresholds,
	type OrderedPool,
	type SimilarityFn
} from '@canonry/import';
import { slugify } from './corpus/slug.js';
import { loadEnv, requireEnv } from './env.js';

const TYPES: EntityType[] = ['character', 'place', 'faction', 'item', 'event', 'session'];

/** The SQL cap `candidateEntitiesForMatching` ships with. The pre-filter cap comes from the
 * product itself (`DEFAULT_PRE_FILTER_LIMIT`) rather than being restated here, because part
 * 4 exists to defend that number and a copy of it could drift away from the one that runs. */
const POOL_LIMIT = 200;
const PRE_FILTER_LIMIT = DEFAULT_PRE_FILTER_LIMIT;

/** #627's own measurement size, so the plan numbers here are comparable to the ones in
 * `candidateEntitiesForMatching`'s doc comment. */
const PLAN_UNIVERSE_SIZE = 3000;

const FALSE_MERGE_WEIGHT = 5;

// ---------------------------------------------------------------------------
// Part 1: the type mixes this repo has data for.
// ---------------------------------------------------------------------------

interface TypeMix {
	id: string;
	note: string;
	weights: Record<EntityType, number>;
}

const MIXES: TypeMix[] = [
	{
		id: 'seed-fixture',
		note: 'packages/db/src/seed-fixture.ts, 20 entities',
		weights: { character: 6, place: 5, faction: 4, session: 3, item: 1, event: 1 }
	},
	{
		id: 'valdoria-reach',
		note: 'packages/bench/src/corpus/valdoria-reach.ts, 36 entities',
		weights: { place: 9, character: 9, session: 5, item: 5, faction: 5, event: 3 }
	},
	{
		id: 'notebook-uniform',
		note: 'the OneNote notebook of #627, 6 types round robin, 440 creates',
		weights: { character: 1, place: 1, faction: 1, item: 1, event: 1, session: 1 }
	}
];

/** The mix as a largest-remainder interleave, so every prefix of the sequence holds the mix
 * rather than only the whole of it. */
function typeSequence(weights: Record<EntityType, number>, count: number): EntityType[] {
	const total = TYPES.reduce((sum, t) => sum + weights[t], 0);
	const emitted: Record<string, number> = {};
	for (const t of TYPES) emitted[t] = 0;
	const out: EntityType[] = [];
	for (let n = 1; n <= count; n += 1) {
		let best = TYPES[0]!;
		let bestDebt = -Infinity;
		for (const t of TYPES) {
			const debt = (weights[t] / total) * n - emitted[t]!;
			if (debt > bestDebt) {
				bestDebt = debt;
				best = t;
			}
		}
		emitted[best] = emitted[best]! + 1;
		out.push(best);
	}
	return out;
}

// ---------------------------------------------------------------------------
// The filler universe.
// ---------------------------------------------------------------------------

const ONSETS = [
	'b',
	'br',
	'c',
	'd',
	'dr',
	'f',
	'g',
	'gr',
	'h',
	'j',
	'k',
	'l',
	'm',
	'n',
	'p',
	'r',
	's',
	'st',
	't',
	'th',
	'v',
	'w'
];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ae', 'ea', 'ei', 'or', 'ar'];
const CODAS = ['', 'n', 'r', 'l', 'th', 'st', 'rn', 'ck', 'm', 'nd'];
const SURNAMES = [
	'Ash',
	'Bray',
	'Corr',
	'Dunn',
	'Ellis',
	'Frey',
	'Gorse',
	'Hale',
	'Irvin',
	'Jarrow',
	'Kell',
	'Lowe',
	'Mere',
	'Nash',
	'Orme',
	'Pike',
	'Quill',
	'Rook',
	'Stone',
	'Thorne',
	'Umber',
	'Vale',
	'Wray',
	'Yarrow',
	'Zell'
];

/** A filler name, derived from its index so the whole universe is the same bytes on every
 * run. Deliberately ordinary invented names rather than the gibberish `pool-determinism.ts`
 * uses: this run measures orderings over names, so the names have to be distributed over the
 * alphabet the way a world's names are, and they must not accidentally be near-duplicates of
 * the corpus's own. */
function fillerName(index: number): string {
	const onset = ONSETS[index % ONSETS.length]!;
	const nucleus = NUCLEI[Math.floor(index / ONSETS.length) % NUCLEI.length]!;
	const coda = CODAS[Math.floor(index / (ONSETS.length * NUCLEI.length)) % CODAS.length]!;
	const stem = `${onset}${nucleus}${coda}`;
	const surname = SURNAMES[(index * 7 + 3) % SURNAMES.length]!;
	const head = stem[0]!.toUpperCase() + stem.slice(1);
	return `${head} ${surname}`;
}

interface ScoringUniverse {
	universeId: string;
	/** Row name to the id the corpus labels use. A row the corpus did not contribute is
	 * absent, and `toCandidates` leaves it with its own uuid, which no label names, so a
	 * decision that picks filler counts as a false merge exactly as it should. */
	corpusIdByName: Record<string, string>;
}

async function freshUniverse(db: Db, label: string): Promise<string> {
	const id = `w641-${label}-${randomUUID().slice(0, 8)}`;
	const [owner] = await db
		.insert(user)
		.values({ id, name: 'w641', email: `${id}@canonry.invalid`, emailVerified: true })
		.returning();
	const [row] = await db
		.insert(universe)
		.values({ ownerUserId: owner!.id, name: `w641 ${label}`, slug: id, kind: 'homebrew' })
		.returning();
	return row!.id;
}

/**
 * Which wording of a candidate the universe holds, when the corpus gives one entity several.
 *
 * This is the one place the corpus does not translate straight into a universe and it changes
 * the answer, so it is a parameter rather than a choice made quietly. `inn-gilded-rat` is
 * written "Gilded Rat Tavern" by the `retitle-descriptor` pair and "Il Ratto Dorato" by the
 * `translation` pair, and a real world holds one of the two. Insert both and the subject "the
 * Gilded Rat" shares a token with one of them, which carries it through
 * `preFilterCandidates` and hides exactly the case the pool ordering decides. So each run
 * scores both worlds: `easiest` keeps the wording that shares most tokens with the subject,
 * `hardest` keeps the one that shares fewest, which for three entities here is the Italian
 * name SPEC.md §6.4 uses as its own example.
 */
export type WordingVariant = 'easiest' | 'hardest';

/**
 * The universe the corpus is scored in: one row per corpus candidate under the wording
 * `variant` selects, plus `fillerPerType` invented entities of each type.
 */
async function buildScoringUniverse(
	db: Db,
	fillerPerType: number,
	variant: WordingVariant
): Promise<ScoringUniverse> {
	const universeId = await freshUniverse(db, `score-${variant}-${fillerPerType}`);
	const rows: Array<typeof entity.$inferInsert> = [];
	const corpusIdByName: Record<string, string> = {};
	const takenSlugs = new Set<string>();

	const pushRow = (type: EntityType, name: string, aliases: string[], body: string): void => {
		let slug = slugify(name);
		let n = 1;
		while (takenSlugs.has(slug)) {
			n += 1;
			slug = `${slugify(name)}-${n}`;
		}
		takenSlugs.add(slug);
		rows.push({ universeId, type, name, slug, aliases, body });
	};

	// Every wording the corpus gives each candidate, with the subject it was paired against,
	// so "shares most tokens with the subject" is answerable.
	const wordings = new Map<string, MatchCandidate[]>();
	const subjectFor = new Map<string, MatchSubject>();
	for (const pair of SAMPLE_WORLD_MATCHING_CORPUS.pairs) {
		const list = wordings.get(pair.candidate.id) ?? [];
		if (!list.some((c) => c.name === pair.candidate.name)) {
			list.push(pair.candidate);
			subjectFor.set(`${pair.candidate.id}:${pair.candidate.name}`, pair.subject);
		}
		wordings.set(pair.candidate.id, list);
	}

	for (const [candidateId, list] of wordings) {
		let chosen = list[0]!;
		let chosenOverlap = nameOverlapScore(subjectFor.get(`${candidateId}:${chosen.name}`)!, chosen);
		for (const candidate of list.slice(1)) {
			const overlap = nameOverlapScore(
				subjectFor.get(`${candidateId}:${candidate.name}`)!,
				candidate
			);
			const better = variant === 'easiest' ? overlap > chosenOverlap : overlap < chosenOverlap;
			if (better) {
				chosen = candidate;
				chosenOverlap = overlap;
			}
		}
		corpusIdByName[chosen.name] = candidateId;
		pushRow(
			(chosen.context?.type ?? 'character') as EntityType,
			chosen.name,
			chosen.aliases,
			chosen.context?.summary ?? ''
		);
	}

	for (const type of TYPES) {
		for (let i = 0; i < fillerPerType; i += 1) pushRow(type, fillerName(i), [], '');
	}

	// Chunked, because one statement carrying every row of a large universe is needlessly
	// close to the parameter limit.
	for (let i = 0; i < rows.length; i += 500) {
		await db.insert(entity).values(rows.slice(i, i + 500));
	}
	return { universeId, corpusIdByName };
}

// ---------------------------------------------------------------------------
// The orderings, as SQL.
// ---------------------------------------------------------------------------

interface OrderingSpec {
	id: string;
	note: string;
	fetch: (db: Db, universeId: string, subject: MatchSubject, limit: number) => Promise<OrderedPool>;
}

interface RawRow {
	id: string;
	name: string;
	aliases: string[];
	type: EntityType;
	body_lead: string;
}

function toCandidates(rows: RawRow[], corpusIdByName: Record<string, string>): MatchCandidate[] {
	return rows.map((row) => ({
		id: corpusIdByName[row.name] ?? row.id,
		name: row.name,
		aliases: row.aliases,
		// Exactly what `job-runner.ts`'s `toMatchCandidate` builds, so the scorer sees the text
		// production would give it.
		context: { type: row.type, summary: oneLineSummary(row.body_lead), sourceSentence: null }
	}));
}

/** Production, as `candidateEntitiesForMatching` runs it (#627). Index-backed, stops at the
 * cap, and arbitrary with respect to the subject. */
function slugOrdering(corpusIdByName: Record<string, string>): OrderingSpec {
	return {
		id: 'slug',
		note: 'production: ORDER BY slug, index-backed (#627)',
		fetch: async (db, universeId, subject, limit) => {
			const type = (subject.context?.type ?? 'character') as EntityType;
			const pool = await candidateEntitiesForMatching(db, universeId, type, limit);
			return {
				candidates: toCandidates(
					pool.candidates.map((c) => ({
						id: c.id,
						name: c.name,
						aliases: c.aliases,
						type: c.type,
						body_lead: c.bodyLead
					})),
					corpusIdByName
				),
				truncated: pool.truncated
			};
		}
	};
}

/** The ordering this issue exists to test: `pg_trgm` similarity of the entity name to the
 * subject's name, highest first. Not index-backed for an `ORDER BY ... DESC` (see part 3). */
function trigramOrdering(nameToId: Record<string, string>): OrderingSpec {
	return {
		id: 'trigram-proximity',
		note: 'ORDER BY similarity(name, subject) DESC, slug',
		fetch: async (db, universeId, subject, limit) => {
			const type = (subject.context?.type ?? 'character') as EntityType;
			const rows = (await db.execute(sql`
				select id, name, aliases, type::text as type, left(body, 400) as body_lead
				from entity
				where universe_id = ${universeId} and type = ${type}::entity_type
				order by similarity(name, ${subject.name}) desc, slug
				limit ${limit + 1}
			`)) as unknown as RawRow[];
			return {
				candidates: toCandidates(rows.slice(0, limit), nameToId),
				truncated: rows.length > limit
			};
		}
	};
}

/**
 * The middle option #627 did not consider: keep the index-backed `slug` order, but seek to
 * the subject's own slug instead of to the start of the universe. Two index scans on
 * `entity_universe_slug_key`, one forward from the subject's slug and one backward, both of
 * which stop at half the cap. Slug is derived from the name, so this is name proximity in the
 * only metric the existing index can serve, and it costs what the current query costs.
 */
function slugWindowOrdering(nameToId: Record<string, string>): OrderingSpec {
	return {
		id: 'slug-window',
		note: 'two index scans around the subject slug, interleaved',
		fetch: async (db, universeId, subject, limit) => {
			const type = (subject.context?.type ?? 'character') as EntityType;
			const anchor = slugify(subject.name);
			const half = Math.ceil(limit / 2);
			const forward = (await db.execute(sql`
				select id, name, aliases, type::text as type, left(body, 400) as body_lead
				from entity
				where universe_id = ${universeId} and type = ${type}::entity_type and slug >= ${anchor}
				order by slug
				limit ${half}
			`)) as unknown as RawRow[];
			const backward = (await db.execute(sql`
				select id, name, aliases, type::text as type, left(body, 400) as body_lead
				from entity
				where universe_id = ${universeId} and type = ${type}::entity_type and slug < ${anchor}
				order by slug desc
				limit ${half}
			`)) as unknown as RawRow[];
			// Interleaved rather than concatenated, so "nearest to the subject" is the pool order
			// the pre-filter's tie-break inherits.
			const merged: RawRow[] = [];
			for (let i = 0; i < half; i += 1) {
				if (forward[i]) merged.push(forward[i]!);
				if (backward[i]) merged.push(backward[i]!);
			}
			const [count] = (await db.execute(sql`
				select count(*)::int as n from entity
				where universe_id = ${universeId} and type = ${type}::entity_type
			`)) as unknown as Array<{ n: number }>;
			return {
				candidates: toCandidates(merged.slice(0, limit), nameToId),
				truncated: (count?.n ?? 0) > limit
			};
		}
	};
}

// ---------------------------------------------------------------------------
// The fourth ordering (issue #679): embedding distance.
// ---------------------------------------------------------------------------

/** Texts per `embedMany` call. `embedMany` splits by the model's own per-call maximum
 * anyway, but it fans the splits out in parallel, and a run of this bench asks for a few
 * thousand short texts at once: batching here keeps that a sequence of ordinary calls
 * rather than a burst the gateway rate-limits. */
const EMBED_BATCH = 128;

/**
 * One vector per distinct `matchTextFor` text, cached for the whole run rather than per
 * universe.
 *
 * The cache is what makes this arm cheap enough to run twice. `fillerName` is derived from
 * an index, so the filler of a 20-per-type universe is a prefix of the filler of a
 * 1000-per-type one and both wording variants hold the same rows; a text is therefore
 * embedded once for the whole run and reused across the six universes part 2 builds. It is
 * also the right shape for what production would do: an entity's vector is written once at
 * index time and read by every later sighting, and only the subject side is new per
 * document.
 */
class MatchTextVectors {
	private readonly cache = new Map<string, number[]>();

	constructor(private readonly embed: (texts: string[]) => Promise<number[][]>) {}

	/** Embeds whatever is not cached yet, and returns how many texts that was, so the run
	 * can report what it actually paid for rather than what it asked for. */
	async warm(texts: string[]): Promise<number> {
		const missing = [...new Set(texts)].filter((text) => !this.cache.has(text));
		for (let i = 0; i < missing.length; i += EMBED_BATCH) {
			const batch = missing.slice(i, i + EMBED_BATCH);
			const vectors = await this.embed(batch);
			batch.forEach((text, j) => this.cache.set(text, vectors[j]!));
		}
		return missing.length;
	}

	async get(text: string): Promise<number[]> {
		await this.warm([text]);
		return this.cache.get(text)!;
	}
}

interface VectorEntry {
	candidate: MatchCandidate;
	vector: number[];
}

/**
 * Every entity in the universe, grouped by type, with the vector of the text the scorer
 * would embed it as.
 *
 * Read out of Postgres through the same projection `candidateEntitiesForMatching` uses and
 * turned into candidates by the same `toCandidates`, so the row an ordering ranks is the row
 * the scorer then sees. The whole type population is loaded because an exact top-N needs
 * every vector; production would ask an index for the top N instead, which is the difference
 * `embeddingOrdering`'s own note is about.
 */
async function buildVectorIndex(
	db: Db,
	universeId: string,
	corpusIdByName: Record<string, string>,
	vectors: MatchTextVectors
): Promise<Map<EntityType, VectorEntry[]>> {
	const rows = (await db.execute(sql`
		select id, name, aliases, type::text as type, left(body, 400) as body_lead
		from entity
		where universe_id = ${universeId}
		order by slug
	`)) as unknown as RawRow[];
	const candidates = toCandidates(rows, corpusIdByName);
	await vectors.warm(candidates.map((candidate) => matchTextFor(candidate)));

	const byType = new Map<EntityType, VectorEntry[]>();
	for (const candidate of candidates) {
		const type = (candidate.context?.type ?? 'character') as EntityType;
		const bucket = byType.get(type) ?? [];
		bucket.push({ candidate, vector: await vectors.get(matchTextFor(candidate)) });
		byType.set(type, bucket);
	}
	return byType;
}

/**
 * The exposure the false-merge column cannot state on its own: for one subject, the best
 * cosine the corpus's own rows reached, and the best any row it did not contribute reached.
 *
 * Without this the column is unreadable. "No new false merge at 1009 candidates" means the
 * ordering is safe if the invented filler came close to winning and was beaten, and means
 * the fixture cannot detect the risk at all if the filler was never in contention. The
 * number that separates those two readings is the best filler's own cosine against the band
 * the scorer decides on.
 */
interface SubjectExposure {
	subjectId: string;
	bestCorpus: number;
	bestFiller: number;
	bestFillerName: string;
}

interface EmbeddingOrderingProbe {
	spec: OrderingSpec;
	/** One row per subject, in first-seen order; the second scorer arm re-fetches the same
	 * pools and would otherwise double every row. */
	exposure: () => SubjectExposure[];
}

/**
 * Issue #679's ordering: the `limit` entities of this type in this universe whose own match
 * text is nearest the subject's, by cosine.
 *
 * It is the one ordering the pre-filter is not blind to. `preFilterCandidates` ranks every
 * candidate sharing a name or alias token above every candidate sharing none, so the pool's
 * order only ever decides among the non-sharers, and a candidate sharing no token shares no
 * trigram either (#641) and sits at an expected rank of half the population under `slug`
 * (#666). Cosine is the metric that does see those pairs: `docs/models.md` records this
 * model taking "the Gilded Rat" against "Il Ratto Dorato" from 0.074 on trigrams to 0.80.
 *
 * **Two ways this is deliberately the ceiling rather than the product, and both matter to
 * reading the table.** The ranking is an exact cosine over every vector rather than an ANN
 * search, and an HNSW index can only lose recall against that, never gain it. And the vector
 * is `matchTextFor`'s text, which is *not* what `indexEntity` writes to Qdrant today: that
 * pipeline chunks and embeds an entity's `body`, under a payload carrying no entity type, so
 * the vector this ordering wants does not exist in production yet. Measuring the ceiling is
 * the point: an ordering that does not pay for itself at its best does not pay for itself.
 *
 * Ranking by the scorer's own metric is also the sharp end of the question, not a
 * convenience. An ordering that agrees with the scorer hands `resolveMatch` the same
 * argmax it would have found over the whole type population, so it recovers every true
 * candidate the scorer could find *and* exposes every false merge the scorer would make
 * against a population two orders of magnitude larger than the window. That is why the
 * false-merge column and not retention is what decides this.
 */
function embeddingOrdering(
	index: Map<EntityType, VectorEntry[]>,
	vectors: MatchTextVectors,
	/** The ids `buildScoringUniverse` mapped to a labelled corpus entity. Everything else in
	 * the universe is invented filler, which naming is a false merge by construction. */
	corpusIds: ReadonlySet<string>
): EmbeddingOrderingProbe {
	const exposure = new Map<string, SubjectExposure>();
	return {
		exposure: () => [...exposure.values()],
		spec: {
			id: 'embedding-distance',
			note: 'top N by cosine of matchTextFor, exact (the ceiling of a Qdrant search)',
			fetch: async (_db, _universeId, subject, limit) => {
				const type = (subject.context?.type ?? 'character') as EntityType;
				const population = index.get(type) ?? [];
				const subjectVector = await vectors.get(matchTextFor(subject));
				const scored = population
					.map((entry) => ({
						entry,
						score: cosineSimilarity(subjectVector, entry.vector)
					}))
					// Name breaks a tie, so two entities at the same cosine order the same way on
					// every run: this table is only readable if it repeats (#279).
					.sort(
						(a, b) =>
							b.score - a.score || a.entry.candidate.name.localeCompare(b.entry.candidate.name)
					);

				const key = `${type}:${subject.name}`;
				if (!exposure.has(key)) {
					// Over the whole type population rather than over the page, because the
					// question is what the ranking had available to promote and not what it did.
					const corpus = scored.filter((s) => corpusIds.has(s.entry.candidate.id));
					const filler = scored.filter((s) => !corpusIds.has(s.entry.candidate.id));
					exposure.set(key, {
						subjectId: key,
						bestCorpus: corpus[0]?.score ?? 0,
						bestFiller: filler[0]?.score ?? 0,
						bestFillerName: filler[0]?.entry.candidate.name ?? '-'
					});
				}

				return {
					candidates: scored.slice(0, limit).map((s) => s.entry.candidate),
					truncated: population.length > limit
				};
			}
		}
	};
}

/** Prints the exposure rows against the band the ordering's own metric is judged by, which
 * is the embedding scorer's: the ordering ranks on cosine, so this is the same scale the
 * `matchAbove`/`newBelow` decision is taken on. */
function reportExposure(rows: SubjectExposure[], thresholds: MatchThresholds): void {
	if (rows.length === 0) return;
	const inBand = rows.filter(
		(r) => r.bestFiller >= thresholds.newBelow && r.bestFiller < thresholds.matchAbove
	);
	const above = rows.filter((r) => r.bestFiller >= thresholds.matchAbove);
	const worst = [...rows].sort((a, b) => b.bestFiller - a.bestFiller)[0]!;
	console.log(
		`     embedding-distance exposure: best filler cosine ${worst.bestFiller.toFixed(3)} ("${worst.bestFillerName}" against ${worst.subjectId}), band ${thresholds.newBelow}/${thresholds.matchAbove}: ${above.length} of ${rows.length} subjects had a filler at or above matchAbove, ${inBand.length} in band`
	);
	for (const row of rows.filter((r) => r.bestFiller >= thresholds.newBelow)) {
		console.log(
			`       ${row.subjectId}: best filler ${row.bestFiller.toFixed(3)} ("${row.bestFillerName}"), best corpus row ${row.bestCorpus.toFixed(3)}`
		);
	}
}

// ---------------------------------------------------------------------------
// Part 3: plan cost.
// ---------------------------------------------------------------------------

interface PlanCost {
	label: string;
	/** Shared buffers the whole plan touched, hit plus read, taken off the root node of
	 * `FORMAT JSON` rather than summed out of the text form: every node in the text form
	 * reports its subtree's cumulative buffers, so adding those up counts the same pages
	 * several times over. */
	buffers: number;
	ms: number;
	/** The node type at the root of the scan, so a plan that stopped early on an index is
	 * distinguishable from one that scanned and sorted. */
	shape: string;
}

interface ExplainNode {
	'Node Type': string;
	'Shared Hit Blocks'?: number;
	'Shared Read Blocks'?: number;
	Plans?: ExplainNode[];
}

/** The scan shape underneath the `Limit`, which is the thing that differs between these
 * orderings: an `Index Scan` stopped at the cap, or a `Seq Scan` plus a `Sort`. */
function scanShape(node: ExplainNode, depth = 0): string {
	const own = node['Node Type'] ?? '?';
	if (depth >= 2 || !node.Plans || node.Plans.length === 0) return own;
	return `${own} > ${scanShape(node.Plans[0]!, depth + 1)}`;
}

async function explain(db: Db, label: string, query: SQL): Promise<PlanCost> {
	// Twice, reporting the second: the first run of a query against a freshly written table
	// pays for pages nobody has read yet, and the question here is the steady-state cost of
	// an ordering rather than the cost of the first sighting after an import.
	let plan: { Plan: ExplainNode; 'Execution Time': number } | undefined;
	for (let i = 0; i < 2; i += 1) {
		const rows = (await db.execute(
			sql`explain (analyze, buffers, format json) ${query}`
		)) as unknown as Array<Record<string, unknown>>;
		const raw = Object.values(rows[0] ?? {})[0];
		const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{
			Plan: ExplainNode;
			'Execution Time': number;
		}>;
		plan = parsed[0];
	}
	if (!plan) throw new Error(`explain returned nothing for ${label}`);
	const buffers = (plan.Plan['Shared Hit Blocks'] ?? 0) + (plan.Plan['Shared Read Blocks'] ?? 0);
	return { label, buffers, ms: plan['Execution Time'], shape: scanShape(plan.Plan) };
}

/**
 * One universe shape's plan costs. Two shapes are measured, because the answer differs and
 * #627's own numbers are for the first: a universe that is entirely one type, where the cap
 * is reached after 201 index entries, and a six-type mix, where an index scan on
 * `(universe_id, slug)` has to walk about six times that many to fill the same page because
 * the type predicate is not in the index.
 */
async function planCostsFor(
	db: Db,
	label: string,
	weights: Record<EntityType, number>
): Promise<void> {
	const universeId = await freshUniverse(db, `plan-${label}`);
	const sequence = typeSequence(weights, PLAN_UNIVERSE_SIZE);
	const rows = sequence.map((type, i) => ({
		universeId,
		type,
		name: fillerName(i),
		slug: `${slugify(fillerName(i))}-${String(i).padStart(4, '0')}`,
		body: 'x'
	}));
	for (let i = 0; i < rows.length; i += 500) await db.insert(entity).values(rows.slice(i, i + 500));
	await db.execute(sql`analyze entity`);

	// An anchor inside the distribution rather than at its edge: the slug of the entity
	// halfway through the universe's characters, which is what a subject named like the
	// world's other entities produces. Both halves of the window are bounded by half the cap
	// wherever the anchor falls, so an edge anchor costs the same and returns one half empty.
	const [anchorRow] = (await db.execute(sql`
		select slug, name from entity
		where universe_id = ${universeId} and type = 'character'::entity_type
		order by slug offset (select count(*) / 2 from entity where universe_id = ${universeId} and type = 'character'::entity_type)
		limit 1
	`)) as unknown as Array<{ slug: string; name: string }>;
	const subject = anchorRow!.name;
	const anchor = anchorRow!.slug;
	const [typeCount] = (await db.execute(sql`
		select count(*)::int as n from entity
		where universe_id = ${universeId} and type = 'character'::entity_type
	`)) as unknown as Array<{ n: number }>;
	// The whole table, not this universe, because a sequential scan reads every row of
	// `entity` in every universe: the orderings that fall back to one are not bounded by the
	// universe the way #627's write-up says, they are bounded by the deployment.
	const [tableCount] = (await db.execute(
		sql`select count(*)::int as n from entity`
	)) as unknown as Array<{ n: number }>;

	const cap = POOL_LIMIT + 1;
	const half = Math.ceil(POOL_LIMIT / 2);
	const base = sql`from entity where universe_id = ${universeId} and type = 'character'::entity_type`;

	console.log(
		`\n   ${label}: universe ${PLAN_UNIVERSE_SIZE} entities, ${typeCount!.n} of the type asked for, whole entity table ${tableCount!.n} rows`
	);
	const costs: PlanCost[] = [];
	costs.push(
		await explain(
			db,
			'slug (production, #627)',
			sql`select id, name ${base} order by slug limit ${cap}`
		)
	);
	costs.push(
		await explain(
			db,
			'slug-window, forward half',
			sql`select id, name ${base} and slug >= ${anchor} order by slug limit ${half}`
		)
	);
	costs.push(
		await explain(
			db,
			'slug-window, backward half',
			sql`select id, name ${base} and slug < ${anchor} order by slug desc limit ${half}`
		)
	);
	costs.push(
		await explain(
			db,
			'lower(name) (#627 baseline)',
			sql`select id, name ${base} order by lower(name) limit ${cap}`
		)
	);

	await db.execute(sql`create extension if not exists pg_trgm`);
	costs.push(
		await explain(
			db,
			'similarity() desc, no index',
			sql`select id, name ${base} order by similarity(name, ${subject}) desc, slug limit ${cap}`
		)
	);
	costs.push(
		await explain(
			db,
			'name <-> subject (KNN), no index',
			sql`select id, name ${base} order by name <-> ${subject} limit ${cap}`
		)
	);

	await db.execute(sql`create index w641_gin on entity using gin (name gin_trgm_ops)`);
	await db.execute(sql`analyze entity`);
	costs.push(
		await explain(
			db,
			'similarity() desc, GIN trgm on name',
			sql`select id, name ${base} order by similarity(name, ${subject}) desc, slug limit ${cap}`
		)
	);
	await db.execute(sql`drop index w641_gin`);

	await db.execute(sql`create index w641_gist on entity using gist (name gist_trgm_ops)`);
	await db.execute(sql`analyze entity`);
	costs.push(
		await explain(
			db,
			'name <-> subject (KNN), GiST trgm on name',
			sql`select id, name ${base} order by name <-> ${subject} limit ${cap}`
		)
	);
	await db.execute(sql`drop index w641_gist`);

	await db.execute(sql`create extension if not exists btree_gist`);
	await db.execute(
		sql`create index w641_gist_multi on entity using gist (universe_id, type, name gist_trgm_ops)`
	);
	await db.execute(sql`analyze entity`);
	costs.push(
		await explain(
			db,
			'name <-> subject (KNN), multicolumn GiST',
			sql`select id, name ${base} order by name <-> ${subject} limit ${cap}`
		)
	);
	await db.execute(sql`drop index w641_gist_multi`);

	for (const cost of costs) {
		console.log(
			`     ${cost.label.padEnd(46)} ${String(cost.buffers).padStart(6)} buffers ${cost.ms.toFixed(2).padStart(8)} ms  ${cost.shape}`
		);
	}
}

async function measurePlanCost(db: Db): Promise<void> {
	console.log('\n## Part 3: plan cost per ordering');
	await planCostsFor(db, 'one type only', {
		character: 1,
		place: 0,
		faction: 0,
		item: 0,
		event: 0,
		session: 0
	});
	await planCostsFor(db, 'six-type mix', MIXES[2]!.weights);
}

// ---------------------------------------------------------------------------
// Part 1.
// ---------------------------------------------------------------------------

async function measureTruncation(db: Db): Promise<void> {
	console.log('\n## Part 1: the universe size at which one type reaches each cap');
	for (const mix of MIXES) {
		const total = TYPES.reduce((s, t) => s + mix.weights[t], 0);
		const share = Math.max(...TYPES.map((t) => mix.weights[t])) / total;
		const sequence = typeSequence(mix.weights, 2500);
		const counts: Record<string, number> = {};
		for (const t of TYPES) counts[t] = 0;
		const firstAt: Record<number, { n: number; type: EntityType }> = {};
		for (let n = 0; n < sequence.length; n += 1) {
			const t = sequence[n]!;
			counts[t] = counts[t]! + 1;
			for (const cap of [PRE_FILTER_LIMIT, POOL_LIMIT]) {
				if (!firstAt[cap] && counts[t]! === cap + 1) firstAt[cap] = { n: n + 1, type: t };
			}
		}
		console.log(
			`\n   ${mix.id} (${mix.note}), busiest type ${(share * 100).toFixed(1)}% of the universe`
		);
		for (const cap of [PRE_FILTER_LIMIT, POOL_LIMIT]) {
			const hit = firstAt[cap]!;
			// Verified through the real query on the real schema at both sides of the boundary,
			// rather than asserted from the arithmetic above.
			const observed: string[] = [];
			for (const size of [hit.n - 1, hit.n]) {
				const probe = await freshUniverse(db, `trunc-${mix.id}-${cap}-${size}`);
				const rows = sequence.slice(0, size).map((type, i) => ({
					universeId: probe,
					type,
					name: fillerName(i),
					slug: `e-${String(i).padStart(4, '0')}`,
					body: 'x'
				}));
				for (let i = 0; i < rows.length; i += 500) {
					await db.insert(entity).values(rows.slice(i, i + 500));
				}
				const pool = await candidateEntitiesForMatching(db, probe, hit.type, cap);
				observed.push(`${size}: ${pool.candidates.length} rows, truncated=${pool.truncated}`);
				await db.execute(sql`delete from universe where id = ${probe}`);
			}
			console.log(
				`     cap ${String(cap).padStart(3)}: first exceeded at ${hit.n} entries (${hit.type} reaches ${cap + 1})   [${observed.join(' | ')}]`
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Part 2.
// ---------------------------------------------------------------------------

interface Scorer {
	id: string;
	similarity: SimilarityFn;
	thresholds: MatchThresholds;
}

async function measureOrderings(
	db: Db,
	scorers: Scorer[],
	fillerSizes: number[],
	variants: WordingVariant[],
	/** Present only when the run has a gateway credential, because issue #679's ordering
	 * needs a vector per entity whether or not the scorer being measured wants one. Under
	 * `--scorer=lexical` the other three orderings still run, which is what reproduces
	 * #641's own table for free. */
	vectors: MatchTextVectors | null
): Promise<void> {
	const subjects = poolSubjectsFromCorpus(SAMPLE_WORLD_MATCHING_CORPUS);
	console.log('\n## Part 2: the corpus scored under each ordering');
	console.log(
		`   ${subjects.length} subjects, pool cap ${POOL_LIMIT}, pre-filter ${PRE_FILTER_LIMIT}, false merges weighted ${FALSE_MERGE_WEIGHT}x`
	);
	if (!vectors) {
		console.log('   embedding-distance ordering skipped: no gateway credential in this run');
	}

	for (const variant of variants) {
		for (const fillerPerType of fillerSizes) {
			const spec = await buildScoringUniverse(db, fillerPerType, variant);
			const orderings = [
				slugOrdering(spec.corpusIdByName),
				trigramOrdering(spec.corpusIdByName),
				slugWindowOrdering(spec.corpusIdByName)
			];
			let probe: EmbeddingOrderingProbe | null = null;
			if (vectors) {
				const index = await buildVectorIndex(db, spec.universeId, spec.corpusIdByName, vectors);
				probe = embeddingOrdering(index, vectors, new Set(Object.values(spec.corpusIdByName)));
				orderings.push(probe.spec);
			}
			const [typeCount] = (await db.execute(sql`
				select count(*)::int as n from entity
				where universe_id = ${spec.universeId} and type = 'place'::entity_type
			`)) as unknown as Array<{ n: number }>;

			for (const scorer of scorers) {
				const report = await runPoolOrderingBenchmark(
					SAMPLE_WORLD_MATCHING_CORPUS.id,
					subjects,
					orderings.map((o) => ({
						id: o.id,
						fetchPool: (subject: MatchSubject) => o.fetch(db, spec.universeId, subject, POOL_LIMIT)
					})),
					scorer.similarity,
					{
						thresholds: scorer.thresholds,
						preFilterLimit: PRE_FILTER_LIMIT,
						falseMergeWeight: FALSE_MERGE_WEIGHT
					}
				);
				console.log(
					`\n   wording=${variant} ${typeCount!.n} entities of a type, scorer=${scorer.id} band=${scorer.thresholds.newBelow}/${scorer.thresholds.matchAbove}`
				);
				console.log(
					'   ordering            missing  narrowed  unscored  matched  asked  new  fmerge  fsplit  weighted'
				);
				for (const score of report.scores) {
					console.log(
						`   ${score.orderingId.padEnd(19)} ${String(score.trueCandidateMissing).padStart(7)} ${String(score.narrowedPools).padStart(9)} ${String(score.trueCandidateUnscored).padStart(9)} ${String(score.matched).padStart(8)} ${String(score.asked).padStart(6)} ${String(score.correctlyNew).padStart(4)} ${String(score.falseMerges).padStart(7)} ${String(score.falseSplits).padStart(7)} ${String(score.weightedCost).padStart(9)}`
					);
				}
				// Which subject each ordering lost, which is the finding rather than the total.
				for (const score of report.scores) {
					const lost = score.outcomes.filter((o) => o.trueCandidateScored === false);
					if (lost.length > 0) {
						console.log(
							`     ${score.orderingId}: true candidate never reached the scorer for ${lost.map((o) => o.subjectId).join('; ')}`
						);
					}
				}
			}
			// Once per universe rather than per scorer: the ordering ranks on cosine whichever
			// scorer is being measured, so the exposure is the same number both times.
			if (probe) reportExposure(probe.exposure(), EMBEDDING_MATCH_THRESHOLDS);
		}
	}
}

// ---------------------------------------------------------------------------
// Part 4 (issue #666).
// ---------------------------------------------------------------------------

/** Counts what a limit costs, wrapped around the scorer the sweep is running. `calls` is one
 * cosine per candidate scored; `texts` is the distinct texts an embedding scorer would pay a
 * provider for, which is fewer than `calls` because `createEmbeddingSimilarity` caches per
 * text for the life of a job and both sides of a pair are cached. */
function countingSimilarity(inner: SimilarityFn): {
	similarity: SimilarityFn;
	calls: () => number;
	texts: () => number;
} {
	let calls = 0;
	const texts = new Set<string>();
	return {
		similarity: (subject, candidate) => {
			calls += 1;
			texts.add(matchTextFor(subject));
			texts.add(matchTextFor(candidate));
			return inner(subject, candidate);
		},
		calls: () => calls,
		texts: () => texts.size
	};
}

/**
 * Issue #666's question: 20 candidates reach the scorer, and the pool's own order picks
 * which 20 whenever the subject shares no token with any of them. Is 20 the right number?
 *
 * Swept under the production `slug` ordering only, because the ordering is #641's question
 * and it answered it: the alternatives are blind to exactly the subjects the window decides.
 * What moves here is the size of the window over the ordering we ship.
 */
async function measurePreFilter(
	db: Db,
	scorers: Scorer[],
	fillerSizes: number[],
	variants: WordingVariant[],
	limits: number[]
): Promise<void> {
	const subjects = poolSubjectsFromCorpus(SAMPLE_WORLD_MATCHING_CORPUS);
	console.log('\n## Part 4: the pre-filter limit, swept under the production slug ordering');
	console.log(
		`   ${subjects.length} subjects, pool cap ${POOL_LIMIT}, limits ${limits.join(', ')} (shipping ${PRE_FILTER_LIMIT})`
	);

	for (const variant of variants) {
		for (const fillerPerType of fillerSizes) {
			const spec = await buildScoringUniverse(db, fillerPerType, variant);
			const ordering = slugOrdering(spec.corpusIdByName);
			const [typeCount] = (await db.execute(sql`
				select count(*)::int as n from entity
				where universe_id = ${spec.universeId} and type = 'place'::entity_type
			`)) as unknown as Array<{ n: number }>;

			for (const scorer of scorers) {
				console.log(
					`\n   wording=${variant} ${typeCount!.n} entities of a type, scorer=${scorer.id}`
				);
				console.log(
					'   limit  narrowed  unscored  matched  asked  new  fmerge  fsplit  weighted  sim calls  texts'
				);
				for (const limit of limits) {
					const counted = countingSimilarity(scorer.similarity);
					const report = await runPoolOrderingBenchmark(
						SAMPLE_WORLD_MATCHING_CORPUS.id,
						subjects,
						[
							{
								id: ordering.id,
								fetchPool: (subject: MatchSubject) =>
									ordering.fetch(db, spec.universeId, subject, POOL_LIMIT)
							}
						],
						counted.similarity,
						{
							thresholds: scorer.thresholds,
							preFilterLimit: limit,
							falseMergeWeight: FALSE_MERGE_WEIGHT
						}
					);
					const score = report.scores[0]!;
					// One scorer call per candidate that survived the pre-filter, over every subject.
					// The benchmark's own extra `preFilterCandidates` call scores nothing, so this
					// counts what a real job would pay and not what the harness did.
					const calls = counted.calls();
					console.log(
						`   ${String(limit).padStart(5)} ${String(score.narrowedPools).padStart(9)} ${String(score.trueCandidateUnscored).padStart(9)} ${String(score.matched).padStart(8)} ${String(score.asked).padStart(6)} ${String(score.correctlyNew).padStart(4)} ${String(score.falseMerges).padStart(7)} ${String(score.falseSplits).padStart(7)} ${String(score.weightedCost).padStart(9)} ${String(calls).padStart(10)} ${String(counted.texts()).padStart(6)}`
					);
					const lost = score.outcomes.filter((o) => o.trueCandidateScored === false);
					if (lost.length > 0) {
						console.log(`     lost: ${lost.map((o) => o.subjectId).join('; ')}`);
					}
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------

function parseScorer(argv: string[]): 'lexical' | 'embedding' | 'both' {
	for (const arg of argv) {
		const match = /^--scorer=?(lexical|embedding|both)$/.exec(arg);
		if (match?.[1]) return match[1] as 'lexical' | 'embedding' | 'both';
	}
	return 'both';
}

/** `--filler=20,200,1000`: how many invented entities of each type sit around the corpus's
 * own. One number per universe size worth reporting, because the whole question is how
 * retention degrades as a world grows. */
function parseFiller(argv: string[]): number[] {
	for (const arg of argv) {
		const match = /^--filler=?([\d,]+)$/.exec(arg);
		if (match?.[1]) {
			const sizes = match[1]
				.split(',')
				.map((n) => Number(n))
				.filter((n) => Number.isFinite(n));
			if (sizes.length > 0) return sizes;
		}
	}
	return [20, 200, 1000];
}

/** `--pre-filter=20,40,200`: which pre-filter limits part 4 sweeps (issue #666). The default
 * brackets the shipping 20 on both sides and ends at the SQL cap, above which the limit
 * cannot change anything because the pool never holds more rows than that. */
function parsePreFilter(argv: string[]): number[] {
	for (const arg of argv) {
		const match = /^--pre-filter=?([\d,]+)$/.exec(arg);
		if (match?.[1]) {
			const limits = match[1]
				.split(',')
				.map((n) => Number(n))
				.filter((n) => Number.isFinite(n) && n > 0);
			if (limits.length > 0) return limits;
		}
	}
	return [10, PRE_FILTER_LIMIT, 40, 100, POOL_LIMIT];
}

async function main(): Promise<void> {
	loadEnv();
	const databaseUrl = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(databaseUrl).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	const which = parseScorer(process.argv.slice(2));
	const fillerSizes = parseFiller(process.argv.slice(2));
	const preFilterLimits = parsePreFilter(process.argv.slice(2));

	const db = createDb(databaseUrl, { max: 4 });
	try {
		// Plan cost first, on a table this run has not filled with probe universes yet, so its
		// numbers are comparable to #627's own single-universe measurement.
		await measurePlanCost(db);
		await measureTruncation(db);

		const scorers: Scorer[] = [];
		// Shared with the embedding-distance ordering (#679), which needs a vector per entity
		// even when the arm being measured is the lexical scorer, and null when the run has no
		// credential to make one with.
		let vectors: MatchTextVectors | null = null;
		if (which !== 'embedding') {
			scorers.push({
				id: 'lexical-trigram',
				similarity: lexicalTrigramSimilarity,
				thresholds: MATCH_THRESHOLDS
			});
		}
		if (which !== 'lexical') {
			requireEnv('AI_GATEWAY_API_KEY');
			const model = await resolveModel(db, 'embedding');
			const vectorSize = embeddingDimensionsFor(model.provider, model.modelId);
			const embeddingModel = createEmbeddingModel(
				model.provider,
				model.modelId,
				readGatewayCredentials(process.env)
			);
			let embedCalls = 0;
			let embedTexts = 0;
			const embed = async (texts: string[]): Promise<number[][]> => {
				embedCalls += 1;
				embedTexts += texts.length;
				const result = await embedMany({ model: embeddingModel, values: texts });
				return result.embeddings;
			};
			scorers.push({
				id: `embedding (${model.provider}/${model.modelId})`,
				similarity: createEmbeddingSimilarity({ vectorSize, embed }),
				thresholds: EMBEDDING_MATCH_THRESHOLDS
			});
			// The ordering's own vectors go through the same counted `embed`, so the usage line
			// below is the whole run's bill and not the scorer's half of it.
			vectors = new MatchTextVectors(embed);
			process.on('exit', () => {
				console.log(`\nGateway usage: ${embedCalls} embedMany call(s), ${embedTexts} text(s).`);
			});
		}

		await measureOrderings(db, scorers, fillerSizes, ['easiest', 'hardest'], vectors);
		await measurePreFilter(db, scorers, fillerSizes, ['easiest', 'hardest'], preFilterLimits);
	} finally {
		await closeDb(db);
	}
}

await main();
