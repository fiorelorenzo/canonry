/**
 * Issue #85, guardrail 6: nothing unreviewed is ever published to players. This is the
 * test the issue asks for - it tries to leak, on purpose, against a fixture universe built
 * to contain exactly the things guardrail 6 forbids surfacing: an unrevealed fact, an
 * unrevealed relation, a secret block, a GM note, an unpublished generated image, and a
 * `gm_only` entry (with a revelation row on it anyway, simulating the bug the schema
 * comment in `entity.ts` says can never be allowed to matter).
 *
 * Runs against the real dev Postgres, same convention as `lib/server/export.test.ts`: its
 * own uniquely-slugged universe, cleaned up afterwards, never touching the seeded fixture
 * world. It calls the *actual* exported `load` functions from every `/p/**` route in this
 * directory - not a re-derivation of what they do - which is what makes this a route test
 * and not just a query test: a bug in the route wiring (forgetting to call the filter,
 * passing the wrong id) would fail here even if `@canonry/db`'s own query layer were
 * correct. The event objects below are cast rather than fully constructed: these `load`
 * functions destructure exactly `params` and `parent`, and SvelteKit's own generated
 * `PageServerLoad`/`LayoutServerLoad` alias types (see `./$types`) widen an explicitly
 * annotated exported `load`'s type for an importer regardless, so a real `RequestEvent`
 * would type-check no more precisely than this does.
 *
 * Every assertion below checks `JSON.stringify` of the exact object a `load` function
 * returns - what SvelteKit serialises into the page as `PageData` - because a check against
 * only the rendered HTML would miss a leak sitting in that payload untouched (see the E7
 * artifact's "rejected outright" section, and this issue's own body: "not merely hidden in
 * the UI").
 */
import { randomUUID } from 'node:crypto';
import {
	attachMediaAsset,
	closeDb,
	createDb,
	eq,
	revealEntityLive,
	revealFactLive,
	type Db,
	type RevealedEntityListItem
} from '@canonry/db';
import {
	entity,
	fact,
	mediaAsset,
	relation,
	relationType,
	revision,
	universe,
	user
} from '@canonry/db/schema';
import type { PublicEntityPageData, PublicUniverse } from '$lib/server/players';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { load as loadLayout } from './[universe]/+layout.server.js';
import { load as loadIndex } from './[universe]/+page.server.js';
import { load as loadEntity } from './[universe]/[slug]/+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// `$lib/server/db.ts`'s `db()` singleton, which every `+page.server.ts`/`+layout.server.ts`
// under test here calls, reads `env.DATABASE_URL` (SvelteKit's `$env/dynamic/private`, a
// live view over `process.env`) with no fallback of its own - unlike this file's own
// direct `createDb(DATABASE_URL, ...)` calls below, which already default to the local
// dev database. Setting it here, once, before any route `load` runs, is what makes this
// test pass under a plain `pnpm test` with no environment set up, exactly like every
// other integration test in this repo already assumes a local Postgres at 55432.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

// Every string that must never appear in a public response, whatever entity or route it
// travels through.
const SECRET_TEXT = 'Aldric Vane, the dismissed captain, is now on the Ledger payroll in secret.';
const GMNOTE_TEXT =
	'GM only: play this reveal as her fault circling back, never say this at the table.';
const UNREVEALED_FACT_STATEMENT = 'Aldric secretly sold the watch armoury manifest to the Ledger.';
const GM_ONLY_NAME = 'The Umbral Concord';
const GM_ONLY_BODY = 'GM-only body nobody but the table owner should ever read.';
const UNPUBLISHED_IMAGE_PROMPT = 'a forbidden portrait describing the true villain, never shown';
const UNPUBLISHED_IMAGE_PATH = '/media/unpublished-leak-test-portrait.png';
const UNDISCOVERED_NAME = 'The Quiet Cabal';

const BANNED_NEEDLES = [
	SECRET_TEXT,
	GMNOTE_TEXT,
	UNREVEALED_FACT_STATEMENT,
	GM_ONLY_NAME,
	GM_ONLY_BODY,
	UNPUBLISHED_IMAGE_PROMPT,
	UNPUBLISHED_IMAGE_PATH
];

function assertNoLeak(payload: unknown): void {
	const json = JSON.stringify(payload);
	for (const needle of BANNED_NEEDLES) {
		expect(json, `leaked "${needle}" into a public payload`).not.toContain(needle);
	}
}

describe('players wiki: leak test (#85)', () => {
	let db: Db;
	let universeRow: { id: string; ownerUserId: string; slug: string };
	let revealedEntity: { id: string; slug: string };
	let gmOnlyEntity: { id: string; slug: string };
	let undiscoveredEntity: { id: string; slug: string };

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const userId = unique('leak-test-user');
		const [owner] = await db
			.insert(user)
			.values({ id: userId, name: 'Leak Test Owner', email: `${userId}@example.test` })
			.returning();
		if (!owner) throw new Error('user insert did not return a row');

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Leak Test Universe',
				slug: unique('leak-test-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeRow = uni;

		const [session] = await db
			.insert(entity)
			.values({ universeId: uni.id, type: 'session', name: 'Session 1', slug: unique('session') })
			.returning();

		const body = [
			'A merchant bank that lends at knife point, holding most of the Lantern Quarter\u2019s debt.',
			'',
			':::secret',
			SECRET_TEXT,
			':::',
			'',
			':::gmnote',
			GMNOTE_TEXT,
			':::'
		].join('\n');

		const [revealed, gmOnly, undiscovered] = await db
			.insert(entity)
			.values([
				{
					universeId: uni.id,
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: unique('ledger'),
					body
				},
				{
					universeId: uni.id,
					type: 'faction',
					name: GM_ONLY_NAME,
					slug: unique('umbral-concord'),
					visibility: 'gm_only',
					body: GM_ONLY_BODY
				},
				{
					universeId: uni.id,
					type: 'faction',
					name: UNDISCOVERED_NAME,
					slug: unique('quiet-cabal'),
					body: 'Nobody has found this yet.'
				}
			])
			.returning({ id: entity.id, slug: entity.slug });
		if (!session || !revealed || !gmOnly || !undiscovered)
			throw new Error('fixture entity insert failed');
		revealedEntity = revealed;
		gmOnlyEntity = gmOnly;
		undiscoveredEntity = undiscovered;

		// Two facts on the revealed entity: one confirmed (must appear), one never revealed
		// (must never appear).
		const [rev] = await db
			.insert(revision)
			.values({
				universeId: uni.id,
				entityId: revealed.id,
				authorKind: 'human',
				name: 'The Ashen Ledger',
				body
			})
			.returning();
		if (!rev) throw new Error('revision insert failed');
		const [revealedFact] = await db
			.insert(fact)
			.values({
				universeId: uni.id,
				entityId: revealed.id,
				statement: 'The Ashen Ledger lends at knife point.',
				sourceRevisionId: rev.id,
				spanStart: 0,
				spanEnd: 10,
				authorKind: 'human'
			})
			.returning();
		const [unrevealedFact] = await db
			.insert(fact)
			.values({
				universeId: uni.id,
				entityId: revealed.id,
				statement: UNREVEALED_FACT_STATEMENT,
				sourceRevisionId: rev.id,
				spanStart: 0,
				spanEnd: 10,
				authorKind: 'human'
			})
			.returning();
		if (!revealedFact || !unrevealedFact) throw new Error('fact insert failed');

		// An unrevealed relation from the revealed entity to the gm_only one - must never
		// surface the gm_only entity's name through the relations list.
		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: uni.id,
				label: 'controls',
				inverseLabel: 'controlled by',
				cardinality: 'many_to_many',
				allowedFrom: ['faction'],
				allowedTo: ['faction']
			})
			.returning();
		if (!rt) throw new Error('relation type insert failed');
		await db.insert(relation).values({
			universeId: uni.id,
			relationTypeId: rt.id,
			fromEntityId: revealed.id,
			toEntityId: gmOnly.id,
			authorKind: 'human'
		});

		// An unpublished generated image, plus a published one for contrast.
		await db.insert(mediaAsset).values([
			{
				universeId: uni.id,
				entityId: revealed.id,
				kind: 'image',
				path: UNPUBLISHED_IMAGE_PATH,
				mimeType: 'image/png',
				generated: true,
				publishedToPlayers: false,
				prompt: UNPUBLISHED_IMAGE_PROMPT
			},
			{
				universeId: uni.id,
				entityId: revealed.id,
				kind: 'image',
				path: '/media/published-portrait.png',
				mimeType: 'image/png',
				generated: true,
				publishedToPlayers: true
			}
		]);

		// Reveal the entity and exactly one fact. Then, defense in depth: reveal the
		// gm_only entity too, simulating a bug - it must still never surface.
		await revealEntityLive(db, {
			universeId: uni.id,
			entityId: revealed.id,
			sessionEntityId: session.id
		});
		await revealFactLive(db, {
			universeId: uni.id,
			factId: revealedFact.id,
			sessionEntityId: session.id
		});
		await revealEntityLive(db, {
			universeId: uni.id,
			entityId: gmOnly.id,
			sessionEntityId: session.id
		});
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeRow.id));
		await db.delete(user).where(eq(user.id, universeRow.ownerUserId));
		await closeDb(db);
	});

	async function loadUniverseLayout(): Promise<{ universe: PublicUniverse }> {
		const result = await loadLayout({
			params: { universe: universeRow.slug }
		} as Parameters<typeof loadLayout>[0]);
		return result as { universe: PublicUniverse };
	}

	it('the universe layout payload never carries owner, billing, or AI settings', async () => {
		const result = await loadUniverseLayout();
		assertNoLeak(result);
		expect(result.universe).toEqual({
			id: universeRow.id,
			name: 'Leak Test Universe',
			slug: universeRow.slug
		});
	});

	it('the index route never leaks the gm_only entity, and lists the rest correctly', async () => {
		const layoutData = await loadUniverseLayout();
		const raw = await loadIndex({ parent: async () => layoutData } as Parameters<
			typeof loadIndex
		>[0]);
		const result = raw as { entities: RevealedEntityListItem[] };
		assertNoLeak(result);

		const ids = result.entities.map((e) => e.id);
		expect(ids).not.toContain(gmOnlyEntity.id);
		expect(ids).toContain(revealedEntity.id);
		expect(ids).toContain(undiscoveredEntity.id);

		const undiscoveredRow = result.entities.find((e) => e.id === undiscoveredEntity.id);
		expect(undiscoveredRow?.status).toBe('gap');
	});

	it('the revealed entity route serves the confirmed fact, never the unrevealed one, and no secret or GM note', async () => {
		const layoutData = await loadUniverseLayout();
		const raw = await loadEntity({
			params: { universe: universeRow.slug, slug: revealedEntity.slug },
			parent: async () => layoutData
		} as Parameters<typeof loadEntity>[0]);
		const result = raw as PublicEntityPageData;

		assertNoLeak(result);
		if (result.entity.status !== 'full') throw new Error('expected a full entity');

		// Positive control: the confirmed fact and the public prose really are there, so
		// the absence of the banned needles above is a real filter, not an empty response.
		expect(result.entity.body).toContain('A merchant bank that lends at knife point');
		expect(result.entity.facts.map((f) => f.statement)).toContain(
			'The Ashen Ledger lends at knife point.'
		);
		expect(result.entity.facts.map((f) => f.statement)).not.toContain(UNREVEALED_FACT_STATEMENT);

		// The unrevealed relation to the gm_only entity is structurally absent, not merely
		// unlabelled.
		expect(result.entity.relations.some((r) => r.other.id === gmOnlyEntity.id)).toBe(false);
		expect(result.entity.relations).toEqual([]);

		// Only the published image is present.
		expect(result.entity.images).toHaveLength(1);

		// The fence markers themselves must not survive either - not just their content.
		expect(result.entity.body).not.toContain(':::secret');
		expect(result.entity.body).not.toContain(':::gmnote');
	});

	it('a media asset attached to the revealed entity after the fact still never appears to players, in the payload or the markup (#71 surface guardrail)', async () => {
		// Mirrors the real "Insert" step of the F1 = C dialog: generateImages always
		// creates an unattached row (entity_id null - see packages/media/src/generate.ts's
		// own guardrail comment), and attachMediaAsset - the exact function
		// apps/web/src/routes/u/[universe]/e/[slug]/media/attach/+server.ts calls - is the
		// only thing that ever sets entity_id. Neither one ever touches
		// published_to_players; packages/media's own generate.test.ts already proves that
		// at the row level, so this test proves the other half: the players' route
		// (queries/players.ts's publishedToPlayers filter, exercised through the real
		// loadEntity, not a re-derivation of it) never surfaces this asset either.
		const SURFACE_GUARD_IMAGE_PATH = '/media/surface-guard-test-portrait.png';
		const [unattached] = await db
			.insert(mediaAsset)
			.values({
				universeId: universeRow.id,
				kind: 'image',
				path: SURFACE_GUARD_IMAGE_PATH,
				mimeType: 'image/png',
				generated: true,
				prompt: 'surface guardrail test portrait, never shown to players'
			})
			.returning();
		if (!unattached) throw new Error('media asset insert did not return a row');
		expect(unattached.entityId).toBeNull();
		expect(unattached.publishedToPlayers).toBe(false);

		const attached = await attachMediaAsset(db, unattached.id, revealedEntity.id);
		expect(attached.publishedToPlayers).toBe(false);

		const layoutData = await loadUniverseLayout();
		const raw = await loadEntity({
			params: { universe: universeRow.slug, slug: revealedEntity.slug },
			parent: async () => layoutData
		} as Parameters<typeof loadEntity>[0]);
		const result = raw as PublicEntityPageData;
		if (result.entity.status !== 'full') throw new Error('expected a full entity');

		// In the payload: the newly attached image is structurally absent from the
		// images array the page ships to the client - the exact field a gallery would
		// render an <img src> from - even though it is now attached to an entity that
		// is fully revealed.
		expect(result.entity.images.map((img) => img.id)).not.toContain(attached.id);

		// In the markup: nothing in the serialised page data - what SvelteKit turns
		// into rendered HTML - contains this asset's id or its storage path either,
		// the same JSON.stringify check this file's header explains and every other
		// assertion in this file relies on.
		const payload = JSON.stringify(result);
		expect(payload).not.toContain(attached.id);
		expect(payload).not.toContain(SURFACE_GUARD_IMAGE_PATH);

		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, attached.id));
		expect(row?.publishedToPlayers).toBe(false);
	});

	it('a gm_only entity 404s exactly like a slug that does not exist, even though it has a revelation row', async () => {
		const layoutData = await loadUniverseLayout();
		let caught: unknown;
		try {
			await loadEntity({
				params: { universe: universeRow.slug, slug: gmOnlyEntity.slug },
				parent: async () => layoutData
			} as Parameters<typeof loadEntity>[0]);
		} catch (err) {
			caught = err;
		}
		if (!isHttpError(caught)) throw new Error('expected a 404 HttpError');
		expect(caught.status).toBe(404);
		assertNoLeak(caught.body);
		expect(caught.body.message).not.toContain(GM_ONLY_NAME);

		let notFoundCaught: unknown;
		try {
			await loadEntity({
				params: { universe: universeRow.slug, slug: 'this-slug-was-never-created' },
				parent: async () => layoutData
			} as Parameters<typeof loadEntity>[0]);
		} catch (err) {
			notFoundCaught = err;
		}
		if (!isHttpError(notFoundCaught)) throw new Error('expected a 404 HttpError');
		// Same status and same message shape for "never existed" and "is gm_only" - a
		// player cannot tell the two apart from the response.
		expect(notFoundCaught.status).toBe(caught.status);
	});

	it("the undiscovered entity renders E7's sparse gap shape: name and type, nothing else", async () => {
		const layoutData = await loadUniverseLayout();
		const raw = await loadEntity({
			params: { universe: universeRow.slug, slug: undiscoveredEntity.slug },
			parent: async () => layoutData
		} as Parameters<typeof loadEntity>[0]);
		const result = raw as PublicEntityPageData;

		assertNoLeak(result);
		expect(result.entity).toEqual({ status: 'gap', name: UNDISCOVERED_NAME, type: 'faction' });
		expect(result.mentionTargets).toEqual([]);
	});
});
