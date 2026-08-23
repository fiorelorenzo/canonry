/**
 * #189/#191's own tests - the value of these issues is entirely in the judgement calls
 * (see relation-types.ts's own comments for the reasoning behind each), so these assert
 * on the calls themselves: the epic's four `employs` synonyms converge, an inverse label
 * never mints a second type, a genuinely new relation is recognised as one (against a real
 * embedder, not only a stub), a pair a type does not admit becomes `widen-proposed`, and a
 * gap on a *shipped* type forks a universe-scoped type instead of trying to mutate one that
 * cannot be mutated.
 *
 * #197's own tests are the `describe('cross-locale matching ...)` block below: nothing in
 * `ResolveRelationTypeInput` carries a locale, on purpose - the resolver matches a
 * proposed label against every shipped locale's strings unconditionally, so these tests
 * prove that without ever touching an "active interface language" concept at all.
 *
 * Against the real database (`openTestDb`), like every other integration test in this
 * package - `relationTypesForUniverse` is a real drizzle query, not something worth mocking.
 */
import { closeDb } from '@canonry/db';
import { hashingEmbedder } from '@canonry/indexing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	normalizeRelationLabel,
	resolveRelationType,
	type Embedder,
	type ResolveRelationTypeInput
} from './relation-types.js';
import { insertHomebrewUniverse, insertRelationType } from './test-helpers.js';
import { openTestDb } from './test-db.js';
import { RELATION_TYPE_CATALOGUE } from '@canonry/lang';

// An embedder that must never be called - for a case rung 1 (exact/inverse match) is
// expected to resolve on its own, so this also proves rung 1 short-circuits rung 2 rather
// than merely happening to win.
const UNREACHABLE_EMBEDDER: Embedder = async () => {
	throw new Error('rung 2 (semantic match) should never run once rung 1 already resolved');
};

/** A hand-built stub standing in for a real semantic embedding model, for the three
 * `employs` synonyms no amount of normalisation can catch ("employer of" / "works for" /
 * "hires" share no letters with "employs" - see relation-types.ts's own rung-1 doc comment
 * for why that is rung 2's job, not rung 1's). One-hot per relation concept: the three
 * synonyms and "employs" itself all land on the same basis vector (cosine similarity
 * exactly 1), every other catalogue label lands on its own orthogonal one (similarity
 * exactly 0 to anything outside its own family) - a deliberately idealised stand-in for
 * what a real dense embedding model's *judgement* should produce, not a claim about what
 * `hashingEmbedder` produces (see the `SEMANTIC_REUSE_THRESHOLD` comment on why that
 * distinction matters, and the "fears" test below for the one case that does run against
 * the real network-free embedder instead of this stub).
 */
const EMPLOYS_FAMILY: Record<string, true> = {
	employs: true,
	'employer of': true,
	'works for': true,
	hires: true
};
const CONCEPTS = [
	'employs',
	'commands',
	'located in',
	'member of',
	'ally of',
	'parent of',
	'owns',
	'appointed',
	'part of',
	'protects'
];
const conceptEmbedder: Embedder = async (texts) => {
	return texts.map((text) => {
		const key = text.toLowerCase().trim();
		const concept = EMPLOYS_FAMILY[key] ? 'employs' : key;
		const index = CONCEPTS.indexOf(concept);
		const vector = new Array(CONCEPTS.length).fill(0);
		if (index >= 0) vector[index] = 1;
		return vector;
	});
};

/** "si trova a" is a genuine Italian paraphrase of "located in" - not an exact string
 * match against the catalogue's own Italian label ("si trova in") in any locale, so
 * resolving it has to be rung 2's job. Every other text this maps against every locale's
 * label/inverse label for every shipped key, one-hot per key - the same idealised-judgement
 * idiom `conceptEmbedder` above uses, just built from `RELATION_TYPE_CATALOGUE` directly so
 * this stays a stand-in for "the embedder recognises this text as this shipped concept",
 * not a hardcoded duplicate of the catalogue's strings. */
const LOCATED_IN_PARAPHRASE = 'si trova a';
const CATALOGUE_KEYS = Object.keys(RELATION_TYPE_CATALOGUE.en);
function crossLocaleConceptFor(text: string): string | null {
	const normalized = text.toLowerCase().trim();
	if (normalized === LOCATED_IN_PARAPHRASE) return 'located_in';
	for (const key of CATALOGUE_KEYS) {
		const en = RELATION_TYPE_CATALOGUE.en[key]!;
		const it = RELATION_TYPE_CATALOGUE.it[key]!;
		const strings = [en.label, en.inverseLabel, it.label, it.inverseLabel];
		if (strings.some((s) => s.toLowerCase() === normalized)) return key;
	}
	return null;
}
const crossLocaleEmbedder: Embedder = async (texts) =>
	texts.map((text) => {
		const concept = crossLocaleConceptFor(text);
		const vector = new Array(CATALOGUE_KEYS.length).fill(0);
		if (concept) vector[CATALOGUE_KEYS.indexOf(concept)] = 1;
		return vector;
	});

describe('resolveRelationType', () => {
	const db = openTestDb();

	afterAll(async () => {
		await closeDb(db);
	});

	function baseInput(
		universeId: string,
		overrides: Partial<ResolveRelationTypeInput> = {}
	): ResolveRelationTypeInput {
		return {
			universeId,
			label: 'employs',
			inverseLabel: 'employed by',
			cardinality: 'one_to_many',
			fromType: 'faction',
			toType: 'character',
			...overrides
		};
	}

	it('the epic\'s four synonyms of "employs" all resolve to the same shipped type', async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);
		const deps = { db, embed: conceptEmbedder };

		const exact = await resolveRelationType(deps, baseInput(universeId, { label: 'employs' }));
		expect(exact.kind).toBe('existing');
		if (exact.kind !== 'existing') throw new Error('unreachable');
		expect(exact.type.universeId).toBeNull(); // the shipped catalogue row, not a fork

		const shippedId = exact.type.id;

		for (const label of ['employer of', 'works for', 'hires']) {
			const resolution = await resolveRelationType(deps, baseInput(universeId, { label }));
			expect(resolution.kind).toBe('reuse-proposed');
			if (resolution.kind !== 'reuse-proposed') throw new Error('unreachable');
			expect(resolution.type.id).toBe(shippedId);
			expect(resolution.proposedLabel).toBe(label);
			// Guardrail 3: evidence is a sentence, never a bare number - structurally true here
			// (the union carries no similarity field at all), and `why` still has to actually
			// read as prose.
			expect(resolution.why).toMatch(/employ/i);
			expect(resolution.why).not.toMatch(/^[0-9.]+$/);
		}
	});

	it("a label matching an existing type's inverse label reuses it, ends reversed, rather than creating a second type", async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);

		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			baseInput(universeId, {
				label: 'Commanded By', // catalogue "commands"'s own inverse label, cased/spaced differently
				inverseLabel: 'commands',
				fromType: 'character',
				toType: 'faction'
			})
		);

		expect(resolution.kind).toBe('existing');
		if (resolution.kind !== 'existing') throw new Error('unreachable');
		expect(resolution.type.label).toBe('commands');
		expect(resolution.type.universeId).toBeNull();
		// Issue #628: the caller has to swap the ends to write a correct row, and the
		// resolution is what tells it so. This used to be re-derived by the caller with an
		// exported `isInverseMatch`, which no caller ever called.
		expect(resolution.reversed).toBe(true);
	});

	it("a universe's own override of a shipped label wins on an exact tie", async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);
		const own = await insertRelationType(db, universeId, {
			label: 'employs',
			inverseLabel: 'employed by',
			cardinality: 'many_to_many',
			allowedFrom: ['character', 'faction', 'item', 'event', 'place', 'session'],
			allowedTo: ['character', 'faction', 'item', 'event', 'place', 'session']
		});

		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			baseInput(universeId, { label: 'employs' })
		);

		expect(resolution.kind).toBe('existing');
		if (resolution.kind !== 'existing') throw new Error('unreachable');
		expect(resolution.type.id).toBe(own.id);
		expect(resolution.type.universeId).toBe(universeId);
	});

	it('a genuinely new relation ("fears") comes back new-proposed, against a real embedder', async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);

		const resolution = await resolveRelationType(
			{ db, embed: hashingEmbedder },
			baseInput(universeId, {
				label: 'fears',
				inverseLabel: 'feared by',
				fromType: 'character',
				toType: 'character'
			})
		);

		expect(resolution.kind).toBe('new-proposed');
		if (resolution.kind !== 'new-proposed') throw new Error('unreachable');
		expect(resolution.label).toBe('fears');
		expect(resolution.inverseLabel).toBe('feared by');
		expect(resolution.from).toBe('character');
		expect(resolution.to).toBe('character');
	});

	it("a pair a universe's own type does not admit comes back widen-proposed, not a rejection or a silent write", async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);
		const own = await insertRelationType(db, universeId, {
			label: 'guards',
			inverseLabel: 'guarded by',
			cardinality: 'many_to_many',
			allowedFrom: ['character'],
			allowedTo: ['place']
		});

		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			baseInput(universeId, {
				label: 'guards',
				inverseLabel: 'guarded by',
				fromType: 'character',
				toType: 'item' // "place" is admitted, "item" is not
			})
		);

		expect(resolution.kind).toBe('widen-proposed');
		if (resolution.kind !== 'widen-proposed') throw new Error('unreachable');
		expect(resolution.type.id).toBe(own.id);
		expect(resolution.addFrom).toBeUndefined(); // "character" was already admitted
		expect(resolution.addTo).toBe('item');
		expect(resolution.why).not.toMatch(/^[0-9.]+$/);
	});

	it('a pair the shipped catalogue does not admit forks a universe-scoped type instead of widen-proposed (the shipped row is migration-only)', async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);

		// Shipped "owns": {character,faction} -> {item,place}. "event" is not admitted on
		// either side.
		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			baseInput(universeId, {
				label: 'owns',
				inverseLabel: 'owned by',
				fromType: 'character',
				toType: 'event'
			})
		);

		expect(resolution.kind).toBe('new-proposed');
		if (resolution.kind !== 'new-proposed') throw new Error('unreachable');
		// Forks under the catalogue's own canonical label/inverseLabel/cardinality, not a
		// fresh guess - "the same 'owns', just wider for this universe".
		expect(resolution.label).toBe('owns');
		expect(resolution.inverseLabel).toBe('owned by');
		expect(resolution.cardinality).toBe('one_to_many');
		expect(resolution.from).toBe('character');
		expect(resolution.to).toBe('event');
	});
});

describe('cross-locale matching (#197)', () => {
	const db = openTestDb();

	afterAll(async () => {
		await closeDb(db);
	});

	function baseInput(
		universeId: string,
		overrides: Partial<ResolveRelationTypeInput> = {}
	): ResolveRelationTypeInput {
		return {
			universeId,
			label: 'comanda',
			inverseLabel: 'comandato da',
			cardinality: 'one_to_many',
			fromType: 'character',
			toType: 'faction',
			...overrides
		};
	}

	it('rung 1 resolves an Italian label onto a shipped type, even though nothing about the caller says which locale it is', async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);

		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			baseInput(universeId, { label: 'comanda' }) // "commands" in Italian
		);

		expect(resolution.kind).toBe('existing');
		if (resolution.kind !== 'existing') throw new Error('unreachable');
		expect(resolution.type.key).toBe('commands');
		expect(resolution.type.universeId).toBeNull(); // the shipped row, not a fresh fork
	});

	it('rung 1b resolves an Italian *inverse* label onto a shipped type with the ends reversed', async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);

		// "ha come membro" is "member of"'s own Italian inverse label ("has member") -
		// proposed faction -> character, the ends `member of` itself would use, since a
		// match on the inverse swaps which of the caller's entities plays which side.
		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			baseInput(universeId, {
				label: 'Ha Come Membro',
				inverseLabel: 'membro di',
				fromType: 'faction',
				toType: 'character'
			})
		);

		expect(resolution.kind).toBe('existing');
		if (resolution.kind !== 'existing') throw new Error('unreachable');
		expect(resolution.type.key).toBe('member_of');
		expect(resolution.type.universeId).toBeNull();
	});

	it('rung 2 resolves an Italian paraphrase (not an exact catalogue string in any locale) onto a shipped type semantically', async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);

		const resolution = await resolveRelationType(
			{ db, embed: crossLocaleEmbedder },
			baseInput(universeId, {
				label: LOCATED_IN_PARAPHRASE,
				inverseLabel: 'contiene',
				fromType: 'faction',
				toType: 'place'
			})
		);

		expect(resolution.kind).toBe('reuse-proposed');
		if (resolution.kind !== 'reuse-proposed') throw new Error('unreachable');
		expect(resolution.type.key).toBe('located_in');
		expect(resolution.type.universeId).toBeNull();
		expect(resolution.proposedLabel).toBe(LOCATED_IN_PARAPHRASE);
	});

	it("a universe's own type still only matches its own authored label, never through the shipped catalogue's other locales", async () => {
		const { id: universeId } = await insertHomebrewUniverse(db);
		await insertRelationType(db, universeId, {
			label: 'comanda', // deliberately the shipped catalogue's own Italian word, as a
			// universe's own English-interface label - this type has no catalogue entry
			// (`universeId` is not null), so cross-locale expansion must not apply to it.
			inverseLabel: 'comandato da su misura'
		});

		// "commands"'s own real Italian catalogue label is "comanda" too, but the shipped
		// row is a *different* type - an exact match still has to resolve to whichever row
		// actually reads "comanda" today (universe-owned overrides shipped, same rule the
		// existing English test above already covers), never both at once.
		const resolution = await resolveRelationType(
			{ db, embed: UNREACHABLE_EMBEDDER },
			baseInput(universeId, { label: 'comanda' })
		);

		expect(resolution.kind).toBe('existing');
		if (resolution.kind !== 'existing') throw new Error('unreachable');
		expect(resolution.type.universeId).toBe(universeId); // the universe's own row won the tie
	});
});

describe('normalizeRelationLabel', () => {
	it('collapses case, punctuation and whitespace', () => {
		expect(normalizeRelationLabel('  Employs, ')).toBe(normalizeRelationLabel('employs'));
	});

	it("collapses the epic's own three-way morphology example", () => {
		const employ = normalizeRelationLabel('employ');
		const employs = normalizeRelationLabel('employs');
		const employed = normalizeRelationLabel('employed');
		expect(employ).toBe(employs);
		expect(employ).toBe(employed);
	});

	it('never mangles a short function word that happens to end in "s"/"ed"', () => {
		expect(normalizeRelationLabel('as')).toBe('as');
		expect(normalizeRelationLabel('of')).toBe('of');
	});
});
