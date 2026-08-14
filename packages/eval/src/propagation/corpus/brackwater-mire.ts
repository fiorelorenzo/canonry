/**
 * A second, independent world for the propagation corpus (issue #99), built to stress
 * precision rather than recall: several entities share a relation path to the edited
 * entity without being narratively relevant to the specific edit, which is exactly the
 * kind of false positive a graph-only selector produces and a competent GM would not.
 */
import type { PropagationWorld } from '../types.js';

export const brackwaterMire: PropagationWorld = {
	id: 'brackwater-mire',
	name: 'Brackwater Mire',
	entities: [
		{
			type: 'character',
			slug: 'ysolt-corr',
			name: 'Ysolt Corr',
			aliases: ['the Toll-Keeper'],
			body: 'Keeps the toll book at [[Brackwater Landing]], on behalf of [[The Toll Wardens]]. She has never once miscounted, which is why smugglers hate her more than they hate the mire.'
		},
		{
			type: 'character',
			slug: 'brant-kessel',
			name: 'Brant Kessel',
			body: 'Captain of [[The Drowned Chart]]. He knows the safe path through [[The Sunken Road]] better than the Wardens do, which is the whole business model.'
		},
		{
			type: 'character',
			slug: 'old-tavey',
			name: 'Old Tavey',
			body: "An alchemist who keeps a hut at the edge of [[Brackwater Landing]] and trades cures for nobody's coin. She was here before [[The Flood of Reeds]] and intends to outlast whatever comes next."
		},
		{
			type: 'place',
			slug: 'brackwater-landing',
			name: 'Brackwater Landing',
			body: 'A trading post built on stilts over the mire. Every cart bound for the coast road crosses [[The Sunken Road]] to reach it.'
		},
		{
			type: 'place',
			slug: 'the-sunken-road',
			name: 'The Sunken Road',
			body: 'A half-drowned causeway, passable only at low water. [[The Toll Wardens]] mark the safe stones; everyone else guesses.'
		},
		{
			type: 'faction',
			slug: 'the-toll-wardens',
			name: 'The Toll Wardens',
			body: 'Licensed by nobody in particular, they collect a toll on the Sunken Road anyway, and have for three generations.'
		},
		{
			type: 'faction',
			slug: 'the-drowned-chart',
			name: 'The Drowned Chart',
			body: 'A smuggling ring that moves salt and worse around the toll rather than through it.'
		},
		{
			type: 'item',
			slug: 'the-ledger-stone',
			name: 'The Ledger Stone',
			body: 'A stone kept at [[Brackwater Landing]] that records every toll [[The Toll Wardens]] have ever collected, and cannot be altered once a mark is set.'
		},
		{
			type: 'event',
			slug: 'the-flood-of-reeds',
			name: 'The Flood of Reeds',
			body: 'The year the mire rose and swallowed the old landing, three seasons before the current one was built.'
		}
	],
	relations: [
		{ from: 'ysolt-corr', label: 'member of', to: 'the-toll-wardens' },
		{ from: 'ysolt-corr', label: 'located in', to: 'brackwater-landing' },
		{ from: 'brant-kessel', label: 'commands', to: 'the-drowned-chart' },
		{ from: 'the-toll-wardens', label: 'located in', to: 'the-sunken-road' },
		{ from: 'the-toll-wardens', label: 'owns', to: 'the-ledger-stone' },
		{ from: 'the-ledger-stone', label: 'located in', to: 'brackwater-landing' },
		{ from: 'old-tavey', label: 'located in', to: 'brackwater-landing' }
	],
	cases: [
		{
			id: 'ledger-stone-erased',
			editSummary:
				'The Toll Wardens: Ysolt Corr found a section of the Ledger Stone erased, the first alteration in three generations.',
			editedEntitySlug: 'the-toll-wardens',
			editedBody:
				'Licensed by nobody in particular, they collect a toll on the Sunken Road anyway, and have for three generations.\n\nYsolt Corr found a section of [[The Ledger Stone]] erased this week, the first alteration in three generations.',
			expected: ['the-ledger-stone', 'ysolt-corr', 'brant-kessel'],
			mustNotPropose: ['old-tavey', 'the-flood-of-reeds', 'the-sunken-road'],
			rationale:
				'The Ledger Stone is the object of the event and the item itself is what changed. Ysolt Corr is the member who found it and the toll-keeper of record. Brant Kessel runs the only outfit that profits from an altered toll record, so he is the prime suspect even though nothing names him. The Sunken Road shares a formal relation with the Wardens but nothing about a stone being erased touches the road itself - a graph-only selector would drag it in anyway, which is the point of listing it here. Old Tavey and the Flood of Reeds have no connection to toll records at all.'
		},
		{
			id: 'brant-bribes-toll-keeper',
			editSummary:
				"Brant Kessel: he's begun paying Ysolt Corr directly for a blind eye at the Sunken Road crossing.",
			editedEntitySlug: 'brant-kessel',
			editedBody:
				"Captain of [[The Drowned Chart]]. He knows the safe path through [[The Sunken Road]] better than the Wardens do, which is the whole business model.\n\nHe's begun paying [[Ysolt Corr]] directly for a blind eye at the crossing.",
			expected: ['ysolt-corr', 'the-sunken-road', 'the-toll-wardens', 'the-drowned-chart'],
			mustNotPropose: ['old-tavey', 'the-flood-of-reeds', 'the-ledger-stone'],
			rationale:
				"Ysolt Corr is named and bribed directly, so she ranks first. The Sunken Road is the physical site where the bribe changes what happens. The Toll Wardens' integrity is compromised through their own member. The Drowned Chart is the beneficiary of its own captain's arrangement. Old Tavey, the Flood of Reeds and the Ledger Stone have nothing to do with a bribe at the crossing."
		},
		{
			id: 'tavey-trades-for-tokens',
			editSummary:
				'Old Tavey: she has begun trading her cures for passage tokens instead of coin, which only the Toll Wardens issue.',
			editedEntitySlug: 'old-tavey',
			editedBody:
				"An alchemist who keeps a hut at the edge of [[Brackwater Landing]] and trades cures for nobody's coin. She was here before [[The Flood of Reeds]] and intends to outlast whatever comes next.\n\nShe has begun trading her cures for passage tokens instead of coin, which only [[The Toll Wardens]] issue.",
			expected: ['the-toll-wardens'],
			mustNotPropose: [
				'ysolt-corr',
				'brant-kessel',
				'the-drowned-chart',
				'the-ledger-stone',
				'the-sunken-road',
				'the-flood-of-reeds',
				'brackwater-landing'
			],
			rationale:
				"The Toll Wardens are the only entity whose facts change: their tokens now circulate outside the toll system. Everything else in the mire is either Tavey's already-established, unchanged surroundings (Brackwater Landing, the Flood of Reeds) or has no stake in what an alchemist trades for."
		}
	]
};
