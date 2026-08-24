/**
 * K1 (#188): resolves a proposed relation label against a universe's own relation types
 * and the shipped catalogue, instead of `packages/db`'s old `findOrCreateRelationType`
 * inventing a type mid-import with no human in the loop. Three rungs, cheapest first,
 * because most labels stop at the first (#189):
 *
 *   1. Normalised exact match, forward and against a type's inverse label - "employs" /
 *      "employ" / "employed by" (the catalogue's own inverse label) are one type, not
 *      three. A label that matches a type's *inverse* resolves to that type rather than
 *      becoming a second one - half the synonym sprawl the epic reports is a model saying
 *      "employed by" where the catalogue already says "employs". For a shipped type this
 *      checks every locale's label and inverse label, not only the one stored on the row
 *      (#197) - "comanda" matches "commands" the same way "commanded by" does.
 *   2. Semantic match over whatever survives rung 1, through an injected `embed` -
 *      "hires" and "works for" share no letters with "employs" but mean the same thing,
 *      which no amount of normalisation will catch. Embeds the same locale-expanded
 *      candidate set rung 1 matches against (#197), so a paraphrase in a language rung 1's
 *      exact match does not cover still has a shot at its own locale's phrasing rather
 *      than needing the embedder to bridge language and wording at once.
 *   3. The allowed-type check (#191): whichever type rungs 1/2 landed on, if it does not
 *      admit this pair of entity types the resolution is `widen-proposed` - never a
 *      silent write, never a rejection. #173 used to widen the catalogue by hand with a
 *      migration; this is the product expressing that itself.
 *
 * Guardrail 1: only `kind: 'existing'` may be written without a human - creating or
 * widening a relation type is creating vocabulary for a whole world, a bigger act than
 * adding one edge. Guardrail 3: `why` is always a sentence a GM can read, never the
 * similarity number rung 2 computes internally to decide - the same rule D6 already holds
 * for entity matching (`packages/import/src/matching.ts` never shows a bare confidence
 * score either).
 *
 * Pure decision logic plus one read (`relationTypesForUniverse`) - no writes. Turning a
 * `new-proposed` / `reuse-proposed` / `widen-proposed` resolution into an actual
 * `relation_type` row is a human accepting a proposal (#190), never this function -
 * `resolveRelationType` only ever *reads* `@canonry/db`.
 *
 * Decision L1 (#195): every rung below still matches against `label`/`inverseLabel`, on
 * purpose, and this is not a bug to "fix" onto `key` - a model or an import document
 * proposes a word ("hires", "employed by"), never a key, so there is nothing to compare
 * a key against until a type is already chosen. The *result* is what carries identity: a
 * `RelationTypeRow` full row, `.key` included, so every caller (`packages/import/src/
 * job-runner.ts`, this file's own callers) identifies the resolved type by `.key`
 * (or the row's `.id` for a foreign key write), never by re-deriving it from the label
 * that got it there.
 *
 * Issue #197: rungs 1 and 2 both match a proposed label against every shipped locale's
 * strings for a candidate type, not just the caller's active one - an Italian corpus
 * proposing "comanda" has no reason to know English, and matching it only against the
 * catalogue's English label used to fork a needless universe-scoped duplicate for every
 * one of the ten shipped types. `@canonry/lang`'s `relationTypeMatchCandidates` is the
 * one place that expansion happens, shared by `isForwardMatch`/`isInverseMatch` (rung 1)
 * and `bestSemanticMatch` (rung 2). Not injected the way `embed` is - see
 * `packages/lang/src/relation-catalogue.ts`'s own doc comment for why fixed shipped
 * content is not a seam. Rung 2 leans on the injected `embed` being a genuinely
 * multilingual model - the property #168's own embedder selection measured for and chose
 * it on - to bridge a proposed label in one language against a candidate's text in
 * another; swapping in a monolingual embedder would not error, it would just quietly stop
 * this rung matching anything outside the one language it was trained on.
 *
 * Lives here rather than in `packages/import` (where the only caller happens to be today)
 * because the copilot's own propose paths will want this the moment they can create a
 * relation themselves, and duplicating the reconciliation logic per caller is exactly the
 * synonym sprawl this issue exists to stop.
 */
import type { Db } from '@canonry/db';
import { relationTypesForUniverse, type RelationTypeRow } from '@canonry/db';
import type { EntityType, RelationCardinality } from '@canonry/db/schema';
import { normalizeRelationLabel, relationTypeMatchCandidates } from '@canonry/lang';

export type RelationTypeResolution = {
	/** True when the proposed label matched the chosen type's *inverse* label, so the
	 * relation reads in the opposite direction to the type's own (issue #628). The caller
	 * writing the row MUST swap which entity plays `from_entity_id` and which plays
	 * `to_entity_id` when this is set: everything else in the resolution (the admission
	 * check that produced it, a `widen-proposed`'s `addFrom`/`addTo`, a `new-proposed`'s
	 * `from`/`to`) is already expressed in the type's own canonical direction.
	 *
	 * This used to be the caller's own job to re-derive with an exported `isInverseMatch`,
	 * and no caller ever did it, which is #628's three `member of` refusals: the notebook
	 * said "X Astartes 5 ha come membro Myra", rung 1b matched the shipped `member of`'s
	 * Italian inverse label and checked admission on the swapped pair (character ->
	 * faction, admitted), and then `job-runner.ts` wrote the ends as the model gave them,
	 * so the accept met faction -> character and #191 refused it. A fact the resolver
	 * already knows is returned rather than left for a caller to reconstruct. */
	reversed: boolean;
} & (
	| { kind: 'existing'; type: RelationTypeRow }
	| { kind: 'reuse-proposed'; type: RelationTypeRow; proposedLabel: string; why: string }
	| {
			kind: 'widen-proposed';
			type: RelationTypeRow;
			addFrom?: EntityType;
			addTo?: EntityType;
			why: string;
	  }
	| {
			kind: 'new-proposed';
			label: string;
			inverseLabel: string;
			cardinality: RelationCardinality;
			from: EntityType;
			to: EntityType;
			why: string;
	  }
);

/** Injected exactly like `@canonry/indexing`'s own embedding seam (the same idiom
 * `packages/copilot/src/ask.ts`'s `QueryEmbedder` already uses), typed locally so this
 * file does not carry a hard dependency on that package's internal type name. Batches
 * every text this resolver needs to compare in one call, same as retrieval does. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface ResolveRelationTypeDeps {
	db: Db;
	embed: Embedder;
}

export interface ResolveRelationTypeInput {
	universeId: string;
	/** The label the model proposed, verbatim - never pre-normalised by the caller, this
	 * function owns that. */
	label: string;
	/** The inverse label the model proposed. Only used if this resolves to `new-proposed`
	 * - an existing type's own `inverseLabel` always wins over a fresh guess once rung 1
	 * or 2 has matched one, so two callers proposing the same relation differently
	 * (`employs`/`employed by` vs `employer of`/`employee of`) still converge on one row. */
	inverseLabel: string;
	cardinality: RelationCardinality;
	/** The entity type on the "from" side exactly as the caller gathered it - i.e. the type
	 * of the entity that will become `relation.from_entity_id`, read off that entity (or
	 * off the pending proposal that will create it) rather than off whatever the model
	 * declared elsewhere in the document (issue #628). Rung 1's inverse-label match and
	 * rung 3's allowed-type check both reason about the type's own canonical (label)
	 * direction internally; when the match was against an inverse label the resolution
	 * comes back `reversed`, which tells the caller to swap the two ends before writing. */
	fromType: EntityType;
	toType: EntityType;
}

// ---------------------------------------------------------------------------
// Rung 1: normalised exact match.
// ---------------------------------------------------------------------------

/** Rung 1's identity function for a relation label lives in `@canonry/lang`, beside the
 * catalogue it compares against (issue #669 moved it there): `packages/db`'s vocabulary dedupe
 * key has to answer the same "are these two labels the same question" that this rung answers,
 * and it cannot depend on this package. See that module's own doc for the three rules and for
 * why two of them are Italian without being switched on by locale. */

/** Whether `label` (after normalising) reads as `type`'s *inverse* rather than its
 * forward label. Private, like its forward counterpart below: what a caller building the
 * actual `relation` row needs is the *answer* for the type that was chosen, and that now
 * travels on the resolution as `reversed` (issue #628). This was exported so a caller
 * could re-derive it, which is precisely the reconstruction no caller performed.
 *
 * Checks every shipped locale's inverse label for `type`, not just the one stored on the
 * row (#197) - `relationTypeMatchCandidates` is the one place that expansion happens,
 * shared with the forward check below and with rung 2's embedding set. */
function isInverseMatch(type: RelationTypeRow, label: string): boolean {
	const normalizedLabel = normalizeRelationLabel(label);
	return relationTypeMatchCandidates(type).some(
		(candidate) =>
			candidate.direction === 'inverse' &&
			normalizeRelationLabel(candidate.label) === normalizedLabel
	);
}

/** `isInverseMatch`'s forward-direction counterpart. Rung 1a below is the only caller. */
function isForwardMatch(type: RelationTypeRow, label: string): boolean {
	const normalizedLabel = normalizeRelationLabel(label);
	return relationTypeMatchCandidates(type).some(
		(candidate) =>
			candidate.direction === 'forward' &&
			normalizeRelationLabel(candidate.label) === normalizedLabel
	);
}

/** A universe's own override of a shipped label wins over the catalogue on an exact tie
 * (both exist per `relation.test.ts`'s "allows a universe-scoped relation type to reuse a
 * label from the shipped catalogue") - a GM who deliberately re-defined "employs" for
 * their world presumably means their own definition, not the shipped default sitting
 * behind it. */
function preferUniverseOwned(candidates: RelationTypeRow[], universeId: string): RelationTypeRow[] {
	return [...candidates].sort((a, b) => {
		const aOwn = a.universeId === universeId ? 0 : 1;
		const bOwn = b.universeId === universeId ? 0 : 1;
		return aOwn - bOwn;
	});
}

// ---------------------------------------------------------------------------
// Rung 3: the allowed-type check (#191).
// ---------------------------------------------------------------------------

interface AdmissionCheck {
	admitted: boolean;
	addFrom?: EntityType;
	addTo?: EntityType;
}

/** `fromType`/`toType` here are always the pair in `type`'s own canonical (label)
 * direction, already swapped by the caller if the match was against an inverse label -
 * see the two call sites below. */
function checkAdmission(
	type: RelationTypeRow,
	fromType: EntityType,
	toType: EntityType
): AdmissionCheck {
	const fromOk = type.allowedFrom.includes(fromType);
	const toOk = type.allowedTo.includes(toType);
	if (fromOk && toOk) return { admitted: true };
	return {
		admitted: false,
		...(fromOk ? {} : { addFrom: fromType }),
		...(toOk ? {} : { addTo: toType })
	};
}

// ---------------------------------------------------------------------------
// Rung 2: semantic match.
// ---------------------------------------------------------------------------

/** Real cosine similarity (not an assumption that `embed` already L2-normalises its
 * output, which the `Embedder` seam does not promise) - 0 for either zero vector rather
 * than `NaN`, since a zero vector is a legitimate embedder output for an empty string and
 * "no similarity" is the right answer for it, not a crash. */
function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		normA += x * x;
		normB += y * y;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * The semantic rung's cutoff - deliberately not retrieval's 0.5 (`packages/indexing/src/
 * retriever.ts`): that number is a passage-embedding cosine scale (whole chunks of prose,
 * measured on a 2044-chunk gold corpus), and this is a short-label cosine scale (one to
 * three words). The two do not share a distribution and retriever.ts's own doc comment
 * says as much - "a threshold does not transfer between embedding models", and it does
 * not transfer between text *lengths* either, for the same reason: cosine similarity
 * between short bags of words concentrates very differently than between long ones.
 *
 * What I could actually measure in this environment: this repo's only network-free
 * embedder, `hashingEmbedder` (`@canonry/indexing`), which every existing test in this
 * package uses in place of a live model (no AI Gateway credentials are exercised by any
 * test here - see `ask.test.ts`'s own comment). Measuring it directly disqualifies it as
 * a source for this number rather than justifying one: at its 256-bucket hash width,
 * *two entirely unrelated one-word labels* ("commanded" and "member" - opposite
 * relation concepts, command vs. faction membership) hash-collide into the exact same
 * bucket and score a perfect 1.0, and two-word phrases sharing only a stopword
 * ("commanded by" / "employed by", sharing only "by") score 0.5 purely from bag-of-words
 * term overlap with no semantic content at all. Neither failure mode is a property a real
 * dense embedding model shares - collisions and stopword-dominated short vectors are
 * artifacts of hashing raw tokens into 256 buckets - so a number calibrated against them
 * would be calibrated against noise, not signal.
 *
 * So this is not empirically derived, and I am saying so rather than passing off a guess
 * as a measurement (which is exactly what copying retrieval's 0.5 would have been). It is
 * set conservatively high on purpose: this rung's two failure modes are not symmetric.
 * Merging two genuinely different relation concepts under one type (a false "reuse")
 * silently corrupts the graph - every existing relation of that type now carries a label
 * that is wrong for some of the edges under it, and nothing flags that it happened. Row
 * splitting them (a false "new") costs a GM one extra decision, which #192's
 * `mergeRelationTypes` fixes for free after the fact. A threshold this conservative will
 * under-merge until it is properly calibrated, and that is the safe direction to be wrong
 * in until it is.
 *
 * The benchmark this actually needs: a gold set of {existing catalogue label, proposed
 * label, same-type or not} pairs (the epic's own four `employs` synonyms are a start, but
 * far too small a sample on their own), embedded with the real gateway model
 * production actually wires in (`createGatewayEmbedder`, `packages/indexing/src/
 * embedding.ts`), swept for the cutoff that separates them the way `packages/bench`'s
 * retrieval-sweep did for `retriever.ts`'s own threshold (`pnpm --filter @canonry/bench
 * retrieval-sweep`, `@canonry/eval`'s `thresholdSweep`) - and re-run whenever the
 * embedding model changes, for the exact reason retriever.ts's own history documents.
 *
 * Issue #629 measured half of it, on the real Italian notebook #613 recorded: all 126 labels
 * that import proposed, scored against the whole locale-expanded catalogue with the gateway
 * embedding model production actually resolves (`alibaba/qwen3-embedding-4b`, 2560d). **Its
 * numbers were taken with a broken instrument and are not quoted here any more** (#668): the
 * bench harness's embedding cache returned a displaced vector after a duplicate in a batch, and
 * the batch `bestSemanticMatch` builds carries four, so 19 of the 36 strings the catalogue is
 * known by were scored against the wrong vector. What survived the correction is #629's
 * conclusion rather than its table: at 0.86 nothing crosses that rung 1 had not already
 * matched, and the highest score any genuine rung-2 candidate reaches is 0.8414, "situata in"
 * against `located in`. That number has now been reproduced three times through three code
 * paths, which is why it is the one figure from #629 worth keeping.
 *
 * #637 built the gold set and exported this constant to do it: 50 labelled pairs, three
 * outcomes (`same` / `inverse` / `distinct`), false merge weighted 5x, direction error 2x,
 * false split 1x, run against the real gateway model by
 * `pnpm --filter @canonry/bench relation-label-sweep`. **Issue #657 is where this number was
 * finally priced, and the answer is that it stays.** As #687 measured it, on the raw label and
 * before #689 moved `is part of` out of the rung-2 subset: 39 pairs of which 14 are true,
 * 5 runs.
 *
 * | threshold | false merges | direction errors | false splits | merged of 14 | cost |
 * | --- | --- | --- | --- | --- | --- |
 * | 0.82 | 0 | 1 | 9 | 5 | 11 |
 * | 0.84 | 0 | 0 | 11 | 3 | **11** |
 * | 0.86 (shipped) | 0 | 0 | 12 | 2 | 12 |
 * | 0.90 | 0 | 0 | 14 | 0 | 14 |
 *
 * So the corpus's cost minimum is 11 and this value costs 12, one false split above it. Three
 * reasons it stays there anyway, and the third is the one that decided it:
 *
 * 1. **The whole difference is one pair, 0.0014 above 0.84.** "situata in" at 0.8414 is what
 *    the notch buys, and the 0.01 jitter floor `matching-sweep` carries from #279's measurement
 *    on this same model is seven times that headroom. The sweep says so itself: it reports 0.84
 *    as the cheapest threshold and 0.86 as the cheapest one no pair's jitter can cross. The
 *    observed spread on these labels is 0.0000 to 0.0011 over five runs, twenty times under the
 *    floor, so the floor rather than the observation is doing the work - and a floor is the
 *    right thing to trust for a constant that only moves when somebody re-measures it.
 * 2. **The cost gap is entirely in the cheap direction.** Both thresholds commit zero false
 *    merges and zero direction errors; 12 against 11 is one extra false split, which costs a GM
 *    one decision that #192's `mergeRelationTypes` undoes. A false merge under L1 does not undo.
 * 3. **On the corpus that motivated all of this, the notch buys one relation of 187 and no
 *    questions at all.** Replayed at 0.84 against the kept OneNote recording: 122 vocabulary
 *    questions, exactly as at 0.86, and one extra `relation_type_reuse` ("situata in" onto
 *    `located_in`) carrying a single relation. The other ten relations under that label match
 *    the type and then fail its admission check, so they fork under the shipped `located in`
 *    label and land on a question that already existed; and the six relations written
 *    "situato in" score 0.8221, so 0.84 splits a group #669's normaliser had just merged into
 *    one question. Whatever else that is, it is not a lever.
 *
 * **Issue #669 is why the value of this rung fell rather than the threshold moving.** It taught
 * `normalizeRelationLabel` Italian gender agreement and the enclitic article, and two of the
 * four correct merges 0.86 was buying on the gold set ("protetta da" at 0.9857, "nominato dal"
 * at 0.9585) are now resolved at rung 1 for free, with no embedding call. The cost curve did not
 * move, because both were above 0.86 and removing a correct merge above the threshold removes no
 * error at or below it; what moved is what the rung is for. It buys two pairs on the gold set now
 * instead of four, and four reuse proposals on the real notebook. Paying for a fifth with a
 * permanent `key` is the wrong trade at this evidence level.
 *
 * What would change this answer, stated so the next person does not have to re-derive it: a
 * second corpus, in a language that is not Italian. The gold set is 50 pairs from one Italian
 * notebook and is deliberately enriched with boundary cases, so "3 correct merges of 14 at 0.84"
 * is the behaviour on pairs chosen to sit near the line and not a hit rate over arbitrary
 * labels. Re-run the sweep on any embedding-model change (`docs/models.md`'s `embedding`
 * section names it beside `matching-sweep`), and if a second corpus puts a second pair in the
 * 0.84-0.86 band, move it: at that point the case is two independent pairs rather than one
 * inside the jitter floor.
 *
 * `matching.ts` exports `MATCH_THRESHOLDS` for the same reason this is exported: a sweep has to
 * state what the shipped value costs on the corpus, next to what the optimum costs, or it is
 * only reporting an optimum. Nothing outside a benchmark reads it, and `resolveRelationType` is
 * still the only thing that decides with it.
 *
 * **Two changes since, and they leave the answer standing on firmer ground than #657 found it
 * on.** #689 folded a leading copula into the normaliser, so `is part of` resolves at rung 1
 * and the subset above is 38 pairs of which 13 are true: every `merged of 14` cell loses one and
 * 0.90's false splits read 13, while no false-merge or direction-error cell moves, because that
 * pair scored 0.8814 and was a correct merge at every row here. And #690 changed what this rung
 * embeds, from the raw label to `normalizeRelationLabel`'s output on both sides, which re-prices
 * the whole table; `bestSemanticMatch` below carries it, and the part that matters here is that
 * **0.84, 0.86 and 0.88 now all cost 11**. So the notch reason 1 is about no longer exists: this
 * value is at the corpus's minimum rather than one false split above it, and "situata in", the
 * single pair that bought 0.84, scores 0.7983 today rather than 0.8421. What replaces that
 * argument as the thing to watch is one rung lower: at 0.8210 a direction error appears that the
 * raw subject did not have (#697), so the floor under this constant is now 0.84 for a measured
 * reason rather than a jitter one.
 */
export const SEMANTIC_REUSE_THRESHOLD = 0.86;

/**
 * Issue #690: this embeds `normalizeRelationLabel`'s output rather than the string a model
 * wrote, on both sides, and that is the whole of the change. It is worth this much comment
 * because the measurement did not choose it. The measurement ruled out the objection to it, and
 * decision L1 chose.
 *
 * **The bug it closes, and why its failure mode is the expensive kind.** Rung 1 compares
 * normalised labels and so does `packages/db`'s vocabulary dedupe key (`dedupKeyFor`), so after
 * #669 and #689 `situata in` and `situato in` are one question by the time a GM reads one.
 * Embedding the raw label meant this rung did not agree: the two score 0.8421 and 0.8221 against
 * `located in`, and a threshold between them resolves one and asks about the other. That is not
 * a false split. It puts one concept under two permanent keys, a shipped one for the spelling
 * that crossed and a new one for the spelling that did not, and under L1 neither goes away.
 * Nothing is observably wrong at the shipped 0.86 because neither crosses it, and #690 measured
 * what 0.84 does instead: eleven relations resolve onto `located in` while six stay their own
 * question. #657 is the issue that would move that threshold. Comparing normalised text on both
 * sides makes the disagreement impossible rather than unlikely, and it is visible in the sweep:
 * `situata in`, `situato in` and `risiede nel` now score identically instead of in an accidental
 * order.
 *
 * **What it costs, measured rather than argued.** The normaliser mangles words on purpose, so
 * the model sees `locat in` where the catalogue says `located in`. `packages/bench`'s
 * `relation-label-sweep` ran against the real gateway model over #637's 50 labelled pairs, five
 * runs each, on both subjects (`--raw-label` is the old one). On the 38-pair rung-2 subset,
 * 13 true pairs, weighted cost with #637's weights:
 *
 * | threshold | raw subject | normalised |
 * | --- | --- | --- |
 * | 0.80 | 20 | 21 |
 * | 0.82 | **11** | 13 |
 * | 0.84 | **11** | **11** |
 * | 0.86 (shipped) | 12 | **11** |
 * | 0.88 | 12 | **11** |
 * | 0.90 | 13 | 13 |
 *
 * At the shipped value it is one cheaper, and the minimum stops being a single point at 0.84
 * with two pairs' jitter straddling it and becomes a plateau at 0.84, 0.86 and 0.88 that
 * contains the value we ship. `hires` against `employs` goes from 0.6130 to 0.8983 and becomes
 * a correct merge, `guards` from 0.7507 to 0.8195, and `è proprietario di` against `owns` stops
 * being read backwards, all because the stemmer puts the two sides in the same shape. **The trap
 * frontier does not move**, which is the property that had to hold: the highest-scoring
 * `distinct` pair is `occupato da` at 0.8184 normalised against 0.8187 raw, so no false merge
 * comes closer to any threshold anyone would ship.
 *
 * **And the real notebook says the opposite of the gold corpus, which is why the numbers did not
 * decide this.** Replaying the kept OneNote recording, `membro della squadra` stops resolving
 * onto `member_of`: 0.8632 against `membro di` raw, 0.8329 normalised, because folding `della`
 * to `di` removes information the model was using. That is one of the four reuses #686 checked
 * by hand as correct, so this change costs one correct merge there and gains one on #637's
 * corpus, and 122 questions to 121 (#689) becomes 122 again. A wash on merges, and not a wash on
 * L1: a lost merge is a duplicate a GM merges by hand, and the inconsistency above is two keys
 * that cannot be un-created.
 *
 * Two more costs, neither hidden. `situata in` against `located in` falls from 0.8421 to 0.7983,
 * so the one pair 0.84 used to buy is not there to buy any more, which #657 needs to know. And
 * the English stripper takes the `-ed` off the five catalogue inverse labels that carry a
 * direction in their morphology (`employed by` reads as `employ by`, and the same for `owned`,
 * `commanded`, `protected`, `appointed`), so the direction of an English pair rests on the token
 * `by` alone: `works for` flips from `impiegato da` inverse, which it won by 0.0018, to `employs`
 * forward, which it wins by 0.0639, and becomes a direction error at 0.8210 and below. Nothing
 * at or above 0.84 sees it, and it is an argument against lowering the threshold rather than
 * against this change, but it is the sharpest thing the measurement says about what stemming
 * costs a rung that has to answer *which way round*. #697 carries it.
 *
 * Not a cost saving on its own: this still embeds the label plus every candidate label on every
 * relation. What it does is make #629's per-job memoisation strictly more effective when that
 * lands, since two labels rung 1 calls one question are now one cache key (71 distinct texts to
 * 65 over the benchmark corpus).
 */
async function bestSemanticMatch(
	embed: Embedder,
	label: string,
	candidates: RelationTypeRow[]
): Promise<{ type: RelationTypeRow; similarity: number } | null> {
	if (candidates.length === 0) return null;
	// #197: embeds every shipped locale's label and inverse label for a candidate, not
	// just the one stored on the row - see this file's module doc for why that leans on
	// `embed` being multilingual. Still one batched call, same as before; a candidate's
	// score is the best similarity across its own expanded text set, so it is found if
	// *any* of its known synonyms or translations reads close to the proposed label.
	// The direction and the row come off the candidate's index, not off the text, so
	// normalising the text cannot move either.
	const candidateTexts = candidates.map((candidate) =>
		relationTypeMatchCandidates(candidate).map((match) => normalizeRelationLabel(match.label))
	);
	const vectors = await embed([normalizeRelationLabel(label), ...candidateTexts.flat()]);
	const inputVector = vectors[0];
	if (!inputVector) return null;
	let best: { type: RelationTypeRow; similarity: number } | null = null;
	let offset = 1;
	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i]!;
		const texts = candidateTexts[i]!;
		let candidateBest: number | null = null;
		for (let j = 0; j < texts.length; j++) {
			const vector = vectors[offset + j];
			if (!vector) continue;
			const similarity = cosineSimilarity(inputVector, vector);
			if (candidateBest === null || similarity > candidateBest) candidateBest = similarity;
		}
		offset += texts.length;
		if (candidateBest !== null && (!best || candidateBest > best.similarity)) {
			best = { type: candidate, similarity: candidateBest };
		}
	}
	return best;
}

// ---------------------------------------------------------------------------
// The resolver.
// ---------------------------------------------------------------------------

export async function resolveRelationType(
	deps: ResolveRelationTypeDeps,
	input: ResolveRelationTypeInput
): Promise<RelationTypeResolution> {
	const candidates = await relationTypesForUniverse(deps.db, input.universeId);
	const ordered = preferUniverseOwned(candidates, input.universeId);

	// Rung 1a: normalised exact match, forward direction - checks every shipped locale's
	// forward label for a candidate, not just the one stored on the row (#197).
	for (const candidate of ordered) {
		if (isForwardMatch(candidate, input.label)) {
			return resolveAgainstAdmission(
				candidate,
				input.fromType,
				input.toType,
				`"${input.label}" is the existing type "${candidate.label}".`,
				false
			);
		}
	}

	// Rung 1b: normalised exact match against a type's inverse label - reuses the type
	// with the ends reversed rather than creating a second one. `reversed: true` is what
	// obliges the caller to swap the ends when it writes the row (issue #628); the
	// admission check below already runs on the swapped pair.
	for (const candidate of ordered) {
		if (isInverseMatch(candidate, input.label)) {
			return resolveAgainstAdmission(
				candidate,
				input.toType,
				input.fromType,
				`"${input.label}" is the existing type "${candidate.label}"'s inverse label ` +
					`("${candidate.inverseLabel}"), so this reuses it with the relation's ends ` +
					`reversed rather than creating a second type.`,
				true
			);
		}
	}

	// Rung 2: semantic match over the residue - every candidate, since rung 1 found none.
	const best = await bestSemanticMatch(deps.embed, input.label, ordered);
	if (best && best.similarity >= SEMANTIC_REUSE_THRESHOLD) {
		const admission = checkAdmission(best.type, input.fromType, input.toType);
		const why =
			`"${input.label}" reads as the same relation as the existing type "${best.type.label}" ` +
			`- close enough in meaning to reuse rather than duplicate.`;
		if (admission.admitted) {
			return {
				kind: 'reuse-proposed',
				type: best.type,
				proposedLabel: input.label,
				why,
				reversed: false
			};
		}
		return resolveAdmissionGap(best.type, input.fromType, input.toType, admission, why, false);
	}

	// Nothing matched closely enough at either rung: a genuinely new relation.
	return {
		kind: 'new-proposed',
		label: input.label,
		inverseLabel: input.inverseLabel,
		cardinality: input.cardinality,
		from: input.fromType,
		to: input.toType,
		why: `No existing relation type in this universe or the shipped catalogue reads as "${input.label}", so this proposes it as a new type.`,
		reversed: false
	};
}

/** Shared by both rung-1 matches: `fromType`/`toType` are already in `type`'s own
 * canonical direction (the inverse-match call site above passes them swapped), so this
 * only has to run the admission check and shape the result. `reversed` is carried through
 * untouched rather than re-derived, since only the call site knows which rung it is. */
function resolveAgainstAdmission(
	type: RelationTypeRow,
	fromType: EntityType,
	toType: EntityType,
	matchedWhy: string,
	reversed: boolean
): RelationTypeResolution {
	const admission = checkAdmission(type, fromType, toType);
	if (admission.admitted) return { kind: 'existing', type, reversed };
	return resolveAdmissionGap(type, fromType, toType, admission, matchedWhy, reversed);
}

/** Both rung-1 and rung-2 land here once a type is chosen but does not admit the pair.
 * `widen-proposed` names an *existing row to mutate* (`type`), and #192's admin CRUD
 * (`packages/db/src/queries/relation-types.ts`'s `widenRelationType`) refuses to touch a
 * `universe_id`-null row on purpose - the shipped catalogue only changes through a
 * migration (0001_seed_relation_type_catalogue.sql's own comment). So a gap on a *shipped*
 * type can never resolve to `widen-proposed`: there is no row an accept could safely
 * widen. It resolves to `new-proposed` instead, under the shipped type's own canonical
 * label/inverseLabel/cardinality (not the model's raw phrasing) so the fork still reads as
 * "the same 'employs', just wider for this universe" rather than inventing a fourth
 * synonym - #173's migration widened the catalogue globally; this is that same fix, scoped
 * to one universe instead. A gap on a universe's own type has no such obstacle and widens
 * in place. */
function resolveAdmissionGap(
	type: RelationTypeRow,
	fromType: EntityType,
	toType: EntityType,
	admission: AdmissionCheck,
	matchedWhy: string,
	reversed: boolean
): RelationTypeResolution {
	const gap = `${matchedWhy} It does not currently admit ${fromType} -> ${toType}.`;
	if (type.universeId !== null) {
		return {
			kind: 'widen-proposed',
			type,
			...(admission.addFrom === undefined ? {} : { addFrom: admission.addFrom }),
			...(admission.addTo === undefined ? {} : { addTo: admission.addTo }),
			why: gap,
			reversed
		};
	}
	return {
		kind: 'new-proposed',
		label: type.label,
		inverseLabel: type.inverseLabel,
		cardinality: type.cardinality,
		from: fromType,
		to: toType,
		why: `${gap} The shipped catalogue only changes through a migration, so this proposes a universe-scoped "${type.label}" that admits it instead.`,
		reversed
	};
}
