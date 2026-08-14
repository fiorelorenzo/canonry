/**
 * A third, independent world for the propagation corpus (issue #99), built to stress
 * ordering and the "does not follow from the graph alone" case: the third case's expected
 * propagation is a narrative judgment call (an old anecdote embarrassing a current office
 * holder) that no relation-hop count would produce, which is what a competent-GM ground
 * truth is for.
 */
import type { PropagationWorld } from '../types.js';

export const thornwickCollege: PropagationWorld = {
	id: 'thornwick-college',
	name: 'Thornwick College',
	entities: [
		{
			type: 'character',
			slug: 'provost-wenna-dael',
			name: 'Provost Wenna Dael',
			body: 'Provost of [[Thornwick College]] for eleven years, and the last one who still opens the gate herself on exam mornings.'
		},
		{
			type: 'character',
			slug: 'rook-adair',
			name: 'Rook Adair',
			body: 'Third-year at [[Thornwick College]], apprenticed under [[Magister Corin Fell]] after his first mentor was dismissed.'
		},
		{
			type: 'character',
			slug: 'magister-corin-fell',
			name: 'Magister Corin Fell',
			body: 'Keeper of [[The Sunken Vault]] and the strictest marker in the faculty. He answers only to [[Provost Wenna Dael]].'
		},
		{
			type: 'place',
			slug: 'thornwick-college',
			name: 'Thornwick College',
			body: 'A college of seven towers built into a cliff. Half its library is older than the kingdom that funds it.\n\n## Rivalry\n\nIts oldest rivalry runs through [[Blackmere College]] every exam season, though neither side remembers why it started.'
		},
		{
			type: 'place',
			slug: 'the-sunken-vault',
			name: 'The Sunken Vault',
			body: 'The lowest room of [[Thornwick College]], where anything too dangerous to shelve is kept instead.'
		},
		{
			type: 'item',
			slug: 'the-cracked-astrolabe',
			name: 'The Cracked Astrolabe',
			body: 'Held in [[The Sunken Vault]]. It has not worked correctly since before anyone alive was born, and nobody has found the crack.'
		},
		{
			type: 'faction',
			slug: 'blackmere-college',
			name: 'Blackmere College',
			body: "Thornwick's rival across the strait. Their students sit the same exam board and mock the outcome every year regardless of the result."
		},
		{
			type: 'event',
			slug: 'the-founding-exam',
			name: 'The Founding Exam',
			body: 'The exam every founding provost of [[Thornwick College]] once had to pass personally. Nobody has required it in four generations.'
		}
	],
	relations: [
		{ from: 'provost-wenna-dael', label: 'commands', to: 'magister-corin-fell' },
		{ from: 'magister-corin-fell', label: 'owns', to: 'the-sunken-vault' },
		{ from: 'magister-corin-fell', label: 'located in', to: 'thornwick-college' },
		{ from: 'rook-adair', label: 'located in', to: 'thornwick-college' },
		{ from: 'the-cracked-astrolabe', label: 'located in', to: 'the-sunken-vault' }
	],
	cases: [
		{
			id: 'astrolabe-second-crack',
			editSummary:
				'The Cracked Astrolabe: Rook Adair found a second crack overnight, in a room he should not have had a key to.',
			editedEntitySlug: 'the-cracked-astrolabe',
			editedBody:
				'Held in [[The Sunken Vault]]. It has not worked correctly since before anyone alive was born, and nobody has found the crack.\n\n[[Rook Adair]] found a second crack overnight, in a room he should not have had a key to.',
			expected: ['rook-adair', 'magister-corin-fell', 'the-sunken-vault'],
			mustNotPropose: ['blackmere-college', 'the-founding-exam'],
			rationale:
				'Rook Adair is named and is the one who should not have had access, so he ranks first. Magister Corin Fell is the accountable keeper of the vault a student was not supposed to enter. The Sunken Vault is the room whose security just failed. Blackmere College and the Founding Exam have no connection to a security breach in the vault.'
		},
		{
			id: 'provost-summons-fell',
			editSummary:
				"Provost Wenna Dael: she's summoned Magister Corin Fell to explain irregularities in the Vault ledger this week.",
			editedEntitySlug: 'provost-wenna-dael',
			editedBody:
				"Provost of [[Thornwick College]] for eleven years, and the last one who still opens the gate herself on exam mornings.\n\nShe's summoned [[Magister Corin Fell]] to explain irregularities in the Vault ledger this week.",
			expected: ['magister-corin-fell', 'the-sunken-vault'],
			mustNotPropose: ['rook-adair', 'blackmere-college', 'the-founding-exam', 'thornwick-college'],
			rationale:
				"Magister Corin Fell is summoned directly. The Sunken Vault is what the ledger irregularities are about. Rook Adair is Fell's apprentice, but nothing here implicates students - proposing him would be exactly the kind of noise the harness exists to catch. The college itself, its rival and the old exam are unaffected by a ledger dispute between two named people."
		},
		{
			id: 'founding-exam-scandal-uncovered',
			editSummary:
				'The Founding Exam: a newly found faculty minute shows it was quietly dropped after a provost failed it in front of the whole college.',
			editedEntitySlug: 'the-founding-exam',
			editedBody:
				'The exam every founding provost of [[Thornwick College]] once had to pass personally. Nobody has required it in four generations.\n\nA newly found faculty minute shows the exam was quietly dropped after a provost failed it in front of the whole college.',
			expected: ['thornwick-college', 'provost-wenna-dael'],
			mustNotPropose: [
				'magister-corin-fell',
				'rook-adair',
				'the-sunken-vault',
				'the-cracked-astrolabe',
				'blackmere-college'
			],
			rationale:
				"This is a judgment call a hop-count could not make: an old, embarrassing precedent about a provost failing publicly is worth surfacing to the institution's own history entry and to the current provost, who now holds an office with a buried scandal attached, even though she was not involved. Nothing about the vault, its keeper, its apprentice or the rival college is touched by an exam-history detail."
		}
	]
};
