/**
 * The labelled corpus for the relation-label benchmark (issue #637), drawn from the real
 * Italian OneNote notebook #613 recorded and #629 measured: 193 relations, 126 distinct
 * proposed labels, clustering to 113 concepts against a ten-row English catalogue.
 *
 * ## Where the labels come from, stated precisely
 *
 * Three sources, and it matters which is which.
 *
 * - The eleven labels #629's own comment names, quoted from it: "fondata da", "combatte
 *   contro", "situata in", "situato in", "lavora per", "occupato da", "contiene parti di",
 *   "risiede nel", "ha come membro", "minaccia", "venera". Those are the pairs whose
 *   right-or-wrong was one person's judgement by hand, and putting them here is what turns
 *   that judgement into something a later run can contradict.
 * - The rest of the Italian labels are the notebook's own relation vocabulary, read out of
 *   the corpus rather than invented: "guidato da", "governata da", "protetta da", "abitata
 *   da", "occupata da", "sede di", "sindaco di", "nemico di", "alleato di", "sorella di",
 *   "fratello di", "figlia di", "erede di", "maestro di", "distrutta da", "nominato dal".
 *   The corpus is a third party's private campaign, so nothing of it is committed and none
 *   of its prose is quoted; a relation label is a two-word phrase and not prose, and labels
 *   are the entire subject here, which is the line this file deliberately sits on.
 * - A handful of English labels, because a corpus whose proposed side is entirely Italian
 *   cannot tell "the scorer understands the relation" from "the scorer rates any Italian
 *   phrase against this catalogue highly". #188's four `employs` synonyms are two of them.
 *
 * ## The rules this data was written to, because a corpus that assumes its own answer
 * measures nothing
 *
 * **Every verdict is the answer for the relation, not the answer the threshold would like.**
 * `SEMANTIC_REUSE_THRESHOLD` is set conservatively high on purpose, so it is tempting to
 * label a near-miss `distinct` and let the corpus agree with the shipped value. Twelve pairs
 * here are `same` or `inverse` at scores the shipped threshold cannot reach, and that is the
 * measurement, not a defect in the labelling.
 *
 * **Each pair names one catalogue key, and a label with no home appears against several.**
 * "sindaco di" is not `commands` and it is not `member_of`; #639 is the finding that ten
 * shipped types cannot house 113 concepts, and a claim about the *whole* catalogue refusing
 * a label needs more than one pair to make.
 *
 * **The cross-language control is the pair that keeps the rest honest, and #629 is why.**
 * Its central finding was `hashingEmbedder` scoring "fondata da" against `appointed`'s
 * Italian inverse label at a perfect 1.0, a 256-bucket collision, with guardrail 3's own
 * prose attached to it. So this corpus carries pairs whose two sides are a near-translation
 * of a *different* relation: "comandato dal" against `appointed` is one enclitic article
 * from `commands`'s own Italian inverse label and is scored against a different type, and
 * "membro di" against `part_of` (with "parte di" against `member_of` as its reverse
 * reading) is the same trap without changing language at all. A scorer that has learned
 * "Italian passive-agent phrase" rather than the relation merges the first; a scorer that
 * collapses two types the catalogue ships separately merges the second.
 *
 * Note that every pair is cross-language whether it looks it or not:
 * `relationTypeMatchCandidates` expands a shipped type across both locales, so "possiede"
 * and "owned by" are in the same candidate set and production compares against both at
 * once. Splitting the corpus by the proposed label's language would report a number
 * production cannot reproduce.
 *
 * **Twelve pairs carry `rungOne: true`, nine of them because they are byte-identical to a
 * catalogue label, and that is their point.** Rung 1's normalised exact match already resolves
 * them, so they are present to be *subtracted*. #629's headline was that all three labels
 * crossing 0.86 on the real model were exact catalogue labels rung 1 had already matched, which
 * is a semantic-rung contribution of nothing reported as three merges. `runRelationLabelBenchmark`
 * sweeps the rung-2-only subset next to the whole corpus for exactly that reason, and this
 * corpus's own test verifies each `rungOne` flag against the production predicate rather
 * than trusting the declaration.
 *
 * The other three are `protetta da`, `nominato dal` and `is part of`, and they were rung-2 pairs
 * until issues #669 and #689 taught `normalizeRelationLabel` Italian gender agreement, the
 * enclitic article and the leading copula. That they moved here rather than silently changing a
 * number is exactly what the flag is for: all three were *correct* merges at the shipped
 * threshold on the real model (0.9857, 0.9585 and 0.8816 respectively), so the rung-2 subset has
 * gone from 41 pairs and 16 true positives to **38 and 13** across the two issues, and each of
 * the three merges 0.86 used to make is now made one rung earlier for no embedding call at all.
 * Nothing that was `distinct` moved, which is the property that mattered: a `distinct` pair
 * reaching rung 1 would be a false merge under L1 with no proposal in front of it, and the test
 * above is what would have caught it.
 *
 * **No pair against `ally_of` is labelled `inverse`.** Its inverse label is itself, so a
 * direction is meaningless there and a corpus that claimed one would be measuring
 * `relationTypeMatchCandidates`'s ordering.
 */
import type { RelationLabelCorpus } from './relation-label-benchmark.js';

export const ONENOTE_RELATION_LABEL_CORPUS: RelationLabelCorpus = {
	id: 'onenote-relation-labels',
	name: 'OneNote notebook relation labels against the shipped catalogue (issues #629, #637)',
	pairs: [
		// -------------------------------------------------------------------------------
		// Rung 1's own work, present to be subtracted from the semantic rung's credit.
		// -------------------------------------------------------------------------------
		{
			id: 'rung1-membro-di',
			proposedLabel: 'membro di',
			catalogueKey: 'member_of',
			verdict: 'same',
			rungOne: true,
			note: "the catalogue's own Italian forward label - rung 1 resolves it and rung 2 never sees it, which is what makes it a control rather than a merge"
		},
		{
			id: 'rung1-ha-come-membro',
			proposedLabel: 'ha come membro',
			catalogueKey: 'member_of',
			verdict: 'inverse',
			rungOne: true,
			note: "#628's case verbatim: the notebook says a party has a member, which is `member of`'s Italian inverse label. Neither a merge nor a split, a match with the ends swapped, and the third outcome this corpus exists to be able to express"
		},
		{
			id: 'rung1-si-trova-in',
			proposedLabel: 'si trova in',
			catalogueKey: 'located_in',
			verdict: 'same',
			rungOne: true,
			note: "the catalogue's Italian label for `located in`, and the notebook's single most common relation phrasing"
		},
		{
			id: 'rung1-contiene',
			proposedLabel: 'contiene',
			catalogueKey: 'located_in',
			verdict: 'inverse',
			rungOne: true,
			note: "`located in`'s Italian inverse label - the rung-1 inverse case in the direction the notebook actually writes about regions"
		},
		{
			id: 'rung1-protegge',
			proposedLabel: 'protegge',
			catalogueKey: 'protects',
			verdict: 'same',
			rungOne: true,
			note: 'exact Italian forward label, one word, so nothing about the match depends on tokenisation'
		},
		{
			id: 'rung1-figlio-di',
			proposedLabel: 'figlio di',
			catalogueKey: 'parent_of',
			verdict: 'inverse',
			rungOne: true,
			note: "`parent of`'s Italian inverse label; its feminine form one pair below is the same relation past rung 1's reach, which is the whole shape of this rung's problem in Italian"
		},
		{
			id: 'rung1-comandato-da',
			proposedLabel: 'comandato da',
			catalogueKey: 'commands',
			verdict: 'inverse',
			rungOne: true,
			note: "`commands`'s Italian inverse label, and the pair the control `comandato dal` against `appointed` is measured against"
		},
		{
			id: 'rung1-alleato-di',
			proposedLabel: 'alleato di',
			catalogueKey: 'ally_of',
			verdict: 'same',
			rungOne: true,
			note: '`ally of` is symmetric: its inverse label is itself, so this is `same` and could not be `inverse`, and rung 1a resolves it forward because it runs its whole loop before 1b'
		},
		{
			id: 'rung1-inflected-english',
			proposedLabel: 'Commanded By',
			catalogueKey: 'commands',
			verdict: 'inverse',
			rungOne: true,
			note: 'casing and the `-ed` stripper, not meaning: `normalizeRelationLabel` collapses this onto `commanded by`. Here so the rung-1 subset is not entirely Italian, and so a change to that stemmer shows up as a corpus failure rather than as a threshold argument'
		},

		// -------------------------------------------------------------------------------
		// #629's own hand judgements, so they become checkable rather than asserted.
		// -------------------------------------------------------------------------------
		{
			id: 'n629-fondata-da-vs-appointed',
			proposedLabel: 'fondata da',
			catalogueKey: 'appointed',
			verdict: 'distinct',
			rungOne: false,
			note: "#629's central finding: `hashingEmbedder` scores this against `appointed`'s Italian inverse label at a perfect 1.0, a 256-bucket collision, and a GM was shown guardrail 3's prose over it. Founding a settlement is not being appointed to an office - there is no appointer and no office - so merging them gives one `key` two relations, permanently, under L1"
		},
		{
			id: 'n629-combatte-contro-vs-ally-of',
			proposedLabel: 'combatte contro',
			catalogueKey: 'ally_of',
			verdict: 'distinct',
			rungOne: false,
			note: '#629 measured the real gateway model merging this at 0.70: the opposite relation. `ally of` being symmetric means no direction can rescue it, which is what makes it the most expensive single pair in the corpus'
		},
		{
			id: 'n629-situata-in-vs-located-in',
			proposedLabel: 'situata in',
			catalogueKey: 'located_in',
			verdict: 'same',
			rungOne: false,
			note: "the ceiling #629 found: 0.8414 on `alibaba/qwen3-embedding-4b`, the highest score any genuine rung-2 candidate reached, and below the shipped 0.86. If this corpus's suggested threshold sits above 0.8414 the rung is mathematically dead on real data, which is the finding rather than a fault in the pair"
		},
		{
			id: 'n629-situato-in-vs-located-in',
			proposedLabel: 'situato in',
			catalogueKey: 'located_in',
			verdict: 'same',
			rungOne: false,
			note: 'the masculine agreement of the pair above, so the ceiling is two readings rather than one data point'
		},
		{
			id: 'n629-lavora-per-vs-employs',
			proposedLabel: 'lavora per',
			catalogueKey: 'employs',
			verdict: 'inverse',
			rungOne: false,
			note: '#629 read this as a correct merge onto `employs` at 0.80. It is correct only with the ends swapped: works-for is `employed by`, so merging it forward writes every one of those relations backwards. This is the pair where a two-outcome benchmark would have scored a direction error as a success'
		},
		{
			id: 'n629-occupato-da-vs-owns',
			proposedLabel: 'occupato da',
			catalogueKey: 'owns',
			verdict: 'distinct',
			rungOne: false,
			note: '#629 judged this wrong at 0.80 and the notebook is why: half the places in it are held by whoever took them. An occupier is not an owner, and `owned by` is the claim the merged label would make about all of them'
		},
		{
			id: 'n629-contiene-parti-di-vs-part-of',
			proposedLabel: 'contiene parti di',
			catalogueKey: 'part_of',
			verdict: 'inverse',
			rungOne: false,
			note: "#629 called this 'inverted rather than merely loose' and left it as a note. It is the right type in the wrong direction, so under this benchmark it is a direction error rather than a false merge, which is the distinction the note could not make"
		},
		{
			id: 'n629-risiede-nel-vs-located-in',
			proposedLabel: 'risiede nel',
			catalogueKey: 'located_in',
			verdict: 'same',
			rungOne: false,
			note: "one of the four labels #629's issue body quotes as the shape of the problem. A character residing in a place is `located in`; the verb is different enough from `si trova in` that rung 1 cannot see it"
		},

		// -------------------------------------------------------------------------------
		// Genuine rung-2 merges, drawn from the notebook's own vocabulary.
		// -------------------------------------------------------------------------------
		{
			id: 'guidato-da-vs-commands',
			proposedLabel: 'guidato da',
			catalogueKey: 'commands',
			verdict: 'inverse',
			rungOne: false,
			note: "led-by against commanded-by: the notebook writes this fourteen times about warbands and councils alike, and it is the same relation as the catalogue's inverse"
		},
		{
			id: 'protetta-da-vs-protects',
			proposedLabel: 'protetta da',
			catalogueKey: 'protects',
			verdict: 'inverse',
			rungOne: true,
			note: 'one letter of Italian gender agreement was the whole distance from rung 1: the catalogue ships `protetto da` and the notebook writes `protetta da` about its cities. #637 measured the semantic rung buying it at 0.9857, the highest true score in the corpus, and #669 then made rung 1 collapse the agreement so it is resolved for free and never reaches an embedding call. Kept here rather than deleted because it is the cheapest true pair in the language and therefore the one that says most if rung 1 ever stops seeing it'
		},
		{
			id: 'di-proprieta-di-vs-owns',
			proposedLabel: 'di proprietà di',
			catalogueKey: 'owns',
			verdict: 'inverse',
			rungOne: false,
			note: '`owned by` paraphrased with a noun rather than a participle, sharing no token with `posseduto da`. The counterpart of `occupato da` above: same grammatical shape, opposite verdict, so the corpus cannot be passed by pattern'
		},
		{
			id: 'e-proprietario-di-vs-owns',
			proposedLabel: 'è proprietario di',
			catalogueKey: 'owns',
			verdict: 'same',
			rungOne: false,
			note: 'the forward reading of the pair above, so `owns` is exercised in both directions and a scorer cannot earn credit by always answering `inverse` for a three-token Italian phrase'
		},
		{
			id: 'sede-di-vs-located-in',
			proposedLabel: 'sede di',
			catalogueKey: 'located_in',
			verdict: 'inverse',
			rungOne: false,
			note: 'is-the-seat-of, which is `contains` said the way a gazetteer says it. Thirty-seven occurrences in the notebook, and no lexical overlap with either catalogue label'
		},
		{
			id: 'figlia-di-vs-parent-of',
			proposedLabel: 'figlia di',
			catalogueKey: 'parent_of',
			verdict: 'inverse',
			rungOne: false,
			note: "the feminine form of `rung1-figlio-di`, one letter past rung 1's exact match. The pair that says most plainly what this rung is for in a gendered language"
		},
		{
			id: 'nominato-dal-vs-appointed',
			proposedLabel: 'nominato dal',
			catalogueKey: 'appointed',
			verdict: 'inverse',
			rungOne: true,
			note: "the catalogue's `nominato da` with the article contracted onto the preposition, which is how the notebook actually writes it. One enclitic `l` was the difference between rung 1 and rung 2 (#637 measured 0.9585 through the rung); #669 folded the articled prepositions in the normaliser, so rung 1 resolves it now. `control-comandato-dal-vs-appointed` is the same edit against the wrong type and is still `distinct` at rung 1, which is what makes this collapse safe rather than merely cheap"
		},
		{
			id: 'hires-vs-employs',
			proposedLabel: 'hires',
			catalogueKey: 'employs',
			verdict: 'same',
			rungOne: false,
			note: "one of #188's four `employs` synonyms, which the epic named as a start and this corpus keeps as the plainest possible true pair: same language, same direction, different word"
		},
		{
			id: 'works-for-vs-employs',
			proposedLabel: 'works for',
			catalogueKey: 'employs',
			verdict: 'inverse',
			rungOne: false,
			note: 'the English reading of `n629-lavora-per-vs-employs`, so the direction outcome is not a single Italian data point and a direction error cannot be blamed on the language'
		},
		{
			id: 'guards-vs-protects',
			proposedLabel: 'guards',
			catalogueKey: 'protects',
			verdict: 'same',
			rungOne: false,
			note: "a near-synonym in the catalogue's own language, which `relation-types.test.ts` already asserts a real model should reuse; here it is measured rather than stubbed"
		},
		{
			id: 'is-part-of-vs-part-of',
			proposedLabel: 'is part of',
			catalogueKey: 'part_of',
			verdict: 'same',
			rungOne: true,
			note: "the catalogue's own label with a copula in front, and the pair #689 was filed off: it was the easiest true pair in the set at 0.8816, the one that anchored the top of the range, and it is now a rung-1 exact match costing no embedding call, because `normalizeRelationLabel` strips a leading copula when a preposition survives it. Kept here rather than deleted for the same reason `protetta da` was: it is the cheapest true pair in English, so it is the one that says most if rung 1 ever stops seeing it"
		},

		// -------------------------------------------------------------------------------
		// The expensive error: pairs that must not merge.
		// -------------------------------------------------------------------------------
		{
			id: 'trap-nemico-di-vs-ally-of',
			proposedLabel: 'nemico di',
			catalogueKey: 'ally_of',
			verdict: 'distinct',
			rungOne: false,
			note: "the sharpest merge trap here: one word from the catalogue's Italian label, the same length, the same shape, the same symmetric arity, and the exact opposite relation. Forty-five occurrences in the notebook, so this is not a hypothetical edge"
		},
		{
			id: 'trap-rivale-di-vs-ally-of',
			proposedLabel: 'rivale di',
			catalogueKey: 'ally_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the second reading of the antonym rule, weaker than enmity and still not alliance'
		},
		{
			id: 'trap-enemy-of-vs-ally-of',
			proposedLabel: 'enemy of',
			catalogueKey: 'ally_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the antonym control in the catalogue\'s own language, so "antonyms merge" cannot be explained away as a translation artefact'
		},
		{
			id: 'trap-minaccia-vs-protects',
			proposedLabel: 'minaccia',
			catalogueKey: 'protects',
			verdict: 'distinct',
			rungOne: false,
			note: "threatens against protects: two one-word transitive verbs about the same thing, a place's safety, pointing opposite ways. One of the four labels #629's issue body quotes"
		},
		{
			id: 'trap-venera-vs-protects',
			proposedLabel: 'venera',
			catalogueKey: 'protects',
			verdict: 'distinct',
			rungOne: false,
			note: 'the notebook uses worship and protection about the same temples and the same gods, which is exactly why a scorer reading topic rather than relation merges them'
		},
		{
			id: 'trap-venera-vs-member-of',
			proposedLabel: 'venera',
			catalogueKey: 'member_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the merge a "religion" reading would make: worshipping a god is not membership of it, and a cult that ships as `member of` loses the distinction between a believer and an initiate'
		},
		{
			id: 'trap-sorella-di-vs-parent-of',
			proposedLabel: 'sorella di',
			catalogueKey: 'parent_of',
			verdict: 'distinct',
			rungOne: false,
			note: "the relation-label analogue of the entity corpus's shared-surname siblings: inside the same family cluster, high semantic proximity, and a different relation. `parent of` has a direction and siblinghood does not, so no swap saves this either"
		},
		{
			id: 'trap-fratello-di-vs-parent-of',
			proposedLabel: 'fratello di',
			catalogueKey: 'parent_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the masculine second reading, so the sibling result is not one sample'
		},
		{
			id: 'trap-erede-di-vs-parent-of',
			proposedLabel: 'erede di',
			catalogueKey: 'parent_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'heir-of reads like child-of and is not: an heir may be no blood relation at all, which is the plot of several pages of this notebook and the reason the two cannot share a key'
		},
		{
			id: 'trap-maestro-di-vs-parent-of',
			proposedLabel: 'maestro di',
			catalogueKey: 'parent_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the other formative-authority near-miss, twenty-one occurrences: a teacher stands to a student roughly where a parent stands to a child and it is a different relation with a different cardinality'
		},
		{
			id: 'trap-governata-da-vs-owns',
			proposedLabel: 'governata da',
			catalogueKey: 'owns',
			verdict: 'distinct',
			rungOne: false,
			note: 'governed-by against owned-by: a city governed by a house is not property of it, and the notebook has several where the distinction is the conflict'
		},
		{
			id: 'trap-abitata-da-vs-owns',
			proposedLabel: 'abitata da',
			catalogueKey: 'owns',
			verdict: 'distinct',
			rungOne: false,
			note: 'inhabited-by against owned-by, the same passive-agent shape as `di proprietà di` and the opposite verdict'
		},
		{
			id: 'trap-enslaves-vs-employs',
			proposedLabel: 'enslaves',
			catalogueKey: 'employs',
			verdict: 'distinct',
			rungOne: false,
			note: "adjacent enough to `employs` that a model rates it high, and if it merges then every enslaved-by edge in the world renders as 'employed by'. The clearest case in the corpus of why a false merge is not a rounding error"
		},
		{
			id: 'trap-distrutta-da-vs-protects',
			proposedLabel: 'distrutta da',
			catalogueKey: 'protects',
			verdict: 'distinct',
			rungOne: false,
			note: 'destroyed-by against protected-by: identical grammar, identical subject matter, opposite relation, and nineteen occurrences between the two genders'
		},

		// -------------------------------------------------------------------------------
		// The controls. Without these the true pairs above are unfalsifiable.
		// -------------------------------------------------------------------------------
		{
			id: 'control-comandato-dal-vs-appointed',
			proposedLabel: 'comandato dal',
			catalogueKey: 'appointed',
			verdict: 'distinct',
			rungOne: false,
			note: "the control for `nominato-dal-vs-appointed`: the identical edit (an enclitic article) applied to `commands`'s own Italian inverse label and scored against the wrong type. A scorer that has learned 'Italian passive-agent phrase' rather than the relation merges this, which is what stops a high score on the other one from being credited as understanding"
		},
		{
			id: 'control-membro-di-vs-part-of',
			proposedLabel: 'membro di',
			catalogueKey: 'part_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the same-language control, and the sharpest one: the catalogue ships `member of` and `part of` as two keys on purpose, with different allowed types at each end. A person is a member of a guild and a wing is part of a castle, and collapsing them gives one identity both. `rung1-membro-di` is the same string against its own type, so the difference between the two rows is entirely the type'
		},
		{
			id: 'control-parte-di-vs-member-of',
			proposedLabel: 'parte di',
			catalogueKey: 'member_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the reverse reading of the control above, so the claim is not one-directional'
		},
		{
			id: 'control-sindaco-di-vs-commands',
			proposedLabel: 'sindaco di',
			catalogueKey: 'commands',
			verdict: 'distinct',
			rungOne: false,
			note: "#639's shape as a pair: a real notebook label with no home in the catalogue at all. Holding an office in a town is not command over it, and no threshold closes this gap because a label can only merge onto a type that exists"
		},
		{
			id: 'control-sindaco-di-vs-member-of',
			proposedLabel: 'sindaco di',
			catalogueKey: 'member_of',
			verdict: 'distinct',
			rungOne: false,
			note: 'the same label against a second type, because "no catalogue home" is a claim about the whole catalogue and one pair cannot make it'
		},

		// -------------------------------------------------------------------------------
		// Anchors: the easy negatives that fix the low end of the range.
		// -------------------------------------------------------------------------------
		{
			id: 'anchor-figlia-di-vs-owns',
			proposedLabel: 'figlia di',
			catalogueKey: 'owns',
			verdict: 'distinct',
			rungOne: false,
			note: 'a family relation against ownership, no relation at all. The same label is a true `inverse` against `parent_of`, so this pair also proves the corpus is keyed on the pair and not on the label'
		},
		{
			id: 'anchor-hires-vs-located-in',
			proposedLabel: 'hires',
			catalogueKey: 'located_in',
			verdict: 'distinct',
			rungOne: false,
			note: 'employment against location, in one language, with nothing shared. Anchors the low end'
		},
		{
			id: 'anchor-si-trova-in-vs-employs',
			proposedLabel: 'si trova in',
			catalogueKey: 'employs',
			verdict: 'distinct',
			rungOne: false,
			note: "the catalogue's own label for one type scored against another: whatever else the rung does, a shipped label must not merge onto a type that is not its own"
		}
	]
};
