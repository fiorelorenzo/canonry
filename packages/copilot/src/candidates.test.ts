import { describe, expect, it } from 'vitest';
import { buildCandidatePool, type CandidateGraph } from './candidates.js';
import { semanticDiff } from './diff.js';

// A trimmed slice of packages/eval's valdoria-reach world, just enough to exercise every
// evidence source without dragging the whole corpus into a unit test.
const GRAPH: CandidateGraph = {
	entities: [
		{
			id: 'aldric-vane',
			type: 'character',
			name: 'Aldric Vane',
			aliases: ['Captain Vane'],
			body: 'Dismissed from the watch, he now answers to [[The Ashen Ledger]]. He still drinks at [[The Gilded Rat]].'
		},
		{
			id: 'iselde-wrenn',
			type: 'character',
			name: 'Iselde Wrenn',
			aliases: [],
			body: 'Harbour magistrate. She appointed [[Aldric Vane]].'
		},
		{
			id: 'the-ashen-ledger',
			type: 'faction',
			name: 'The Ashen Ledger',
			aliases: [],
			body: 'A merchant bank that lends at knife point.'
		},
		{
			id: 'the-valdoria-watch',
			type: 'faction',
			name: 'The Valdoria Watch',
			aliases: [],
			body: 'Three hundred and forty sworn, paid badly.'
		},
		{
			id: 'the-gilded-rat',
			type: 'place',
			name: 'The Gilded Rat',
			aliases: ['Gilded Rat Tavern'],
			body: 'An inn kept by [[Mother Sennah]].'
		},
		{
			id: 'mother-sennah',
			type: 'character',
			name: 'Mother Sennah',
			aliases: [],
			body: 'Keeps [[The Gilded Rat]].'
		},
		{
			id: 'cairnmouth',
			type: 'place',
			name: 'Cairnmouth',
			aliases: [],
			body: 'A fishing town, unrelated to any of this.'
		}
	],
	relations: [
		{ fromId: 'the-ashen-ledger', toId: 'aldric-vane', label: 'employs' },
		{ fromId: 'iselde-wrenn', toId: 'aldric-vane', label: 'appointed' },
		{ fromId: 'aldric-vane', toId: 'the-valdoria-watch', label: 'member of' },
		{ fromId: 'the-gilded-rat', toId: 'mother-sennah', label: 'owned by' }
	]
};

describe('buildCandidatePool', () => {
	it('finds hop-1 graph neighbours and scores them above hop-2', () => {
		const diff = semanticDiff(
			'Dismissed from the watch, he now answers to [[The Ashen Ledger]]. He still drinks at [[The Gilded Rat]].',
			'Dismissed from the watch, he now answers to [[The Ashen Ledger]]. He still drinks at [[The Gilded Rat]]. Word reached him of a routine review.'
		);
		const pool = buildCandidatePool(GRAPH, 'aldric-vane', diff);
		const byId = new Map(pool.map((c) => [c.entityId, c]));

		expect(byId.get('the-ashen-ledger')?.evidence[0]).toMatchObject({ kind: 'relation', hops: 1 });
		expect(byId.get('the-valdoria-watch')?.evidence[0]).toMatchObject({
			kind: 'relation',
			hops: 1
		});
		// cairnmouth is unreachable within 2 hops and unmentioned - never a candidate.
		expect(byId.has('cairnmouth')).toBe(false);
	});

	it('boosts a candidate that is both a graph neighbour and named in the new text', () => {
		const oldBody =
			'Dismissed from the watch, he now answers to [[The Ashen Ledger]]. He still drinks at [[The Gilded Rat]].';
		const newBody = `${oldBody}\n\nWord reached him that [[Iselde Wrenn]] is reviewing every appointment.`;
		const diff = semanticDiff(oldBody, newBody);
		const pool = buildCandidatePool(GRAPH, 'aldric-vane', diff);
		const byId = new Map(pool.map((c) => [c.entityId, c]));

		const iselde = byId.get('iselde-wrenn');
		const ledger = byId.get('the-ashen-ledger');
		expect(iselde).toBeDefined();
		expect(ledger).toBeDefined();
		// Iselde is a hop-1 relation *and* a forward mention; the Ledger is relation-only.
		expect(iselde!.score).toBeGreaterThan(ledger!.score);
	});

	it('recovers a candidate reachable only through a reverse mention, with no formal relation at all', () => {
		// The Gilded Rat is edited; Aldric Vane has no relation row to it, only a prose link
		// in his own body ("He still drinks at [[The Gilded Rat]]").
		const oldBody = 'An inn kept by [[Mother Sennah]].';
		const newBody = `${oldBody}\n\nSennah has started turning away [[The Ashen Ledger]] collectors at the door.`;
		const diff = semanticDiff(oldBody, newBody);
		const pool = buildCandidatePool(GRAPH, 'the-gilded-rat', diff);
		const byId = new Map(pool.map((c) => [c.entityId, c]));

		const aldric = byId.get('aldric-vane');
		expect(aldric).toBeDefined();
		expect(aldric!.evidence).toContainEqual(
			expect.objectContaining({ kind: 'mention', direction: 'reverse' })
		);
		// The Ledger is a forward mention in the new sentence.
		expect(byId.get('the-ashen-ledger')?.evidence).toContainEqual(
			expect.objectContaining({ kind: 'mention', direction: 'forward' })
		);
	});

	it('folds in an injected embedding match without touching graph or mention scoring', () => {
		const diff = semanticDiff('old', 'old new');
		const pool = buildCandidatePool(GRAPH, 'aldric-vane', diff, {
			embeddingMatches: [{ entityId: 'cairnmouth', similarity: 0.9, sourceSentence: 'old new' }]
		});
		const cairnmouth = pool.find((c) => c.entityId === 'cairnmouth');
		expect(cairnmouth).toBeDefined();
		expect(cairnmouth!.evidence[0]).toMatchObject({ kind: 'embedding', similarity: 0.9 });
	});

	it('throws for an edited entity id that is not in the graph', () => {
		expect(() => buildCandidatePool(GRAPH, 'does-not-exist', [])).toThrow();
	});
});
