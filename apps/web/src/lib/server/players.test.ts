/**
 * Issue #127: `loadPublicEntity`'s `language` field, the source for the `lang` attribute
 * the players' wiki entity page carries. Runs against the real dev Postgres, same
 * convention as `export.test.ts` next to it - its own uniquely-slugged universe, cleaned
 * up afterwards, never touching the seeded fixture world.
 *
 * The test that matters most here (`never leaks a secret's language`) is the reason
 * `loadPublicEntity` detects fresh from the *stripped* body instead of trusting
 * `entity.language`: a body can read as unambiguous English to a player while its raw
 * source, secret fence included, would score as mixed (the exact "one English paragraph,
 * one Italian paragraph" case `@canonry/lang`'s own tests document as undecidable) or even
 * flip to the secret's language if that block happens to be longer. Either way, computing
 * from the raw body would make the public `lang` attribute a function of text the reader
 * never sees - a side channel `stripSecretsForPlayers` was supposed to close.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, revealEntityLive, type Db } from '@canonry/db';
import { entity, universe, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPublicEntity, type PublicEntityPageData } from './players.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

// Long enough, and lexically unambiguous enough, to clear @canonry/lang's own MIN_WORDS/
// MIN_HITS/MIN_MARGIN thresholds on its own - see packages/lang/src/detect.ts.
const ENGLISH_BODY =
	'Dismissed from the watch in the thaw after the Sable Winter, he now answers to the ' +
	'Ashen Ledger. The captain who trained him still will not say his name at the table, ' +
	'and the debt he carries is the reason nobody in the Lantern Quarter will lend to him.';
const ITALIAN_BODY =
	"L'oste della locanda non parla mai dei debiti che il conte ha con lui, ma ogni sera " +
	'conta le monete due volte prima di chiudere la cassa, come se qualcuno stesse per ' +
	'tornare a chiedere indietro quello che gli è dovuto.';
const ITALIAN_SECRET =
	"Il vero motivo del suo silenzio è che l'oste stesso ha rubato la metà di quella " +
	'somma, e la nasconde sotto una tavola del pavimento nella cantina della locanda.';

describe('loadPublicEntity language detection (#127)', () => {
	let db: Db;
	let universeId: string;
	let ownerUserId: string;
	let sessionEntityId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });
		const userId = unique('players-lang-user');
		const [owner] = await db
			.insert(user)
			.values({ id: userId, name: 'Language Test Owner', email: `${userId}@example.test` })
			.returning();
		if (!owner) throw new Error('user insert did not return a row');
		ownerUserId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Language Test Universe',
				slug: unique('players-lang-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;

		const [session] = await db
			.insert(entity)
			.values({ universeId, type: 'session', name: 'Session 1', slug: unique('session') })
			.returning({ id: entity.id });
		if (!session) throw new Error('session entity insert did not return a row');
		sessionEntityId = session.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerUserId));
		await closeDb(db);
	});

	async function revealedEntity(body: string): Promise<PublicEntityPageData> {
		const slug = unique('entry');
		const [row] = await db
			.insert(entity)
			.values({ universeId, type: 'character', name: 'Test Entry', slug, body })
			.returning({ id: entity.id });
		if (!row) throw new Error('entity insert did not return a row');
		await revealEntityLive(db, { universeId, entityId: row.id, sessionEntityId });
		const result = await loadPublicEntity(db, universeId, slug);
		if (!result) throw new Error('loadPublicEntity returned nothing for a revealed entity');
		return result;
	}

	it('detects a confident English body', async () => {
		const { entity: e } = await revealedEntity(ENGLISH_BODY);
		if (e.status !== 'full') throw new Error('expected a full entity');
		expect(e.language).toBe('en');
	});

	it('detects a confident Italian body', async () => {
		const { entity: e } = await revealedEntity(ITALIAN_BODY);
		if (e.status !== 'full') throw new Error('expected a full entity');
		expect(e.language).toBe('it');
	});

	it('answers null for a short, proper-noun-only body rather than guessing', async () => {
		const { entity: e } = await revealedEntity('Aldric Vane. The Gilded Rat.');
		if (e.status !== 'full') throw new Error('expected a full entity');
		expect(e.language).toBeNull();
	});

	it('never lets a secret fence in another language leak into the public lang attribute', async () => {
		const body = [ENGLISH_BODY, '', ':::secret', ITALIAN_SECRET, ':::'].join('\n');
		const { entity: e } = await revealedEntity(body);
		if (e.status !== 'full') throw new Error('expected a full entity');

		// Positive control: the secret really is in the source, so a confident 'en' below is
		// the stripped-body detector at work, not an accident of the fixture being all-English.
		expect(body).toContain(ITALIAN_SECRET);
		expect(e.body).not.toContain(ITALIAN_SECRET);
		expect(e.body).not.toContain(':::secret');

		// The raw body mixes a full English paragraph with a full Italian one - exactly the
		// shape @canonry/lang's own tests document as undecidable (null) when detected whole.
		// The player-visible page must not inherit that undecidability: it never saw the
		// Italian half, so its language is unambiguously English.
		expect(e.language).toBe('en');
	});

	it('carries no language field at all for an undiscovered (gap) entity', async () => {
		const slug = unique('undiscovered');
		await db
			.insert(entity)
			.values({ universeId, type: 'place', name: 'Undiscovered Place', slug, body: ENGLISH_BODY });
		const result = await loadPublicEntity(db, universeId, slug);
		if (!result) throw new Error('loadPublicEntity returned nothing for a gap entity');
		expect(result.entity.status).toBe('gap');
		expect('language' in result.entity).toBe(false);
	});
});
