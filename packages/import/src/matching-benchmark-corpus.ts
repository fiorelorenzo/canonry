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
 * this repo (Brackwater Mire, Thornwick College, Valdoria Reach - packages/eval's
 * propagation corpus), so the names are consistent with data already used across the
 * project rather than invented in isolation.
 */
import type { MatchingCorpus } from './matching-benchmark.js';

export const SAMPLE_WORLD_MATCHING_CORPUS: MatchingCorpus = {
	id: 'sample-world-export-pairs',
	name: 'Sample-world re-export pairs (issue #37)',
	pairs: [
		{
			id: 'retitle-descriptor',
			subject: { name: 'the Gilded Rat', aliases: [] },
			candidate: { id: 'inn-gilded-rat', name: 'Gilded Rat Tavern', aliases: [] },
			sameEntity: true,
			note: 'retitled with a descriptor added - shares tokens, a lexical match should catch this'
		},
		{
			id: 'translation',
			subject: { name: 'the Gilded Rat', aliases: [] },
			candidate: { id: 'inn-gilded-rat', name: 'Il Ratto Dorato', aliases: [] },
			sameEntity: true,
			note: "SPEC.md §6.4's own example: a translated name, zero shared tokens - only real semantic similarity catches this, a lexical stand-in cannot"
		},
		{
			id: 'epithet-replaces-surname',
			subject: { name: 'Aldric Voss', aliases: ['the Ironhand'] },
			candidate: { id: 'char-aldric', name: 'Aldric the Ironhand', aliases: ['Aldric Voss'] },
			sameEntity: true,
			note: 'epithet used in place of the surname, recovered through the alias field'
		},
		{
			id: 'rank-prefix',
			subject: { name: 'Mira Sable', aliases: [] },
			candidate: { id: 'char-mira', name: 'Captain Mira Sable', aliases: [] },
			sameEntity: true,
			note: 'a rank/honorific prefix added at re-export'
		},
		{
			id: 'typo',
			subject: { name: 'Thornwick College', aliases: [] },
			candidate: { id: 'place-thornwick', name: 'Thornwyck College', aliases: [] },
			sameEntity: true,
			note: 'a single-letter misspelling between exports'
		},
		{
			id: 'shortened',
			subject: { name: 'Brackwater Mire', aliases: [] },
			candidate: { id: 'place-brackwater', name: 'Brackwater', aliases: [] },
			sameEntity: true,
			note: 'shortened on re-export, dropping the descriptor word'
		},
		{
			id: 'alias-field-carries-the-match',
			subject: { name: 'Old Toby', aliases: ['Tobias Reed'] },
			candidate: { id: 'char-toby', name: 'Tobias Reed', aliases: ['Old Toby'] },
			sameEntity: true,
			note: 'the nickname and the legal name are swapped between name and aliases'
		},
		{
			id: 'case-only',
			subject: { name: "SAINT MERROW'S DOCKS", aliases: [] },
			candidate: { id: 'place-docks', name: "Saint Merrow's Docks", aliases: [] },
			sameEntity: true,
			note: 'case difference only, trivial for either a lexical or semantic scorer'
		},
		{
			id: 'reordered-name',
			subject: { name: 'Voss, Aldric', aliases: [] },
			candidate: { id: 'char-aldric', name: 'Aldric Voss', aliases: [] },
			sameEntity: true,
			note: 'family-name-first export order versus given-name-first'
		},
		{
			id: 'false-merge-parent-child',
			subject: { name: 'Aldric Voss', aliases: [] },
			candidate: { id: 'char-aldric-junior', name: 'Aldric Voss the Younger', aliases: [] },
			sameEntity: false,
			note: 'the expensive trap: a father and son sharing a name, high lexical overlap, genuinely different entities'
		},
		{
			id: 'false-merge-same-tavern-name-different-city',
			subject: { name: 'the Rusty Anchor, Port Kessin', aliases: [] },
			candidate: {
				id: 'inn-rusty-anchor-harrowgate',
				name: 'the Rusty Anchor, Harrowgate',
				aliases: []
			},
			sameEntity: false,
			note: 'a common tavern name reused in two different settlements - only the location distinguishes them'
		},
		{
			id: 'false-merge-shared-surname-siblings',
			subject: { name: 'Mira Sable', aliases: [] },
			candidate: { id: 'char-elena-sable', name: 'Elena Sable', aliases: [] },
			sameEntity: false,
			note: 'siblings sharing a surname - high token overlap on the family name alone'
		},
		{
			id: 'false-merge-near-orthographic-different-place',
			subject: { name: 'Brackwater Mire', aliases: [] },
			candidate: { id: 'place-blackwater-mire', name: 'Blackwater Mire', aliases: [] },
			sameEntity: false,
			note: 'a one-letter orthographic near-miss between two genuinely different swamps in different regions'
		},
		{
			id: 'false-merge-title-holder-changed',
			subject: { name: 'the Warden of Thornwick', aliases: [] },
			candidate: { id: 'char-new-warden', name: 'the Warden of Thornwick', aliases: [] },
			sameEntity: false,
			note: 'an office/title reused after the previous holder was replaced - identical name, different person'
		},
		{
			id: 'trivial-negative-people',
			subject: { name: 'Aldric Voss', aliases: [] },
			candidate: { id: 'char-seraphine', name: 'Seraphine Duval', aliases: [] },
			sameEntity: false,
			note: 'no relation at all - the easy negative that anchors the low end of the range'
		},
		{
			id: 'trivial-negative-places',
			subject: { name: 'Thornwick College', aliases: [] },
			candidate: { id: 'place-valdoria', name: 'Valdoria Reach', aliases: [] },
			sameEntity: false,
			note: 'no relation at all - the easy negative that anchors the low end of the range'
		},
		{
			id: 'trivial-negative-factions',
			subject: { name: 'the Gilded Rat', aliases: [] },
			candidate: { id: 'faction-ashen-covenant', name: 'the Ashen Covenant', aliases: [] },
			sameEntity: false,
			note: 'an inn and an unrelated faction, sharing no real similarity'
		},
		{
			id: 'abbreviated-faction',
			subject: { name: 'the Ashen Covenant', aliases: ['the Covenant'] },
			candidate: {
				id: 'faction-ashen-covenant',
				name: 'the Covenant',
				aliases: ['the Ashen Covenant']
			},
			sameEntity: true,
			note: 'a faction referred to by its short form in the second export'
		},
		{
			id: 'false-merge-generic-guard-title',
			subject: { name: 'Captain of the Watch', aliases: [] },
			candidate: { id: 'char-different-captain', name: 'Captain of the Watch', aliases: [] },
			sameEntity: false,
			note: 'a generic title reused across two different settlements, no location to disambiguate in the name alone'
		},
		{
			id: 'diacritics-only',
			subject: { name: 'Seraphine Duval', aliases: [] },
			candidate: { id: 'char-seraphine-accented', name: 'Séraphine Duval', aliases: [] },
			sameEntity: true,
			note: 'a diacritic added or dropped between exports, common for names transliterated differently'
		}
	]
};
