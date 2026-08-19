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

export interface MatchCandidate {
	id: string;
	name: string;
	aliases: string[];
}

export interface MatchSubject {
	name: string;
	aliases: string[];
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
 * that ordering among equals. */
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

export type MatchDecision =
	| { outcome: 'exact'; candidateId: string }
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
 * negative pairs in the corpus are byte-identical as text (an office whose holder changed, a
 * generic guard title reused in two settlements) and no name-based scorer can separate them.
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
 * **Measured, issue #279**, same 24-pair corpus and same run as `MATCH_THRESHOLDS` above,
 * with `alibaba/qwen3-embedding-4b` at 2560 dimensions. What that run found, in the order it
 * matters:
 *
 *  1. **Reusing 0.85/0.50 would have been broken, not merely suboptimal.** The lowest cosine
 *     any pair in the corpus reached was 0.642 (two entities with nothing whatsoever in
 *     common), so `newBelow: 0.50` is below the floor: the "new" outcome becomes unreachable
 *     and every unmatched entity turns into a question. At 0.85/0.50 the embedding scorer
 *     also produced 5 false merges against the trigram scorer's 2.
 *  2. **0.96 is where the expensive error stops.** The highest-scoring negative pair that a
 *     name can actually distinguish is "Aldric Voss" against "Aldric Voss the Younger" at
 *     0.953 - literally §6.4's "two characters collapsed into one". Above 0.96 the only
 *     false merges left are the two byte-identical pairs no scorer can separate, which is
 *     the floor. It costs almost nothing on the case that matters most in practice: an
 *     unchanged name between two exports is byte-identical text, and
 *     `createEmbeddingSimilarity` short-circuits that to exactly 1.
 *  3. **0.70, and not the boundary the corpus appears to offer.** SPEC.md §6.4's own example,
 *     "the Gilded Rat" against "Il Ratto Dorato", scores about 0.80, and the lowest true pair
 *     in the corpus, "Brackwater Mire" against "Brackwater", scores 0.782 with the highest
 *     negative underneath it at 0.777. That is a five-thousandth-wide gap, and two runs of
 *     this same sweep against this same model scored the bilingual pair 0.802 and 0.799, so a
 *     `newBelow` placed inside that gap decides by noise rather than by similarity. (The
 *     jitter is the same one `packages/indexing/src/models.ts` measured from the other side:
 *     repeated calls for one text return vectors with cosine self-similarity 0.99989.) 0.70
 *     sits clear of every true pair by 0.08, so it can only ever fire on a pair the model put
 *     nowhere near a match.
 *
 * What this band buys and what it costs, stated rather than implied: it holds false merges at
 * the floor and false splits at zero, and it pays for both by asking. On this corpus the
 * embedding scorer decides 1 of 13 true pairs outright and asks about 20 of 24 pairs, where
 * the trigram scorer decides 4 and asks about 7. Two facts make that the right side of §6.4's
 * weighting rather than a good result: the case that dominates a real re-import is an
 * unchanged name, which is byte-identical text and short-circuits to exactly 1 without ever
 * reaching a threshold; and a question is what §6.4 asks for in the in-between band, while a
 * false merge is the error it calls expensive. The reason the band has to be this wide is
 * that a cosine over bare proper nouns has very little to work with - two unrelated personal
 * names of the same shape already sit at 0.843 - and the fix for that is to embed more than
 * the bare name, which is issue #310 rather than a threshold.
 */
export const EMBEDDING_MATCH_THRESHOLDS: MatchThresholds = { matchAbove: 0.96, newBelow: 0.7 };

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
	similarity: SimilarityFn;
	thresholds: MatchThresholds;
	/** Caps how many candidates ever reach `similarity` (issue #36/#37's "cheapest
	 * first"): above this count, `preFilterCandidates` narrows by name overlap first.
	 * Default 20 - generous for a single document's worth of candidates, still bounded. */
	preFilterLimit?: number;
}

const DEFAULT_PRE_FILTER_LIMIT = 20;

/**
 * Runs SPEC.md §6.4's full matching order for one proposed entity: exact source-ref match
 * first (free), then semantic similarity over a name-overlap-narrowed candidate set,
 * classified against `thresholds` into a decisive match, a decisive new entity, or the
 * in-between band that must be asked rather than guessed.
 */
export async function resolveMatch(input: ResolveMatchInput): Promise<MatchDecision> {
	if (input.exactSourceRefMatch) {
		return { outcome: 'exact', candidateId: input.exactSourceRefMatch.id };
	}
	if (input.candidates.length === 0) {
		return { outcome: 'new' };
	}

	const limit = input.preFilterLimit ?? DEFAULT_PRE_FILTER_LIMIT;
	const narrowed = preFilterCandidates(input.subject, input.candidates, limit);

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
