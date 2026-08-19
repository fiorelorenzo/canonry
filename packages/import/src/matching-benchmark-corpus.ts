/**
 * The labelled corpus for the matching benchmark (issue #37, SPEC.md §6.4). Pairs drawn
 * from the naming-variance patterns SPEC.md §6.4 names by example ("the Gilded Rat",
 * "Gilded Rat Tavern" and "Il Ratto Dorato" are the same inn and no regex will say so")
 * plus deliberate false-merge traps: two distinct entities that happen to share a name,
 * which is the expensive error the corpus exists to catch (§6.4: "false merges are
 * weighted far heavier"). Every pair states which case it exercises in `note`, so this
 * reads as a labelled set of real judgment calls rather than an opaque table.
 *
 * Modelled on the small worlds already seeded for entity/relation fixtures elsewhere in
 * this repo (Valdoria Reach and the Gilded Rat from `docs/ux/SAMPLE-WORLD.md`, Thornwick
 * College and Brackwater Mire from packages/eval's propagation corpus), so the names and
 * the world facts are consistent with data already used across the project rather than
 * invented in isolation.
 *
 * Issue #279 added four bilingual pairs, because one translated pair (`translation`) is not
 * enough to measure the thing SPEC.md §6.4 uses as its example. Two are true matches across
 * English and Italian; two are the control that keeps the first two from being unfalsifiable
 * - a scorer that simply rates every cross-language pair highly has to be caught losing on
 * a translated name belonging to a *different* entity, or "embeddings fix translation" is a
 * claim about nothing. SPEC.md §17 is why the second language is Italian.
 *
 * ## Issue #310: every pair now carries the context the seam used to throw away
 *
 * #279's measurement found the ceiling, and it was not the threshold: with a bare name to
 * embed, mean cosine was 0.912 over the true pairs and 0.853 over the false ones. Five
 * negatives here are not separable from a name at all, and two of them are byte-identical as
 * text. So each side gained a `MatchContext` (matching.ts): the type, one line of summary,
 * and on the subject side the sentence of the source document it was extracted from.
 *
 * **The rules this data was written to, because a corpus that assumes its own answer measures
 * nothing.** Each side is written as its own export would describe it, independently, with no
 * field asserting whether the two are the same entity. The true pairs deliberately do *not*
 * share wording: the two sides emphasise different facts, in different sentence shapes, and
 * where the world's entry is Italian its summary is Italian, so a high score has to come from
 * meaning rather than from string reuse. The subject side carries all three fields and the
 * candidate side carries two, because that is the real asymmetry at the seam: a document
 * proposal has a sentence to quote and an already-imported entity does not (`entity_source_ref`
 * keeps which document and its hash, never the text).
 *
 * **One pair is cross-type, and its type line is a free win that production never gets.**
 * `trivial-negative-factions` compares an inn against a faction, which it did before this
 * change too, and `candidateEntitiesForMatching` filters the real candidate pool to one type
 * before a single similarity call, so no real import ever scores such a pair. Every other
 * pair here is same-type on both sides, deliberately: a corpus that separated its negatives
 * by handing them different types would report a number the product cannot reproduce.
 * `matching-sweep` reports the same-type subset next to the whole corpus on every run, so the
 * size of that one free win is visible rather than argued about.
 */
import type { MatchingCorpus } from './matching-benchmark.js';

export const SAMPLE_WORLD_MATCHING_CORPUS: MatchingCorpus = {
	id: 'sample-world-export-pairs',
	name: 'Sample-world re-export pairs (issues #37, #279, #310)',
	pairs: [
		{
			id: 'retitle-descriptor',
			subject: {
				name: 'the Gilded Rat',
				aliases: [],
				context: {
					type: 'place',
					summary: 'An inn off the Lantern Quarter, kept by Mother Sennah.',
					sourceSentence:
						'The Gilded Rat stands three doors down the only lit street in the Lantern Quarter, and Mother Sennah has kept it since the Sable Winter.'
				}
			},
			candidate: {
				id: 'inn-gilded-rat',
				name: 'Gilded Rat Tavern',
				aliases: [],
				context: {
					type: 'place',
					summary:
						"A drinking house in the poorest of Valdoria's six quarters. Its keeper was a field surgeon once.",
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'retitled with a descriptor added - shares tokens, a lexical match should catch this'
		},
		{
			id: 'translation',
			subject: {
				name: 'the Gilded Rat',
				aliases: [],
				context: {
					type: 'place',
					summary: 'An inn off the Lantern Quarter, kept by Mother Sennah.',
					sourceSentence:
						'The Gilded Rat stands three doors down the only lit street in the Lantern Quarter, and Mother Sennah has kept it since the Sable Winter.'
				}
			},
			candidate: {
				id: 'inn-gilded-rat',
				name: 'Il Ratto Dorato',
				aliases: [],
				context: {
					type: 'place',
					summary:
						'Una locanda del Quartiere della Lanterna, tenuta da Mother Sennah dal Sable Winter.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: "SPEC.md §6.4's own example: a translated name, zero shared tokens - only real semantic similarity catches this, a lexical stand-in cannot. Its context is Italian too (SPEC.md §17: canon keeps its own language per entry), so the cross-language claim is made about the prose as well as the name"
		},
		{
			id: 'epithet-replaces-surname',
			subject: {
				name: 'Aldric Voss',
				aliases: ['the Ironhand'],
				context: {
					type: 'character',
					summary: 'Dismissed captain of the Valdoria Watch, now paid by the Ashen Ledger.',
					sourceSentence:
						'Aldric Voss held forty sworn under him in the Lantern Quarter until the magistrate broke him in the thaw after the Sable Winter.'
				}
			},
			candidate: {
				id: 'char-aldric',
				name: 'Aldric the Ironhand',
				aliases: ['Aldric Voss'],
				context: {
					type: 'character',
					summary:
						'Once captain of the watch in the Lantern Quarter, dismissed after the Sable Winter and drawing coin from the Ashen Ledger since.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'epithet used in place of the surname, recovered through the alias field'
		},
		{
			id: 'rank-prefix',
			subject: {
				name: 'Mira Sable',
				aliases: [],
				context: {
					type: 'character',
					summary: 'Runs the harbour watch out of Saint Merrow\u2019s Docks.',
					sourceSentence:
						'Mira Sable took the harbour watch the season Voss lost the Lantern Quarter, and she has not lost a manifest since.'
				}
			},
			candidate: {
				id: 'char-mira',
				name: 'Captain Mira Sable',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'The harbour watch is hers, and the dock ledgers with it. She came up through the manifests rather than the sword.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'a rank/honorific prefix added at re-export'
		},
		{
			id: 'typo',
			subject: {
				name: 'Thornwick College',
				aliases: [],
				context: {
					type: 'place',
					summary: 'A college of seven towers built into a cliff.',
					sourceSentence:
						'Half the library at Thornwick College is older than the kingdom that funds it, and the provost still opens the gate herself on exam mornings.'
				}
			},
			candidate: {
				id: 'place-thornwick',
				name: 'Thornwyck College',
				aliases: [],
				context: {
					type: 'place',
					summary:
						'Seven towers cut into the cliff face, funded by a kingdom younger than its own library.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'a single-letter misspelling between exports'
		},
		{
			id: 'shortened',
			subject: {
				name: 'Brackwater Mire',
				aliases: [],
				context: {
					type: 'place',
					summary: 'The drowned country the coast road crosses on stilts.',
					sourceSentence:
						'Every cart bound for the coast road crosses the Sunken Road through Brackwater Mire, and the Toll Wardens mark the safe stones.'
				}
			},
			candidate: {
				id: 'place-brackwater',
				name: 'Brackwater',
				aliases: [],
				context: {
					type: 'place',
					summary:
						'A half-flooded stretch of reed and causeway. Nothing reaches the coast without paying the Wardens to cross it.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'shortened on re-export, dropping the descriptor word'
		},
		{
			id: 'alias-field-carries-the-match',
			subject: {
				name: 'Old Toby',
				aliases: ['Tobias Reed'],
				context: {
					type: 'character',
					summary: 'Keeps a hut at the edge of Brackwater Landing and trades cures for no coin.',
					sourceSentence:
						'Old Toby was at the Landing before the Flood of Reeds and intends to outlast whatever comes next.'
				}
			},
			candidate: {
				id: 'char-toby',
				name: 'Tobias Reed',
				aliases: ['Old Toby'],
				context: {
					type: 'character',
					summary:
						'An alchemist on the edge of the Landing. He has never charged for a cure and never explained why.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'the nickname and the legal name are swapped between name and aliases'
		},
		{
			id: 'case-only',
			subject: {
				name: "SAINT MERROW'S DOCKS",
				aliases: [],
				context: {
					type: 'place',
					summary: 'The working wharf of Valdoria, and where the harbour watch keeps its office.',
					sourceSentence:
						"Every manifest in Valdoria passes through Saint Merrow's Docks, which is why the harbour watch sits there and not at the citadel."
				}
			},
			candidate: {
				id: 'place-docks',
				name: "Saint Merrow's Docks",
				aliases: [],
				context: {
					type: 'place',
					summary:
						'The wharf the city actually lives off. The harbour watch keeps its ledgers above the third berth.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'case difference only, trivial for either a lexical or semantic scorer'
		},
		{
			id: 'reordered-name',
			subject: {
				name: 'Voss, Aldric',
				aliases: [],
				context: {
					type: 'character',
					summary: 'Dismissed captain of the Valdoria Watch.',
					sourceSentence:
						'Voss, Aldric - struck from the roll of the Valdoria Watch in the thaw, forty sworn reassigned.'
				}
			},
			candidate: {
				id: 'char-aldric',
				name: 'Aldric Voss',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'Once captain of the watch in the Lantern Quarter, dismissed after the Sable Winter and drawing coin from the Ashen Ledger since.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'family-name-first export order versus given-name-first'
		},
		{
			id: 'false-merge-parent-child',
			subject: {
				name: 'Aldric Voss',
				aliases: [],
				context: {
					type: 'character',
					summary: 'Dismissed captain of the Valdoria Watch, now paid by the Ashen Ledger.',
					sourceSentence:
						'Aldric Voss held forty sworn under him in the Lantern Quarter until the magistrate broke him in the thaw after the Sable Winter.'
				}
			},
			candidate: {
				id: 'char-aldric-junior',
				name: 'Aldric Voss the Younger',
				aliases: [],
				context: {
					type: 'character',
					summary:
						"A harbour clerk of nineteen who has never held a commission and resents being asked about his father's.",
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'the expensive trap: a father and son sharing a name, high lexical overlap, genuinely different entities. Undecidable from the name alone (#279) and separable from either summary, which is the case issue #310 exists for'
		},
		{
			id: 'false-merge-same-tavern-name-different-city',
			subject: {
				name: 'the Rusty Anchor, Port Kessin',
				aliases: [],
				context: {
					type: 'place',
					summary: 'A dockside tavern in Port Kessin, two streets from the fish market.',
					sourceSentence:
						'The Rusty Anchor in Port Kessin takes its custom off the herring boats and closes when they sail.'
				}
			},
			candidate: {
				id: 'inn-rusty-anchor-harrowgate',
				name: 'the Rusty Anchor, Harrowgate',
				aliases: [],
				context: {
					type: 'place',
					summary:
						'A tavern on the Harrowgate road, inland and forty miles from open water, named after a ship nobody there has seen.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'a common tavern name reused in two different settlements - only the location distinguishes them'
		},
		{
			id: 'false-merge-shared-surname-siblings',
			subject: {
				name: 'Mira Sable',
				aliases: [],
				context: {
					type: 'character',
					summary: 'Runs the harbour watch out of Saint Merrow\u2019s Docks.',
					sourceSentence:
						'Mira Sable took the harbour watch the season Voss lost the Lantern Quarter, and she has not lost a manifest since.'
				}
			},
			candidate: {
				id: 'char-elena-sable',
				name: 'Elena Sable',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'A cartographer under contract to the Ashen Ledger, and the only Sable who left the city willingly.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'siblings sharing a surname - high token overlap on the family name alone'
		},
		{
			id: 'false-merge-near-orthographic-different-place',
			subject: {
				name: 'Brackwater Mire',
				aliases: [],
				context: {
					type: 'place',
					summary: 'The drowned country the coast road crosses on stilts.',
					sourceSentence:
						'Every cart bound for the coast road crosses the Sunken Road through Brackwater Mire, and the Toll Wardens mark the safe stones.'
				}
			},
			candidate: {
				id: 'place-blackwater-mire',
				name: 'Blackwater Mire',
				aliases: [],
				context: {
					type: 'place',
					summary:
						'A peat bog in the northern reach, three weeks from the coast, with no crossing worth tolling.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'a one-letter orthographic near-miss between two genuinely different swamps in different regions'
		},
		{
			id: 'false-merge-title-holder-changed',
			subject: {
				name: 'the Warden of Thornwick',
				aliases: [],
				context: {
					type: 'character',
					summary: 'Wenna Dael, provost, who took the wardenship in the flood year.',
					sourceSentence:
						'Provost Wenna Dael has been Warden of Thornwick since the flood year, and she keeps the vault keys on her own belt.'
				}
			},
			candidate: {
				id: 'char-new-warden',
				name: 'the Warden of Thornwick',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'Magister Corin Fell held the wardenship for nine years and was broken over what got out of the Sunken Vault.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'an office/title reused after the previous holder was replaced - identical name, so byte-identical text before issue #310 and a false merge at every threshold below 1.0. Separable only because each side names its own holder, which is what the source document actually says'
		},
		{
			id: 'trivial-negative-people',
			subject: {
				name: 'Aldric Voss',
				aliases: [],
				context: {
					type: 'character',
					summary: 'Dismissed captain of the Valdoria Watch, now paid by the Ashen Ledger.',
					sourceSentence:
						'Aldric Voss held forty sworn under him in the Lantern Quarter until the magistrate broke him in the thaw after the Sable Winter.'
				}
			},
			candidate: {
				id: 'char-seraphine',
				name: 'Seraphine Duval',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'A glassmaker in the Candle Row who has never spoken to the watch about anything.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'no relation at all - the easy negative that anchors the low end of the range'
		},
		{
			id: 'trivial-negative-places',
			subject: {
				name: 'Thornwick College',
				aliases: [],
				context: {
					type: 'place',
					summary: 'A college of seven towers built into a cliff.',
					sourceSentence:
						'Half the library at Thornwick College is older than the kingdom that funds it, and the provost still opens the gate herself on exam mornings.'
				}
			},
			candidate: {
				id: 'place-valdoria',
				name: 'Valdoria Reach',
				aliases: [],
				context: {
					type: 'place',
					summary:
						'The stretch of coast the free port holds, six quarters and the water between them.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'no relation at all - the easy negative that anchors the low end of the range'
		},
		{
			id: 'trivial-negative-factions',
			subject: {
				name: 'the Gilded Rat',
				aliases: [],
				context: {
					type: 'place',
					summary: 'An inn off the Lantern Quarter, kept by Mother Sennah.',
					sourceSentence:
						'The Gilded Rat stands three doors down the only lit street in the Lantern Quarter, and Mother Sennah has kept it since the Sable Winter.'
				}
			},
			candidate: {
				id: 'faction-ashen-covenant',
				name: 'the Ashen Covenant',
				aliases: [],
				context: {
					type: 'faction',
					summary:
						'Six houses sworn to each other after the Sable Winter, and to nobody who can be named in writing.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'an inn and an unrelated faction, sharing no real similarity. Cross-type, so the same caveat applies as to `trivial-negative-places`'
		},
		{
			id: 'abbreviated-faction',
			subject: {
				name: 'the Ashen Covenant',
				aliases: ['the Covenant'],
				context: {
					type: 'faction',
					summary: 'Six houses sworn together after the Sable Winter.',
					sourceSentence:
						'What the Lantern Quarter calls the Covenant is six houses that swore to each other in the Sable Winter and to nothing on paper.'
				}
			},
			candidate: {
				id: 'faction-ashen-covenant',
				name: 'the Covenant',
				aliases: ['the Ashen Covenant'],
				context: {
					type: 'faction',
					summary:
						'Six houses sworn to each other after the Sable Winter, and to nobody who can be named in writing.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'a faction referred to by its short form in the second export'
		},
		{
			id: 'false-merge-generic-guard-title',
			subject: {
				name: 'Captain of the Watch',
				aliases: [],
				context: {
					type: 'character',
					summary: 'The commission over the forty sworn of the Lantern Quarter, in Valdoria.',
					sourceSentence:
						'The Captain of the Watch answers to the harbour magistrate, and in the Lantern Quarter that has meant four different men in six years.'
				}
			},
			candidate: {
				id: 'char-different-captain',
				name: 'Captain of the Watch',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'Harrowgate keeps one watch captain and twelve sworn, appointed by the wool guild that pays them.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'a generic title reused across two different settlements, no location to disambiguate in the name alone. The second byte-identical pair of #279, separable now only through the settlement each side names'
		},
		{
			id: 'diacritics-only',
			subject: {
				name: 'Seraphine Duval',
				aliases: [],
				context: {
					type: 'character',
					summary: 'A glassmaker in the Candle Row.',
					sourceSentence:
						'Seraphine Duval blows glass in the Candle Row and has never spoken to the watch about anything.'
				}
			},
			candidate: {
				id: 'char-seraphine-accented',
				name: 'S\u00e9raphine Duval',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'Candle Row glassmaker, third generation at the same furnace, no dealings with the watch.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'a diacritic added or dropped between exports, common for names transliterated differently'
		},
		{
			id: 'translation-faction',
			subject: {
				name: 'the Ashen Covenant',
				aliases: [],
				context: {
					type: 'faction',
					summary: 'Six houses sworn together after the Sable Winter.',
					sourceSentence:
						'What the Lantern Quarter calls the Covenant is six houses that swore to each other in the Sable Winter and to nothing on paper.'
				}
			},
			candidate: {
				id: 'faction-ashen-covenant',
				name: 'il Patto di Cenere',
				aliases: [],
				context: {
					type: 'faction',
					summary:
						'Sei casate legate fra loro dopo il Sable Winter, e a nessuno che si possa nominare per iscritto.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'a fully translated faction name, zero shared tokens and zero shared trigrams of any length - the second reading of the case §6.4 names, so the bilingual result is not a single data point'
		},
		{
			id: 'translation-epithet',
			subject: {
				name: 'Aldric the Ironhand',
				aliases: [],
				context: {
					type: 'character',
					summary: 'Dismissed captain of the Valdoria Watch.',
					sourceSentence:
						'They called him the Ironhand while he held the Lantern Quarter, and nothing at all after the magistrate broke him.'
				}
			},
			candidate: {
				id: 'char-aldric',
				name: 'Aldric Mano di Ferro',
				aliases: [],
				context: {
					type: 'character',
					summary:
						'Ex capitano della Guardia di Valdoria, congedato dopo il Sable Winter, ora al soldo del Registro di Cenere.',
					sourceSentence: null
				}
			},
			sameEntity: true,
			note: 'the given name survives translation and the epithet does not - the mixed case a GM actually produces, half recoverable lexically'
		},
		{
			id: 'false-merge-cross-language-sibling-inn',
			subject: {
				name: 'Il Ratto Dorato',
				aliases: [],
				context: {
					type: 'place',
					summary: 'Una locanda del Quartiere della Lanterna, tenuta da Mother Sennah.',
					sourceSentence:
						'Il Ratto Dorato sta a tre porte dall\u2019unica strada illuminata del Quartiere della Lanterna.'
				}
			},
			candidate: {
				id: 'inn-topo-argento',
				name: "il Topo d'Argento",
				aliases: [],
				context: {
					type: 'place',
					summary:
						'Una bettola del molo di Port Kessin, aperta soltanto quando le barche da aringhe sono in porto.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: 'the control for the two above: two different inns whose Italian names are semantically adjacent (a gilded rat and a silver mouse). A scorer that rates any two same-language animal-and-metal tavern names as one entity fails here, which is what stops a high score on a translation from being credited as understanding'
		},
		{
			id: 'false-merge-translation-of-a-different-entity',
			subject: {
				name: 'the Gilded Rat',
				aliases: [],
				context: {
					type: 'place',
					summary: 'An inn off the Lantern Quarter, kept by Mother Sennah.',
					sourceSentence:
						'The Gilded Rat stands three doors down the only lit street in the Lantern Quarter, and Mother Sennah has kept it since the Sable Winter.'
				}
			},
			candidate: {
				id: 'inn-gatto-dorato',
				name: 'il Gatto Dorato',
				aliases: [],
				context: {
					type: 'place',
					summary:
						'Una sala da t\u00e8 sulla Candle Row, frequentata dalle case che non bevono nel Quartiere della Lanterna.',
					sourceSentence: null
				}
			},
			sameEntity: false,
			note: "the second control: a cross-language near-translation of a different tavern (the Gilded Cat), one word away from this corpus's true bilingual match. Distinguishing it from `translation` is the whole difference between semantic matching and rewarding cross-language proximity"
		}
	]
};
