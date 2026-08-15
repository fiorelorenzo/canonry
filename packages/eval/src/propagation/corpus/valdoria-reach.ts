/**
 * Mirrors `packages/db/src/seed-fixture.ts` (the Valdoria Reach fixture every UX artifact
 * and `pnpm --filter @canonry/db seed` uses), so the propagation corpus and the seeded
 * database agree on the same world. Duplicated rather than imported: this package has no
 * dependency on @canonry/db, and `seed-fixture.ts` does not export its entity/relation
 * arrays. If that fixture changes, this file has to change with it - the two are meant to
 * describe the same twelve entities and nine relations (the db fixture's own `session-1`
 * and gm_only `the-drowned-concord` have no place here and stay out, same as always -
 * this corpus is about propagation candidates, not session logs or hidden canon).
 */
import type { PropagationWorld } from '../types.js';

const ALDRIC_BODY = `Dismissed from the watch in the thaw after [[The Sable Winter]], he now answers to [[The Ashen Ledger]]. He still drinks at [[The Gilded Rat]], in the corner seat nobody asks him to leave.

## Standing in the city

Three hundred and forty sworn used to take his word. Forty of them still would, which is the number [[Corvin Ashe]] is paying for.`;

export const valdoriaReach: PropagationWorld = {
	id: 'valdoria-reach',
	name: 'Valdoria Reach',
	entities: [
		{
			type: 'character',
			slug: 'aldric-vane',
			name: 'Aldric Vane',
			aliases: ['Captain Vane', 'the broken captain'],
			body: ALDRIC_BODY
		},
		{
			type: 'character',
			slug: 'mother-sennah',
			name: 'Mother Sennah',
			aliases: ['the Winter Surgeon'],
			body: 'Keeps [[The Gilded Rat]]. She was a field surgeon through [[The Sable Winter]] and does not talk about it, which is its own kind of talking about it.'
		},
		{
			type: 'character',
			slug: 'corvin-ashe',
			name: 'Corvin Ashe',
			body: "Factor of [[The Ashen Ledger]]. He holds most of the Lantern Quarter's debt and none of its affection."
		},
		{
			type: 'character',
			slug: 'iselde-wrenn',
			name: 'Iselde Wrenn',
			body: 'Harbour magistrate. She appointed [[Aldric Vane]], and then broke him, and has never explained which of the two she regrets.'
		},
		{
			type: 'place',
			slug: 'valdoria',
			name: 'Valdoria',
			body: 'A free port of six quarters. The Lantern Quarter is the poorest and the loudest.\n\n## The Watch\n\nThree hundred and forty sworn, badly paid, and currently without a captain.'
		},
		{
			type: 'place',
			slug: 'the-gilded-rat',
			name: 'The Gilded Rat',
			aliases: ['Gilded Rat Tavern', 'Il Ratto Dorato'],
			body: 'An inn in the Lantern Quarter. [[Mother Sennah]] keeps it, and the corner seat by the stair is understood to belong to somebody.'
		},
		{
			type: 'place',
			slug: 'cairnmouth',
			name: 'Cairnmouth',
			body: 'A fishing town two days up the coast. A third of it starved in [[The Sable Winter]] when [[The Sable Reach]] froze, and the rest remember exactly who did not come. Captain Vane led the watch through the second freeze, the winter after the thaw.'
		},
		{
			type: 'faction',
			slug: 'the-ashen-ledger',
			name: 'The Ashen Ledger',
			body: 'A merchant bank that lends at knife point and keeps better records than the magistrate.'
		},
		{
			type: 'faction',
			slug: 'the-valdoria-watch',
			name: 'The Valdoria Watch',
			body: 'Three hundred and forty sworn, paid badly and proud of it anyway.'
		},
		{
			type: 'event',
			slug: 'the-sable-winter',
			name: 'The Sable Winter',
			body: 'The year 1247, when the strait froze and [[Cairnmouth]] starved.'
		},
		{
			type: 'faction',
			slug: 'la-casa-dei-mercanti',
			name: 'La Casa dei Mercanti',
			aliases: ['The Merchant House'],
			// Issue #122, SPEC.md §17: the fixture's Italian entry, mirrored exactly from
			// packages/db/src/seed-fixture.ts.
			body: 'La Casa dei Mercanti tiene i suoi registri nel Quartiere della Lanterna, non lontano dal porto di [[Valdoria]]. Nessuno entra senza un debito da saldare o una lettera di credito da mostrare, e il vecchio Contabile non dimentica mai un nome.\n\n## Il libro nero\n\nOgni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa. [[The Ashen Ledger]] la considera una concorrente, mai un’alleata, e i loro uomini non bevono mai allo stesso tavolo.'
		},
		{
			type: 'item',
			slug: 'smugglers-ledger',
			name: "The Smugglers' Ledger",
			// Issue #122: the fixture's deliberately mixed entry, mirrored exactly from
			// packages/db/src/seed-fixture.ts - roughly even English and Italian sentences,
			// so `detectLanguage` refuses to pick a winner.
			body: 'A ledger nobody at the table has read yet, kept by whoever is running goods through the Lantern Quarter that week. The handwriting changes hands more than the goods do, and nobody has ever admitted to owning it.\n\nIl carico di questa settimana non è passato dal molo, ma dalla porta sul retro della locanda, dove nessuno guarda mai due volte. Chi scrive non firma mai con il proprio nome, e questo non è un caso.\n\nHalf the entries are crossed out, and the other half do not match what actually left the harbour that night. Whoever kept it after [[Aldric Vane]] stopped writing has a different hand entirely, but the same habit of saying less than they know.'
		}
	],
	relations: [
		{ from: 'the-ashen-ledger', label: 'employs', to: 'aldric-vane' },
		{ from: 'iselde-wrenn', label: 'appointed', to: 'aldric-vane' },
		{ from: 'aldric-vane', label: 'member of', to: 'the-valdoria-watch' },
		{ from: 'the-valdoria-watch', label: 'located in', to: 'valdoria' },
		{ from: 'the-gilded-rat', label: 'located in', to: 'valdoria' },
		{ from: 'mother-sennah', label: 'owns', to: 'the-gilded-rat' },
		{ from: 'the-ashen-ledger', label: 'employs', to: 'corvin-ashe' },
		{ from: 'la-casa-dei-mercanti', label: 'located in', to: 'valdoria' },
		{ from: 'smugglers-ledger', label: 'located in', to: 'valdoria' }
	],
	cases: [
		{
			id: 'aldric-appointment-review',
			editSummary:
				'Aldric Vane: added that Iselde Wrenn is reviewing every appointment she made before the freeze.',
			editedEntitySlug: 'aldric-vane',
			editedBody: `${ALDRIC_BODY}\n\nWord reached him that [[Iselde Wrenn]] is reviewing every appointment she made before the freeze, including his.`,
			expected: ['iselde-wrenn', 'the-ashen-ledger', 'the-valdoria-watch'],
			mustNotPropose: ['cairnmouth', 'the-sable-winter', 'mother-sennah', 'the-gilded-rat'],
			rationale:
				'Iselde Wrenn is named directly and is the causal subject of the review, so she ranks first. The Ashen Ledger has a financial stake in whether its employee keeps his standing. The Watch is the institution his standing is measured against. Cairnmouth and the Sable Winter are historical background the edit does not touch; Mother Sennah and the Gilded Rat are where Aldric drinks, not his employment status.'
		},
		{
			id: 'gilded-rat-turns-away-collectors',
			editSummary:
				'The Gilded Rat: Mother Sennah started turning away Ashen Ledger collectors at the door.',
			editedEntitySlug: 'the-gilded-rat',
			editedBody:
				'An inn in the Lantern Quarter. [[Mother Sennah]] keeps it, and the corner seat by the stair is understood to belong to somebody.\n\nSennah has started turning away [[The Ashen Ledger]] collectors at the door.',
			expected: ['mother-sennah', 'the-ashen-ledger', 'aldric-vane'],
			mustNotPropose: [
				'the-sable-winter',
				'cairnmouth',
				'iselde-wrenn',
				'the-valdoria-watch',
				'corvin-ashe'
			],
			rationale:
				'Mother Sennah is the owner and the direct actor. The Ashen Ledger is the named, affected party. Aldric Vane is caught between his employer and the tavern he drinks in, which a competent GM flags even though he is not named in this sentence. Corvin Ashe is a factor of the Ledger but not a collector, and nothing here implicates the harbour magistrate, the Watch, or events from 1247.'
		},
		{
			id: 'sable-winter-timeline-revision',
			editSummary:
				'The Sable Winter: historians now date the worst of the freeze to one week in Deepwinter.',
			editedEntitySlug: 'the-sable-winter',
			editedBody:
				'The year 1247, when the strait froze and [[Cairnmouth]] starved. Historians now date the worst of the freeze to a single week in Deepwinter, not the whole season.',
			expected: ['cairnmouth', 'mother-sennah', 'aldric-vane'],
			mustNotPropose: [
				'the-gilded-rat',
				'the-ashen-ledger',
				'iselde-wrenn',
				'corvin-ashe',
				'the-valdoria-watch',
				'valdoria'
			],
			rationale:
				'Cairnmouth starved because of this event, so a narrower dating changes its own account directly. Mother Sennah and Aldric Vane both anchor their backstory to this event ("through the Sable Winter", "in the thaw after"), so a timeline revision is worth flagging to them even though neither mentions the new detail. None of the Ledger, the magistrate, the tavern building or the Watch reference the timeline at all.'
		}
	]
};
