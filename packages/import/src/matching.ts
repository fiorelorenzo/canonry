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

/** The product's current shipped default for `MatchThresholds`. `apps/web/src/lib/
 * server/onboarding.ts`'s `startImportRun` passes this straight into `ImportJobRunner
 * .run` for every real import job, so this is not a bench-only number - it is the band
 * SPEC.md §6.4 describes ("above a high similarity it is a match, below a low one a new
 * entity, in between the user is asked"), with real numbers in it.
 *
 * It is still a chosen value, not a measured one: SPEC.md §16's open decision #3 says
 * matching thresholds stay open "until the benchmark exists, which is the point: they
 * are measured, not chosen", and `matching-benchmark.ts` is that benchmark - built, but
 * nothing wires its sweep back into this constant yet, and no labelled corpus run has
 * produced a number to replace this one with. 0.85/0.5 leaves a wide ask band on
 * purpose, the same asymmetry `packages/copilot/src/relation-types.ts`'s
 * `SEMANTIC_REUSE_THRESHOLD` reasons about for the sibling relation-type decision: a
 * false "new" costs the GM one merge, a false "match" silently folds two entities into
 * one.
 *
 * Exported once, here, so `onboarding.ts` and `packages/bench`'s end-to-end harness
 * import the same binding instead of each hand-copying the literal - the shape issue
 * #272 named for the budget constants: a private copy has no way to notice when the
 * value it is supposed to mirror changes. */
export const MATCH_THRESHOLDS: MatchThresholds = { matchAbove: 0.85, newBelow: 0.5 };

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
