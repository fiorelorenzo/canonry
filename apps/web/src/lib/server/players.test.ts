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
import {
	closeDb,
	createDb,
	eq,
	isPubliclyVisible,
	revealEntityLive,
	setMediaAssetPublished,
	type Db
} from '@canonry/db';
import { entity, mediaAsset, universe, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMarkdown } from '$lib/markdown';
import {
	loadPublicEntity,
	publicMentionTargetsFrom,
	type GmMentionTarget,
	type PublicEntityPageData
} from './players.js';

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

describe('publicMentionTargetsFrom (#220)', () => {
	// The GM route's own mention-target list: every entity in the universe, `visibility`
	// included, exactly what `/w/[universe]/e/[slug]/+page.server.ts`'s `universeEntities`
	// selects and this module's own `publicMentionTargetsFrom` filters before it ever
	// reaches `EntryProseWithSecrets.svelte`.
	const GM_TARGETS: GmMentionTarget[] = [
		{ name: 'Captain Reyes', slug: 'captain-reyes', aliases: [], visibility: 'revealable' },
		{ name: 'The Cinder Cabal', slug: 'the-cinder-cabal', aliases: [], visibility: 'gm_only' }
	];

	it('keeps a revealable target and drops a gm_only one, agreeing with isPubliclyVisible', () => {
		const filtered = publicMentionTargetsFrom(GM_TARGETS);
		expect(filtered.map((t) => t.slug)).toEqual(
			GM_TARGETS.filter((t) => isPubliclyVisible(t.visibility)).map((t) => t.slug)
		);
		expect(filtered.map((t) => t.slug)).toEqual(['captain-reyes']);
	});

	// Acceptance (#220): render the same body through both paths and compare. The real
	// `/p/` route only ever sees `publicMentionTargets`'s own result (`@canonry/db`) -
	// stood in for here by filtering `GM_TARGETS` with `isPubliclyVisible` directly, the
	// exact predicate that query's own WHERE clause is built from (see
	// `packages/db/test/players.test.ts`'s test that the real query agrees with it). The
	// GM's player preview calls this module's own `publicMentionTargetsFrom` - the same
	// function `+page.server.ts` calls before `EntryProseWithSecrets.svelte` ever sees the
	// data - on the unfiltered list. If the two ever disagreed, this fails.
	it('renders a gm_only mention exactly as the public route does: unresolved, no link', () => {
		const body = 'He reports to [[Captain Reyes]], who answers to [[The Cinder Cabal]] in secret.';
		const publicRouteTargets = GM_TARGETS.filter((t) => isPubliclyVisible(t.visibility)).map(
			({ name, slug, aliases }) => ({ name, slug, aliases })
		);
		const publicRouteHtml = renderMarkdown(body, 'valdoria-reach', publicRouteTargets, 'public');
		const previewHtml = renderMarkdown(
			body,
			'valdoria-reach',
			publicMentionTargetsFrom(GM_TARGETS),
			'public'
		);

		expect(previewHtml).toBe(publicRouteHtml);
		expect(previewHtml).toContain('class="mention mention-unresolved"');
		expect(previewHtml).not.toContain('/p/valdoria-reach/the-cinder-cabal');
		expect(previewHtml).toContain(
			'<a href="/p/valdoria-reach/captain-reyes" class="mention">Captain Reyes</a>'
		);

		// Without the filter (the bug #220 fixes): renderMarkdown's own doc comment says a
		// target present in `targets` at all is public by construction, so the unfiltered
		// GM list resolves the gm_only mention too.
		const unfilteredHtml = renderMarkdown(body, 'valdoria-reach', GM_TARGETS, 'public');
		expect(unfilteredHtml).toContain('/p/valdoria-reach/the-cinder-cabal');
		expect(unfilteredHtml).not.toBe(previewHtml);
	});
});
describe('loadPublicEntity language detection (#127)', () => {
	let db: Db;
	let universeId: string;
	let universeSlug: string;
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
		universeSlug = uni.slug;

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
		const result = await loadPublicEntity(db, universeId, universeSlug, slug);
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
		const result = await loadPublicEntity(db, universeId, universeSlug, slug);
		if (!result) throw new Error('loadPublicEntity returned nothing for a gap entity');
		expect(result.entity.status).toBe('gap');
		expect('language' in result.entity).toBe(false);
	});
});

describe('loadPublicEntity body image resolution (#254)', () => {
	let db: Db;
	let universeId: string;
	let universeSlug: string;
	let ownerUserId: string;
	let sessionEntityId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });
		const userId = unique('players-body-image-user');
		const [owner] = await db
			.insert(user)
			.values({ id: userId, name: 'Body Image Test Owner', email: `${userId}@example.test` })
			.returning();
		if (!owner) throw new Error('user insert did not return a row');
		ownerUserId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Body Image Test Universe',
				slug: unique('players-body-image-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;
		universeSlug = uni.slug;

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

	it('rewrites a published, visible image to the public route, and strips an unpublished one entirely - not a broken <img>, no leaked filename', async () => {
		const entrySlug = unique('entry-with-image');
		const [row] = await db
			.insert(entity)
			.values({ universeId, type: 'character', name: 'Body Image Entry', slug: entrySlug })
			.returning({ id: entity.id });
		if (!row) throw new Error('entity insert did not return a row');
		await revealEntityLive(db, { universeId, entityId: row.id, sessionEntityId });

		const [published] = await db
			.insert(mediaAsset)
			.values({
				universeId,
				entityId: row.id,
				kind: 'image',
				path: '/media/body-image-published.png',
				mimeType: 'image/png',
				generated: true,
				publishedToPlayers: false
			})
			.returning({ id: mediaAsset.id });
		if (!published) throw new Error('media asset insert did not return a row');
		await setMediaAssetPublished(db, published.id, true);

		const [unpublished] = await db
			.insert(mediaAsset)
			.values({
				universeId,
				entityId: row.id,
				kind: 'image',
				path: '/media/body-image-unpublished.png',
				mimeType: 'image/png',
				generated: true,
				publishedToPlayers: false
			})
			.returning({ id: mediaAsset.id });
		if (!unpublished) throw new Error('media asset insert did not return a row');

		const body =
			`Before the image.\n\n` +
			`![the published one](/w/${universeSlug}/e/${entrySlug}/media/${published.id})\n\n` +
			`![the unpublished one](/w/${universeSlug}/e/${entrySlug}/media/${unpublished.id})\n\n` +
			`After the image.`;
		await db.update(entity).set({ body }).where(eq(entity.id, row.id));

		const result = await loadPublicEntity(db, universeId, universeSlug, entrySlug);
		if (!result || result.entity.status !== 'full') throw new Error('expected a full entity');

		expect(result.entity.body).toContain(`/p/${universeSlug}/media/${published.id}`);
		expect(result.entity.body).not.toContain(`/w/${universeSlug}`);
		expect(result.entity.body).not.toContain(unpublished.id);
		expect(result.entity.body).not.toContain('the unpublished one');
		expect(result.entity.body).toContain('Before the image.');
		expect(result.entity.body).toContain('After the image.');
	});
});
