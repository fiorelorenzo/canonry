/**
 * The merge engine's matching decision (issues #36, #37, SPEC.md §4.2, §6.4): "Matching
 * runs in this order, cheapest first: external id - exact, free, no model involved...
 * semantic matching on embeddings for everything else... Above a high similarity it is a
 * match, below a low one it is a new entity, and in between the user is asked, one
 * question, never a silent guess."
 *
 * Pure decision logic, no database and no model - the same seam packages/eval's retrieval
 * and propagation harnesses use (`Retriever`, `CandidateSelector`): a similarity function
 * is injected, so the decision rule is unit-testable and the benchmark
 * (matching-benchmark.ts) can sweep thresholds without a live embedding model. The actual
 * database read for the exact external-id match (entity_source_ref) and the actual
 * embedding call are the composition root's job, exactly as `ModelSelector`'s database
 * read is (model-selector.ts).
 */

/**
 * What each side of a comparison carries beyond its name (issue #310).
 *
 * `MatchSubject` and `MatchCandidate` used to carry `name` and `aliases` and nothing else,
 * which meant `matchTextFor` had a bare name to embed and the embedding scorer had almost
 * nothing to be semantic about. Issue #279's measurement is the evidence: mean cosine 0.912
 * over the corpus's true pairs against 0.853 over its false ones, a separation of 0.059
 * where the trigram scorer got 0.225, because two unrelated proper nouns of the same shape
 * ("Aldric Voss", "Seraphine Duval") read alike to an embedding model when that is all it is
 * given. No threshold pair anywhere on the grid fixes an ordering, so the band had to be
 * wide enough to ask about 20 of 24 pairs.
 *
 * Every field here was already sitting in the job runner where candidates are built and was
 * thrown away at this seam. Each one separates a pair the name alone cannot: the type tells
 * an office from a place, the summary tells a father from his son, and the source sentence
 * tells an inn in Port Kessin from an inn in Harrowgate. Those are three of the five
 * negatives the corpus could not distinguish.
 *
 * Optional in the type and null-tolerant in every field, because it genuinely is absent in
 * places: a re-import that only knows an external id, a candidate read from a pending
 * proposal whose patch carries no body yet, an already-imported entity that has no source
 * document text to quote. A missing field drops out of the embedded text rather than
 * becoming an empty line, so a side with two fields and a side with three still compare on
 * what they both have.
 */
export interface MatchContext {
	/** `entity.type` for a candidate, `EntityProposalPayload.type` for a subject. The
	 * candidate pool is already filtered to one type, so this never *decides* a match within
	 * a pool; it is context the model reads, which is why it is a plain string here rather
	 * than an enum imported from a package this file does not depend on. */
	type: string | null;
	/** One line describing the entity: the proposed `summary` for a subject, the first
	 * sentence of `entity.body` for a candidate. Never the whole body - see
	 * `matchTextFor`'s own note on length. */
	summary: string | null;
	/** The sentence of the source document the subject was extracted from, sliced from
	 * `evidenceSpan`. Null on a candidate: an already-imported entity has no source text
	 * kept anywhere to quote, and inventing one from its body would make the two sides look
	 * symmetrical while carrying the same fact twice. */
	sourceSentence: string | null;
}

export interface MatchSubject {
	name: string;
	aliases: string[];
	/** Absent means "this caller has no context to give", which is a real answer and not a
	 * defect: the lexical scorer never reads it, and the embedding scorer degrades to what
	 * it scored before issue #310. */
	context?: MatchContext;
}

export interface MatchCandidate extends MatchSubject {
	id: string;
}

/**
 * The "one line" of `MatchContext.summary` and `MatchContext.sourceSentence`, from a longer
 * piece of text: its first sentence, or a hard cut when it has no sentence end inside the
 * budget.
 *
 * Deliberately blunt about what a sentence is. This feeds an embedding and never a GM's
 * screen, so a heading cut mid-clause costs a slightly noisier vector and nothing else,
 * which is not worth a sentence tokeniser or the dependency one would add. Markdown
 * structure is flattened to spaces first, because an entity body's first line is often
 * `## Rivalry` followed by the prose that matters, and a context line reading "##" is worse
 * than no context line.
 */
export function oneLineSummary(text: string | null | undefined, maxChars = 200): string | null {
	const flattened = (text ?? '')
		.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
		.replace(/[#*_`>]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (flattened.length === 0) return null;
	const sentence = /^.*?[.!?](?=\s|$)/.exec(flattened)?.[0]?.trim();
	const chosen = sentence && sentence.length > 0 ? sentence : flattened;
	return chosen.length > maxChars ? `${chosen.slice(0, maxChars).trimEnd()}...` : chosen;
}

/** SPEC.md §6.4: "normalised names and aliases stay in the loop as a cheap pre-filter and
 * as a tie-breaker, never as the decision." Lowercases, strips diacritics and collapses
 * everything that is not a letter or digit to single spaces - enough to see that "Gilded
 * Rat Tavern" and "the Gilded Rat" share tokens, and deliberately not enough to catch a
 * translation ("Il Ratto Dorato" shares none), which is exactly why this is a pre-filter
 * and never the match itself. */
export function normalizeForMatching(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

function tokenSet(subject: MatchSubject): Set<string> {
	const tokens = normalizeForMatching([subject.name, ...subject.aliases].join(' ')).split(' ');
	return new Set(tokens.filter((token) => token.length > 0));
}

/** Jaccard overlap of normalized name/alias tokens, in [0, 1]. Zero for a subject and
 * candidate that share no token at all - including two names that mean the same thing in
 * different languages, which is the whole reason §6.4 does not stop here. */
export function nameOverlapScore(subject: MatchSubject, candidate: MatchCandidate): number {
	const subjectTokens = tokenSet(subject);
	const candidateTokens = tokenSet({ name: candidate.name, aliases: candidate.aliases });
	if (subjectTokens.size === 0 || candidateTokens.size === 0) return 0;
	let intersection = 0;
	for (const token of subjectTokens) if (candidateTokens.has(token)) intersection += 1;
	const union = subjectTokens.size + candidateTokens.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/** Cheap, free pre-filter (SPEC.md §6.4): narrows a possibly large candidate set down to
 * the ones worth paying a similarity call for, by normalized name/alias overlap. Never a
 * decision by itself - a translated name scores zero here and still has to reach the
 * semantic step - this only bounds how many candidates ever get that far. Ties on overlap
 * preserve the input order, so a caller that already sorted candidates by relevance keeps
 * that ordering among equals.
 *
 * **This is the cap that decides, not the SQL one (issue #666).** A subject that shares no
 * name or alias token with any candidate overlaps all of them equally at zero, so the
 * tie-break is the whole decision and the pool's own order picks which `limit` rows are
 * ever scored. `candidateEntitiesForMatching` caps a pool at 200 and orders by slug, so
 * from 21 candidates of one type upwards the 20 that reach the scorer for such a subject
 * are the alphabetically first 20. That is why `resolveMatch` reports what this function
 * dropped (`ResolveMatchInput.onPreFilter`): a run saying `truncatedPools: 0` is telling
 * the truth about the 200 and nothing about the 20. */
export function preFilterCandidates(
	subject: MatchSubject,
	candidates: MatchCandidate[],
	limit: number
): MatchCandidate[] {
	if (candidates.length <= limit) return candidates;
	return candidates
		.map((candidate, index) => ({
			candidate,
			index,
			overlap: nameOverlapScore(subject, candidate)
		}))
		.sort((a, b) => b.overlap - a.overlap || a.index - b.index)
		.slice(0, limit)
		.map((scored) => scored.candidate);
}

/**
 * The identity pool's rows (issue #479): an existing entity, or a still-pending `create`
 * from this same job, addressed by the two things `entity_universe_slug_key` and a GM's
 * eyes actually collide on. `type` is carried so the caller can see a cross-type
 * collision, which is a different situation from a same-type one and not the matcher's to
 * settle.
 */
export interface IdentityCandidate {
	id: string;
	name: string;
	slug: string;
	type: string | null;
}

/**
 * The subject's own identity keys, as the create patch would write them.
 *
 * `slug` is the caller's, not derived here: `job-runner.ts` owns `slugify` and the patch
 * it writes has to agree with what this compares, so passing it in is what keeps the two
 * from drifting.
 */
export interface SubjectIdentity {
	name: string;
	slug: string;
}

/**
 * A collision between the subject's identity and something the universe already carries
 * (issue #479).
 *
 * **This is not a similarity decision and does not erode SPEC.md §6.4's "normalised names
 * and aliases stay in the loop as a cheap pre-filter and as a tie-breaker, never as the
 * decision."** §6.4 forbids string matching from *deciding a match* in place of the
 * semantic step, because "the Gilded Rat" and "Il Ratto Dorato" are one inn no regex will
 * pair. This is the opposite direction and a different question: `entity_universe_slug_key`
 * is UNIQUE on (universe_id, slug), so a `create` on a slug the universe already holds is
 * not a write the database will take. There is no false merge available here to weigh
 * against a false split, because the alternative to folding is a proposal that cannot be
 * accepted at all - it either fails that constraint or leaves the GM two entries with one
 * name, which is exactly what #479 reports.
 *
 * Slug before name, because the slug is the constraint; the name is the same collision
 * seen through a hand-edited slug. Aliases are not compared - see `entitiesByIdentity`'s
 * own note on why treating one as identity would turn #479's third defect into a false
 * merge.
 */
export function findIdentityCollision(
	subject: SubjectIdentity,
	candidates: IdentityCandidate[]
): { candidate: IdentityCandidate; via: 'slug' | 'name' } | null {
	const slug = subject.slug.trim().toLowerCase();
	if (slug.length > 0) {
		const bySlug = candidates.find((c) => c.slug.trim().toLowerCase() === slug);
		if (bySlug) return { candidate: bySlug, via: 'slug' };
	}
	const name = normalizeForMatching(subject.name);
	if (name.length > 0) {
		const byName = candidates.find((c) => normalizeForMatching(c.name) === name);
		if (byName) return { candidate: byName, via: 'name' };
	}
	return null;
}

export type MatchDecision =
	| { outcome: 'exact'; candidateId: string }
	/** A deterministic identity collision (issue #479), free and settled before any
	 * similarity call. Never a `create`: the caller folds it or drops it. */
	| { outcome: 'identity'; candidateId: string; via: 'slug' | 'name' }
	| { outcome: 'match'; candidateId: string; similarity: number }
	| { outcome: 'ask'; candidateIds: string[]; similarity: number }
	| { outcome: 'new' };

export interface MatchThresholds {
	/** At or above this similarity, treat as the same entity without asking. */
	matchAbove: number;
	/** Below this similarity, treat as a new entity without asking. */
	newBelow: number;
}

/** The band the **lexical** scorer (`lexicalTrigramSimilarity`) runs with: the scorer a box
 * with no embedding credentials, and CI, resolve to. `apps/web/src/lib/server/onboarding.ts`'s
 * `startImportRun` passes whichever band `resolveImportSimilarity` returns beside the scorer
 * it picked, so this is not a bench-only number - it is the band SPEC.md §6.4 describes
 * ("above a high similarity it is a match, below a low one a new entity, in between the user
 * is asked"), with real numbers in it.
 *
 * **Measured and kept, issue #279.** SPEC.md §16's open decision #3 says these stay open
 * "until the benchmark exists, which is the point: they are measured, not chosen".
 * `packages/bench`'s `matching-sweep` is now that run: 24 labelled pairs, 13 the same entity
 * and 11 not, false merges weighted 5x. On the trigram scorer 0.85/0.50 costs 2 false merges
 * and 4 false splits, and the sweep's own optimum is 0.70/0.45 at 2 false merges and 4 false
 * splits with recall up from 0.308 to 0.538. Two false merges is the floor either way: two
 * negative pairs are byte-identical *as this scorer reads them* (an office whose holder
 * changed, a generic guard title reused in two settlements), because it reads names and
 * aliases and those two pairs share both.
 *
 * **Unchanged by issue #310, measured rather than assumed.** #310 gave both sides of a
 * comparison a `MatchContext` and it fixed the embedding scorer's ordering; scored on this one
 * over the same corpus it makes it worse, exactly the way character trigrams predict. Two
 * exports of one entity word their summaries differently, so the union of trigrams grows
 * faster than the intersection: separation falls from 0.225 to 0.133, and at this band the
 * scorer decides 0 of 13 true pairs and produces 12 false splits against the present 4. So the
 * lexical text stays names and aliases, this band stays the band measured for exactly that,
 * and `matching-sweep` reports both texts on every run so the claim stays arguable.
 *
 * So the whole gain on offer is decisive-match recall, and buying it means dropping
 * `matchAbove` by 0.15 - loosening the expensive direction, on the evidence of a 24-pair
 * corpus, where the pair that would newly auto-match is one entry moving across a boundary.
 * That is not enough to loosen the direction where a mistake silently folds two of the GM's
 * entities into one, so the value stays and the number that would replace it is written down
 * here for the next run to argue with. The asymmetry is the same one
 * `packages/copilot/src/relation-types.ts`'s `SEMANTIC_REUSE_THRESHOLD` reasons about: a
 * false "new" costs the GM one merge, a false "match" costs an entity.
 *
 * Exported once, here, so `onboarding.ts` and `packages/bench`'s end-to-end harness
 * import the same binding instead of each hand-copying the literal - the shape issue
 * #272 named for the budget constants: a private copy has no way to notice when the
 * value it is supposed to mirror changes. */
export const MATCH_THRESHOLDS: MatchThresholds = { matchAbove: 0.85, newBelow: 0.5 };

/**
 * The band the **embedding** scorer (`createEmbeddingSimilarity`) runs with. A separate
 * constant because a threshold is a property of the score's distribution and not of the
 * decision, and cosine and Jaccard do not share one: `docs/models.md` and
 * `packages/indexing/src/models.ts` already record that for retrieval ("absolute cosines are
 * on a different scale... shipping this model while keeping the old threshold would have
 * thrown away most correct hits, silently"), and matching is the same trap with the sign
 * flipped.
 *
 * **Re-derived for issue #310, and the old value would now be wrong.** #279 measured this band
 * over a cosine of bare names and got 0.96/0.70. #310 gave both sides of the comparison the
 * `MatchContext` above, which changes the distribution the band is a property of, so it was
 * measured again rather than carried across: `packages/bench`'s `matching-sweep --runs=9`,
 * same 24-pair corpus, same `alibaba/qwen3-embedding-4b` at 2560 dimensions, nine runs so the
 * jitter is visible instead of assumed. Carrying 0.96/0.70 over costs 3 false splits on the
 * new distribution, because 0.96 now sits above every score the corpus produces at all.
 *
 * What the nine runs found, in the order it matters:
 *
 *  1. **The ordering is fixed, which is what #279 could not do with a threshold.** Names only:
 *     mean cosine 0.912 over true pairs against 0.853 over false ones, separation 0.059, and
 *     the best false pair at 1.000 because two negatives were byte-identical text. Names plus
 *     context: 0.779 against 0.508, separation **0.272**, best false pair 0.703, worst true
 *     pair 0.613. Over same-type pairs only, which is the shape a real candidate pool has,
 *     separation is 0.252. Nothing is byte-identical any more.
 *  2. **0.75 is where the expensive error stops.** The highest-scoring negative is the generic
 *     guard title reused in two settlements at 0.703, and the father-and-son pair §6.4 names
 *     as "two characters collapsed into one" has fallen from 0.953 to 0.553. 0.75 clears the
 *     highest negative by 0.047, which is thirteen times the largest run-to-run spread any
 *     pair showed (0.0037), so a false merge here would take a different model rather than a
 *     different run. It still costs nothing on the case that dominates a real re-import: an
 *     unchanged name and body is byte-identical text and `createEmbeddingSimilarity`
 *     short-circuits it to exactly 1 without reaching a threshold.
 *  3. **0.60, with its headroom stated rather than implied.** The lowest true pair is the
 *     retitle §6.4 opens with, "the Gilded Rat" against "Gilded Rat Tavern", at 0.613, and the
 *     highest negative below the bound is 0.589. 0.613 sits 0.013 above 0.60: three and a half
 *     times the largest spread observed anywhere in nine runs, and thirteen times that pair's
 *     own (0.0037), which clears the "treat any bound within about 0.01 of a score as
 *     undecided" rule #279 wrote into this constant. It is the tightest bound in the band and
 *     the only one where a drift would make an error rather than a question, so the
 *     conservative alternative is recorded for the next run to argue with: 0.75/0.55 has the
 *     same zero errors with 0.061 of headroom instead of 0.013, and costs two extra questions,
 *     both of them on negatives. If a wider corpus ever puts a true pair between 0.55 and
 *     0.60, that is the value to move to.
 *
 * What this band buys: **0 false merges and 0 false splits on the corpus, asking about 8 of 24
 * pairs where the 0.96/0.70 band over bare names asked about 20 and still made 2 false merges.**
 * Decisive-match recall goes from 0.077 to 0.615 at precision 1.000. The remaining 8 questions
 * are the in-between band SPEC.md §6.4 asks for and not a residual failure: 3 of them are
 * negatives the model put near the true pairs (an office whose holder changed, a tavern name
 * reused in another town) and 5 are true pairs it put just under the match bound, which is
 * exactly the population a GM should be asked about once.
 *
 * SPEC.md §16's open decision #3 stays open: this cites a real run, but 24 hand-written pairs
 * are still not the "labelled corpus of real export pairs" §6.4 describes.
 */
export const EMBEDDING_MATCH_THRESHOLDS: MatchThresholds = { matchAbove: 0.75, newBelow: 0.6 };

export type SimilarityFn = (
	subject: MatchSubject,
	candidate: MatchCandidate
) => number | Promise<number>;

export interface ResolveMatchInput {
	subject: MatchSubject;
	/** An existing entity found by exact external-id match (SPEC.md §6.4 step 1), if any.
	 * When present this short-circuits everything else below - no model call, no
	 * ambiguity, no candidate list needed. */
	exactSourceRefMatch: MatchCandidate | null;
	/** Candidates already narrowed to the same universe and entity type - the caller's
	 * job (SPEC.md §6.5: "every tool call is checked against the job's universe"), not
	 * this function's. */
	candidates: MatchCandidate[];
	/** SPEC.md §6.4's order gains a step between the external id and the embeddings
	 * (issue #479): a free, deterministic identity collision check against everything the
	 * universe already carries under this slug or name, type-blind. Absent means the caller
	 * has no identity pool to offer, which is what every pre-#479 caller and the matching
	 * benchmark pass; the outcome is then exactly what it was. */
	identity?: { subject: SubjectIdentity; candidates: IdentityCandidate[] };
	similarity: SimilarityFn;
	thresholds: MatchThresholds;
	/** Caps how many candidates ever reach `similarity` (issue #36/#37's "cheapest
	 * first"): above this count, `preFilterCandidates` narrows by name overlap first.
	 * Default 20 - generous for a single document's worth of candidates, still bounded,
	 * and measured rather than assumed (issue #666: see `DEFAULT_PRE_FILTER_LIMIT`). */
	preFilterLimit?: number;
	/** issue #666: called once, and only when the pre-filter actually ran, with what it was
	 * handed and what survived. It lives here rather than in the caller's own arithmetic
	 * because only this function knows whether the pre-filter ran at all: an external id or
	 * an identity collision settles a sighting above it, and "not narrowed" and "narrowed by
	 * nothing" are different facts. `job-runner.ts` counts it per document next to
	 * `truncatedPools`, which counts the other cap. */
	onPreFilter?: (narrowing: PreFilterNarrowing) => void;
}

/** What the pre-filter did to one sighting's pool (issue #666). `scoredSize` is how many
 * candidates reached `similarity`, so `poolSize - scoredSize` is what the tie-break on
 * input order silently decided against. */
export interface PreFilterNarrowing {
	poolSize: number;
	scoredSize: number;
}

/**
 * How many candidates reach the scorer when a caller states no limit, and therefore the
 * merge engine's real cap on the candidate pool: `candidateEntitiesForMatching`'s 200 is
 * the read, this is the decision (issue #666).
 *
 * **20 stays, and here is what it costs.** `packages/bench/src/pool-ordering.ts`'s part 4
 * sweeps this number over the labelled corpus in a real universe grown to a stated size,
 * under the production `slug` ordering and the production embedding scorer
 * (`alibaba/qwen3-embedding-4b`, band 0.60/0.75). Two identical runs, 2026-08-24, 15
 * subjects of which 9 have a true candidate:
 *
 * | entities of one type | limit | true candidates unscored | false merges | false splits | weighted | sim calls | texts |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | 59, hardest wording | 20 | 2 | 2 | 4 | 14 | 300 | 87 |
 * | 59, hardest wording | 40 | 0 | 2 | 2 | **12** | 600 | 144 |
 * | 209, hardest wording | 20 | 2 | 2 | 4 | 14 | 300 | 90 |
 * | 209, hardest wording | 40 | 2 | 2 | 4 | 14 | 600 | 148 |
 * | 209, hardest wording | 100 | 0 | 2 | 2 | **12** | 1500 | 324 |
 * | 209, hardest wording | 200 | 0 | 2 | 2 | 12 | 3000 | 615 |
 *
 * So the narrowing does cost real accuracy, and a wider window does buy it back: the two
 * subjects it loses are `SAMPLE_WORLD_MATCHING_CORPUS`'s translated names, "Il Ratto Dorato"
 * against "the Gilded Rat" and "il Patto di Cenere" against "the Ashen Covenant", and
 * recovering them turns two false splits into one match and one question with no new false
 * merge. On the `easiest` wording, where the universe also holds a wording that shares a
 * token, nothing is ever lost at any limit, because the pre-filter ranks a token-sharer
 * first regardless of the window. Under the lexical scorer the weighted cost does not move
 * at any limit at any size, so this is a finding about the embedding scorer specifically.
 *
 * Three reasons it is still 20 rather than 40.
 *
 * **No constant is the fix, because the limit that recovers scales with the universe.** The
 * recovery threshold is roughly half the type's population: 30 at 59 entities of a type, 60
 * at 109, 120 at 189, 100 at 209. That is what a uniformly distributed slug implies, since a
 * candidate the ordering knows nothing about sits at an expected rank of half the pool. A 40
 * that fixes a 250-entry world is a 40 that fixes nothing at 800, and above 200 of one type
 * the SQL cap has already dropped the candidate so no limit reaches it at all (measured: 6
 * of 9 unscored at 1009 of a type, unchanged from limit 10 to limit 200).
 *
 * **Widening buys the cheap error at the risk of the expensive one, on a scorer this corpus
 * cannot audit for it.** SPEC.md §6.4 weights a false merge five times a false split, and
 * `docs/models.md` records this embedding model scoring "Aldric Voss" against "Seraphine
 * Duval", two entities with nothing in common, at 0.843 on bare names, above a `matchAbove`
 * of 0.75. The band works because #310 gives both sides context lines, but a scorer that
 * flat is one where admitting 80 more candidates per sighting is a false-merge exposure, and
 * 15 subjects with 2 false merges is not enough to detect one more. `docs/models.md` says
 * the same thing about its own 19 judged cases.
 *
 * **The window does not need to be wider, it needs to be right.** The candidates this
 * ordering decides are exactly the ones sharing no token with the subject (#641), so the
 * ordering that would put the translation in the first 20 is embedding distance. That is
 * issue #679, and it is a change to which 20, not to how many. Measured since, as a fourth
 * arm of `packages/bench`'s `pool-ordering`: it recovers both translated names at every
 * size, adds no false merge, and holds the weighted cost at its 29-entity value all the way
 * to 1009 of one type. It also turned out not to be reachable from what is in Qdrant today,
 * which #679 is where to read about rather than here.
 *
 * What would reopen this: a labelled corpus large enough to price a false merge, or #679
 * landing and making the question moot. The figure that says whether it matters on a real
 * import is `DocumentOutcome.narrowedPools`, which exists because of this issue.
 */
export const DEFAULT_PRE_FILTER_LIMIT = 20;

/**
 * Runs SPEC.md §6.4's full matching order for one proposed entity: exact source-ref match
 * first (free), then the identity collision guard (also free, issue #479), then semantic
 * similarity over a name-overlap-narrowed candidate set, classified against `thresholds`
 * into a decisive match, a decisive new entity, or the in-between band that must be asked
 * rather than guessed.
 *
 * The identity step sits above the scorer rather than beside it, and #479 is why: the
 * scorer had the right candidate in hand and still said `new`. An identical name is not
 * decisive in the text `matchTextFor` embeds, because since issue #310 both sides carry
 * three lines of context and only one of the four lines agreed - cosine 0.5446 on
 * `alibaba/qwen3-embedding-4b`, under a `newBelow` of 0.60, so the in-between band was
 * never even reached. The lexical fallback misses the same pair for its own reason (0.4231
 * under a `newBelow` of 0.50, because the subject carried a foreign alias). A guard that
 * runs before either scorer is the only one that cannot be re-broken by a threshold move,
 * a model swap or a change to what gets embedded.
 */
export async function resolveMatch(input: ResolveMatchInput): Promise<MatchDecision> {
	if (input.exactSourceRefMatch) {
		return { outcome: 'exact', candidateId: input.exactSourceRefMatch.id };
	}
	if (input.identity) {
		const collision = findIdentityCollision(input.identity.subject, input.identity.candidates);
		if (collision) {
			return { outcome: 'identity', candidateId: collision.candidate.id, via: collision.via };
		}
	}
	if (input.candidates.length === 0) {
		return { outcome: 'new' };
	}

	const limit = input.preFilterLimit ?? DEFAULT_PRE_FILTER_LIMIT;
	const narrowed = preFilterCandidates(input.subject, input.candidates, limit);
	// issue #666: reported from here, the one place that knows the pre-filter ran at all.
	// Both steps above settle a sighting without ever reaching it, and a caller reconstructing
	// this from `candidates.length` would count a drop that never happened.
	input.onPreFilter?.({ poolSize: input.candidates.length, scoredSize: narrowed.length });

	const scored = await Promise.all(
		narrowed.map(async (candidate) => ({
			candidate,
			similarity: await input.similarity(input.subject, candidate),
			overlap: nameOverlapScore(input.subject, candidate)
		}))
	);
	// Tie-breaker (SPEC.md §6.4): on a near-identical semantic score, prefer the
	// candidate with higher normalized name/alias overlap rather than an arbitrary one.
	scored.sort((a, b) => b.similarity - a.similarity || b.overlap - a.overlap);
	const best = scored[0];
	if (!best) return { outcome: 'new' };

	if (best.similarity >= input.thresholds.matchAbove) {
		return { outcome: 'match', candidateId: best.candidate.id, similarity: best.similarity };
	}
	if (best.similarity < input.thresholds.newBelow) {
		return { outcome: 'new' };
	}
	const inBand = scored.filter(
		(s) => s.similarity >= input.thresholds.newBelow && s.similarity < input.thresholds.matchAbove
	);
	return {
		outcome: 'ask',
		candidateIds: inBand.map((s) => s.candidate.id),
		similarity: best.similarity
	};
}
