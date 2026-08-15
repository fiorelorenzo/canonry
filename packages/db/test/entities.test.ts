// Issue #122, SPEC.md §17: detect on write, never overwrite a human - including when the
// human's own answer was "not sure / mixed" (null). `nextEntityLanguage` is the pure
// decision, tested directly with no database; `saveEntityBody`, `setEntityLanguage` and
// `resetEntityLanguageToDetected` are the write path, tested against a real save so the
// guard is proven where it actually has to hold: a committed row, not just a function call.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	eq,
	nextEntityLanguage,
	resetEntityLanguageToDetected,
	saveEntityBody,
	setEntityLanguage,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { insertHomebrewUniverse, insertUser, testDb, unique } from './helpers.js';

const ENGLISH_BODY =
	'Dismissed from the watch in the thaw after the Sable Winter, he now answers to the Ashen Ledger. ' +
	'He still drinks at the Gilded Rat, in the corner seat nobody asks him to leave.';

const ITALIAN_BODY =
	'Cacciato dalla guardia nel disgelo dopo l\u2019Inverno Sabbia, ora risponde al Libro di Cenere. ' +
	'Beve ancora al Ratto Dorato, nel posto d\u2019angolo che nessuno gli chiede di lasciare.';

const MIXED_BODY = `${ENGLISH_BODY}\n\n${ITALIAN_BODY}`;

describe('nextEntityLanguage (pure decision, no I/O)', () => {
	it('detects English for a "detected" row', () => {
		expect(
			nextEntityLanguage({ language: null, languageSource: 'detected' }, ENGLISH_BODY)
		).toEqual({
			language: 'en',
			languageSource: 'detected'
		});
	});

	it('detects Italian for a "detected" row', () => {
		expect(
			nextEntityLanguage({ language: null, languageSource: 'detected' }, ITALIAN_BODY)
		).toEqual({
			language: 'it',
			languageSource: 'detected'
		});
	});

	it('refuses to guess a genuinely mixed body, even under "detected" (SPEC.md §17)', () => {
		expect(nextEntityLanguage({ language: null, languageSource: 'detected' }, MIXED_BODY)).toEqual({
			language: null,
			languageSource: 'detected'
		});
	});

	it('a "detected" row is honestly downgraded to null when the new body no longer decides', () => {
		// Was confidently English on some earlier save; the body has since been edited down
		// to something the heuristic can no longer read.
		expect(
			nextEntityLanguage({ language: 'en', languageSource: 'detected' }, 'Aldric Vane')
		).toEqual({
			language: null,
			languageSource: 'detected'
		});
	});

	it('never touches a "human" row, whatever the body says', () => {
		expect(nextEntityLanguage({ language: 'it', languageSource: 'human' }, ENGLISH_BODY)).toEqual({
			language: 'it',
			languageSource: 'human'
		});
	});

	it('a "human" row can be null - "not sure / mixed" is a real, sticky answer', () => {
		expect(nextEntityLanguage({ language: null, languageSource: 'human' }, ENGLISH_BODY)).toEqual({
			language: null,
			languageSource: 'human'
		});
	});
});

describe('saveEntityBody, setEntityLanguage, resetEntityLanguageToDetected (issue #122 write path)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function seedEntity(overrides: Partial<typeof entity.$inferInsert> = {}) {
		const owner = await insertUser(db);
		const world = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const [row] = await db
			.insert(entity)
			.values({
				universeId: world.id,
				type: 'character',
				name: 'Test Entity',
				slug: unique('test-entity'),
				aliases: [],
				body: '',
				...overrides
			})
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		return { owner, world, row };
	}

	async function reload(entityId: string) {
		const [row] = await db.select().from(entity).where(eq(entity.id, entityId));
		if (!row) throw new Error('entity disappeared');
		return row;
	}

	it('detection sets the column on a real save', async () => {
		const { owner, world, row } = await seedEntity();
		expect(row.language).toBeNull();
		expect(row.languageSource).toBe('detected');

		const result = await saveEntityBody(db, {
			universeId: world.id,
			entityId: row.id,
			entityName: row.name,
			entityAliases: row.aliases,
			authorUserId: owner.id,
			body: ENGLISH_BODY,
			current: { language: row.language, languageSource: row.languageSource }
		});
		expect(result.language).toBe('en');
		expect(result.languageSource).toBe('detected');

		const saved = await reload(row.id);
		expect(saved.body).toBe(ENGLISH_BODY);
		expect(saved.language).toBe('en');
		expect(saved.languageSource).toBe('detected');
	});

	it("a hand-set value survives a save that would detect otherwise (a GM's choice is sticky)", async () => {
		const { owner, world, row } = await seedEntity({ body: ITALIAN_BODY });
		await setEntityLanguage(db, { entityId: row.id, language: 'it' });

		// The body this save writes is unambiguously English, and would detect as 'en' on
		// its own - the point of the test is that it never gets the chance to.
		const result = await saveEntityBody(db, {
			universeId: world.id,
			entityId: row.id,
			entityName: row.name,
			entityAliases: row.aliases,
			authorUserId: owner.id,
			body: ENGLISH_BODY,
			current: { language: 'it', languageSource: 'human' }
		});
		expect(result.language).toBe('it');
		expect(result.languageSource).toBe('human');

		const saved = await reload(row.id);
		expect(saved.body).toBe(ENGLISH_BODY);
		expect(saved.language).toBe('it');
		expect(saved.languageSource).toBe('human');
	});

	it('null is reachable (the "not sure / mixed" control answer) and preserved across a save', async () => {
		const { owner, world, row } = await seedEntity();
		const unsure = await setEntityLanguage(db, { entityId: row.id, language: null });
		expect(unsure).toEqual({ language: null, languageSource: 'human' });

		const afterUnsure = await reload(row.id);
		expect(afterUnsure.language).toBeNull();
		expect(afterUnsure.languageSource).toBe('human');

		// A save with a confidently-Italian body would detect 'it' under 'detected' - here
		// it must leave the GM's "not sure / mixed" answer exactly where it was.
		const result = await saveEntityBody(db, {
			universeId: world.id,
			entityId: row.id,
			entityName: row.name,
			entityAliases: row.aliases,
			authorUserId: owner.id,
			body: ITALIAN_BODY,
			current: { language: afterUnsure.language, languageSource: afterUnsure.languageSource }
		});
		expect(result.language).toBeNull();
		expect(result.languageSource).toBe('human');

		const saved = await reload(row.id);
		expect(saved.language).toBeNull();
		expect(saved.languageSource).toBe('human');
	});

	it('a mixed body saved under "detected" lands as null, not a confident wrong guess', async () => {
		const { owner, world, row } = await seedEntity();
		const result = await saveEntityBody(db, {
			universeId: world.id,
			entityId: row.id,
			entityName: row.name,
			entityAliases: row.aliases,
			authorUserId: owner.id,
			body: MIXED_BODY,
			current: { language: row.language, languageSource: row.languageSource }
		});
		expect(result.language).toBeNull();
		expect(result.languageSource).toBe('detected');
	});

	it('resetEntityLanguageToDetected reverts a human override and re-detects immediately', async () => {
		const { row } = await seedEntity({
			body: ITALIAN_BODY,
			language: 'en',
			languageSource: 'human'
		});

		const result = await resetEntityLanguageToDetected(db, { entityId: row.id });
		expect(result).toEqual({ language: 'it', languageSource: 'detected' });

		const saved = await reload(row.id);
		expect(saved.language).toBe('it');
		expect(saved.languageSource).toBe('detected');
	});

	it('setEntityLanguage always records "human" provenance, including for a real locale', async () => {
		const { row } = await seedEntity();
		const result = await setEntityLanguage(db, { entityId: row.id, language: 'en' });
		expect(result).toEqual({ language: 'en', languageSource: 'human' });

		const saved = await reload(row.id);
		expect(saved.language).toBe('en');
		expect(saved.languageSource).toBe('human');
	});
});
