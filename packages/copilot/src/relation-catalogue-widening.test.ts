/**
 * Issue #639: what it actually costs to resolve a foreign-language relation label by
 * widening the shipped catalogue, rather than by lowering `SEMANTIC_REUSE_THRESHOLD`.
 *
 * #629 measured 126 distinct proposed labels for 193 relations on one real Italian
 * campaign notebook, and showed that the semantic rung cannot close that gap at any
 * threshold, because a label can only merge onto a type that exists. The alternative on
 * the table is a wider shipped catalogue, and the claim behind it is a claim about cost:
 * a shipped row plus its per-locale catalogue entry resolves that locale's label at rung 1
 * exactly, with no embedding call and no threshold involved. These tests measure that
 * claim instead of assuming it, because the whole argument for widening rests on it.
 *
 * Two halves have to hold together, and the third test is the one that proves they are
 * two: the `relation_type` row (a migration, `universe_id` null) makes the type exist, and
 * the `RELATION_TYPE_CATALOGUE` entry (`packages/lang`) is what teaches
 * `relationTypeMatchCandidates` that this key is also known by an Italian word. The row on
 * its own resolves nothing in Italian.
 *
 * Nothing here proposes a key. The probe key is deliberately one nothing will ever ship,
 * because decision L1 makes a shipped key API surface from the moment it ships: choosing
 * the real ones is Lorenzo's call on #639, and a test is not the place to smuggle one in.
 * The probe's strings are invented for this file too, not taken from the corpus, which is
 * a third party's private campaign.
 *
 * The catalogue is a module-level literal rather than something injectable
 * (`relation-catalogue.ts`'s own doc comment explains why fixed shipped content is not a
 * seam), so a test that needs an eleventh entry adds one to it and puts it back. That is
 * safe across this package's concurrently-running test files for the reason vitest forks
 * per file: each file gets its own module registry, so the mutation is never visible
 * outside this one. The `relation_type` row is not, since every file in a run shares one
 * database - it carries a key nothing else selects on and is deleted in `afterAll`.
 */
import { closeDb, isNull, and, eq } from '@canonry/db';
import { relationType } from '@canonry/db/schema';
import { RELATION_TYPE_CATALOGUE } from '@canonry/lang';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveRelationType, type Embedder } from './relation-types.js';
import { insertHomebrewUniverse } from './test-helpers.js';
import { openTestDb } from './test-db.js';

/** Not a proposal. See the file comment: a key nothing ships, so this file claims none. */
const PROBE_KEY = 'w639_probe';
const PROBE_EN = { label: 'probes', inverseLabel: 'probed by' };
const PROBE_IT = { label: 'sonda', inverseLabel: 'sondato da' };

const UNREACHABLE_EMBEDDER: Embedder = async () => {
	throw new Error('rung 2 must never run: widening the catalogue is a rung-1 exact match');
};

/** Counts what rung 2 asks the gateway for, so "no embedding call" is a measurement rather
 * than an assertion about control flow. Returns zero vectors, which `cosineSimilarity`
 * scores at 0 by its own documented rule, so a rung-2 attempt resolves to `new-proposed`
 * instead of matching something by accident. */
function countingEmbedder(): { embed: Embedder; calls: () => number; texts: () => number } {
	let calls = 0;
	let texts = 0;
	return {
		embed: async (input) => {
			calls += 1;
			texts += input.length;
			return input.map(() => new Array(8).fill(0));
		},
		calls: () => calls,
		texts: () => texts
	};
}

describe('widening the shipped catalogue resolves a foreign label at rung 1 (#639)', () => {
	const db = openTestDb();

	beforeAll(async () => {
		await db.insert(relationType).values({
			universeId: null,
			key: PROBE_KEY,
			label: PROBE_EN.label,
			inverseLabel: PROBE_EN.inverseLabel,
			cardinality: 'one_to_many',
			allowedFrom: ['character', 'faction'],
			allowedTo: ['character', 'faction']
		});
	});

	afterAll(async () => {
		await db
			.delete(relationType)
			.where(and(isNull(relationType.universeId), eq(relationType.key, PROBE_KEY)));
		await closeDb(db);
	});

	afterEach(() => {
		delete RELATION_TYPE_CATALOGUE.it[PROBE_KEY];
		delete RELATION_TYPE_CATALOGUE.en[PROBE_KEY];
	});

	function shipCatalogueEntry(): void {
		RELATION_TYPE_CATALOGUE.en[PROBE_KEY] = PROBE_EN;
		RELATION_TYPE_CATALOGUE.it[PROBE_KEY] = PROBE_IT;
	}

	it("resolves the row's own Italian label with no embedding call at all", async () => {
		shipCatalogueEntry();
		const { id: universeId } = await insertHomebrewUniverse(db);

		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			{
				universeId,
				label: PROBE_IT.label,
				inverseLabel: PROBE_IT.inverseLabel,
				cardinality: 'one_to_many',
				fromType: 'character',
				toType: 'faction'
			}
		);

		expect(resolution.kind).toBe('existing');
		if (resolution.kind !== 'existing') throw new Error('unreachable');
		expect(resolution.type.key).toBe(PROBE_KEY);
		expect(resolution.type.universeId).toBeNull(); // the shipped row, not a per-universe fork
		expect(resolution.reversed).toBe(false);
	});

	it("resolves the row's Italian *inverse* label too, with the ends reversed", async () => {
		shipCatalogueEntry();
		const { id: universeId } = await insertHomebrewUniverse(db);

		// The direction a notebook writes a relation in is not the direction the catalogue
		// chose, and #628 is what happens when a caller ignores that. Half of #629's 126
		// labels are inverse phrasings, so a widened row has to earn both sides.
		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			{
				universeId,
				label: `  ${PROBE_IT.inverseLabel.toUpperCase()}, `, // rung 1 normalises first
				inverseLabel: PROBE_IT.label,
				cardinality: 'one_to_many',
				fromType: 'faction',
				toType: 'character'
			}
		);

		expect(resolution.kind).toBe('existing');
		if (resolution.kind !== 'existing') throw new Error('unreachable');
		expect(resolution.type.key).toBe(PROBE_KEY);
		expect(resolution.reversed).toBe(true);
	});

	it('the row without its catalogue entry resolves nothing in Italian, and falls to rung 2', async () => {
		// The control for the two above, and the reason widening is two edits rather than
		// one: with the migration's row present and no `RELATION_TYPE_CATALOGUE` entry, the
		// Italian label is not a string any candidate is known by, so it reaches the
		// embedder and becomes its own new-type question - exactly the 126.
		const { id: universeId } = await insertHomebrewUniverse(db);
		const counting = countingEmbedder();

		const resolution = await resolveRelationType(
			{ db, embed: counting.embed },
			{
				universeId,
				label: PROBE_IT.label,
				inverseLabel: PROBE_IT.inverseLabel,
				cardinality: 'one_to_many',
				fromType: 'character',
				toType: 'faction'
			}
		);

		expect(resolution.kind).toBe('new-proposed');
		expect(counting.calls()).toBeGreaterThan(0);

		// And the English label on the same row still resolves at rung 1 regardless, since
		// that one is stored on the row itself. So what the catalogue entry buys is exactly
		// the other locales, which is the cheap half of #639's claim.
		const english = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			{
				universeId,
				label: PROBE_EN.label,
				inverseLabel: PROBE_EN.inverseLabel,
				cardinality: 'one_to_many',
				fromType: 'character',
				toType: 'faction'
			}
		);
		expect(english.kind).toBe('existing');
	});

	it('a widened row admits only the pairs it was sized for, and says so rather than forking silently', async () => {
		// The other half of the cost, and #628's lesson: a row sized too narrowly does not
		// resolve, it forks a universe-scoped copy per universe that meets the gap. So
		// `allowed_from`/`allowed_to` on a new shipped row are part of the decision, not a
		// detail - the label matched at rung 1 here and the resolution is still not
		// `existing`.
		shipCatalogueEntry();
		const { id: universeId } = await insertHomebrewUniverse(db);

		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			{
				universeId,
				label: PROBE_IT.label,
				inverseLabel: PROBE_IT.inverseLabel,
				cardinality: 'one_to_many',
				fromType: 'character',
				toType: 'place' // the row admits {character,faction} on both ends
			}
		);

		expect(resolution.kind).toBe('new-proposed');
		if (resolution.kind !== 'new-proposed') throw new Error('unreachable');
		// Under the shipped type's own canonical English label rather than the Italian the
		// notebook proposed, which is `resolveAdmissionGap`'s documented behaviour for a
		// shipped type: there is no `universe_id`-null row an accept could widen.
		expect(resolution.label).toBe(PROBE_EN.label);
		expect(resolution.to).toBe('place');
	});
});
