/**
 * Issue #85, guardrail 6: nothing unreviewed is ever published to players. This is the
 * test the issue asks for - it tries to leak, on purpose, against a fixture universe built
 * to contain exactly the things guardrail 6 forbids surfacing: an unrevealed fact, an
 * unrevealed relation, a secret block, a GM note, an unpublished generated image, a
 * `gm_only` entry (with a revelation row on it anyway, simulating the bug the schema
 * comment in `entity.ts` says can never be allowed to matter), and since #306 three
 * confirmed facts whose evidence span reaches into one of those fences.
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
	setEntityCover,
	type Db
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
import type { PlayerDiaryData, PublicEntityPageData, PublicUniverse } from '$lib/server/players';
import type { MentionPreviewData } from '$lib/mentionPreview';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { load as loadLayout } from './[universe]/+layout.server.js';
import { load as loadIndex } from './[universe]/+page.server.js';
import { load as loadEntity } from './[universe]/[slug]/+page.server.js';
import { GET as getPreview } from './[universe]/preview/[slug]/+server.js';

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
// #530: the campaign diary adds a session's own body as a new player-visible surface, so
// it needs its own fenced secret and GM note - the seeded world's own text (verbatim from
// `packages/db/src/seed-fixture.ts`'s Ashen Ledger secret), because that is the exact
// string this round's guardrail 6 note names.
const SEEDED_WORLD_SECRET =
	"Aldric Vane, the dismissed captain of the Valdoria Watch, is now on the Ashen Ledger's payroll.";
const SESSION_GMNOTE_TEXT =
	'GM only: the harbourmaster already knows and is stalling the watch on purpose.';
// Positive control for the session body filter: real, safe prose that must survive
// stripping right beside the fences that must not.
const SESSION_SAFE_PROSE = 'The party gathered at the harbour to plan the next move.';
// A session nobody has revealed at all - no self-reveal, and nothing revealed inside it -
// must not appear in the diary, not its name and not a word of its prose (E7 applied to a
// session rather than suspended for one).
const UNREVEALED_SESSION_NAME = 'The Off-Book Session';
const UNREVEALED_SESSION_PROSE =
	'A session nobody at the table has heard of yet, played entirely off the books.';
// A fact can be confirmed without its own subject entity ever being independently
// revealed (this file's own fixture already proves that gap exists); the diary must drop
// the fact rather than let it name the still-undiscovered subject.
const UNDISCOVERED_ENTITY_FACT_STATEMENT =
	'The Quiet Cabal keeps its ledgers in a false-bottomed drawer nobody has found.';

// `UNREVEALED_SESSION_NAME` is deliberately not in this list: `publicMentionTargets`
// legitimately carries every non-`gm_only` entity's name and slug, sessions included, the
// same way it already carries `UNDISCOVERED_NAME` on every other route in this file - a
// mention inside revealed prose has to resolve to *something*, gap or full. What must
// never happen is the session appearing in the diary's own enumeration, checked directly
// against `result.sessions` below, not against the whole payload.
const BANNED_NEEDLES = [
	SECRET_TEXT,
	GMNOTE_TEXT,
	UNREVEALED_FACT_STATEMENT,
	GM_ONLY_NAME,
	GM_ONLY_BODY,
	UNPUBLISHED_IMAGE_PROMPT,
	UNPUBLISHED_IMAGE_PATH,
	SEEDED_WORLD_SECRET,
	SESSION_GMNOTE_TEXT,
	UNREVEALED_SESSION_PROSE,
	UNDISCOVERED_ENTITY_FACT_STATEMENT
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
	let sessionEntity: { id: string; slug: string };
	let unrevealedSessionEntity: { id: string; slug: string };
	let revealedEntity: { id: string; slug: string };
	let gmOnlyEntity: { id: string; slug: string };
	let undiscoveredEntity: { id: string; slug: string };
	let fencedFactIds: string[] = [];

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

		const sessionBody = [
			SESSION_SAFE_PROSE,
			'',
			':::secret',
			SEEDED_WORLD_SECRET,
			':::',
			'',
			':::gmnote',
			SESSION_GMNOTE_TEXT,
			':::'
		].join('\n');
		const [session] = await db
			.insert(entity)
			.values({
				universeId: uni.id,
				type: 'session',
				name: 'Session 1',
				slug: unique('session'),
				body: sessionBody
			})
			.returning();

		// #530: never revealed at all, not even a self-reveal, and nothing points to it as
		// the session a revelation happened in - the diary must not enumerate it and must
		// not leak a word of its prose.
		const [unrevealedSession] = await db
			.insert(entity)
			.values({
				universeId: uni.id,
				type: 'session',
				name: UNREVEALED_SESSION_NAME,
				slug: unique('off-book-session'),
				body: UNREVEALED_SESSION_PROSE
			})
			.returning();
		if (!unrevealedSession) throw new Error('unrevealed session insert did not return a row');

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
		sessionEntity = session;
		unrevealedSessionEntity = unrevealedSession;

		// Facts on the revealed entity. One confirmed and safely outside every fence (must
		// appear), one never revealed (must never appear), and three confirmed ones whose
		// evidence span touches a fence (#306: each must be withheld whole, statement
		// included, even though the GM did confirm the revelation).
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
		// #306. A span is a pair of offsets into `body` above and knows nothing about what it
		// landed in, so these are the three shapes that used to publish fenced text: inside
		// the secret, inside the GM note, and straddling the opening marker. Their statements
		// are the fenced sentence itself, which is what a fact extracted from that sentence
		// carries in practice, and the reason withholding only the excerpt would still leak.
		const secretStart = body.indexOf(SECRET_TEXT);
		const gmnoteStart = body.indexOf(GMNOTE_TEXT);
		if (secretStart < 0 || gmnoteStart < 0) throw new Error('fixture body lost its fences');
		const fencedFacts = await db
			.insert(fact)
			.values([
				{
					universeId: uni.id,
					entityId: revealed.id,
					statement: SECRET_TEXT,
					sourceRevisionId: rev.id,
					spanStart: secretStart,
					spanEnd: secretStart + SECRET_TEXT.length,
					authorKind: 'human'
				},
				{
					universeId: uni.id,
					entityId: revealed.id,
					statement: GMNOTE_TEXT,
					sourceRevisionId: rev.id,
					spanStart: gmnoteStart,
					spanEnd: gmnoteStart + GMNOTE_TEXT.length,
					authorKind: 'human'
				},
				{
					universeId: uni.id,
					entityId: revealed.id,
					statement: 'A fact whose evidence starts in public prose and ends in a secret.',
					sourceRevisionId: rev.id,
					spanStart: 0,
					spanEnd: secretStart + SECRET_TEXT.length,
					authorKind: 'human'
				}
			])
			.returning({ id: fact.id });
		if (!revealedFact || !unrevealedFact || fencedFacts.length !== 3)
			throw new Error('fact insert failed');
		fencedFactIds = fencedFacts.map((f) => f.id);

		// #530: a fact can be confirmed without its own subject entity ever being
		// independently revealed (`unrevealedFact` above proves the reverse gap already);
		// this is that same gap from the entity's side, and it has to survive the new
		// per-session "what was learned" list too.
		const [undiscoveredRevision] = await db
			.insert(revision)
			.values({
				universeId: uni.id,
				entityId: undiscovered.id,
				authorKind: 'human',
				name: UNDISCOVERED_NAME,
				body: 'Nobody has found this yet.'
			})
			.returning();
		if (!undiscoveredRevision) throw new Error('undiscovered revision insert failed');
		const [undiscoveredFact] = await db
			.insert(fact)
			.values({
				universeId: uni.id,
				entityId: undiscovered.id,
				statement: UNDISCOVERED_ENTITY_FACT_STATEMENT,
				sourceRevisionId: undiscoveredRevision.id,
				spanStart: 0,
				spanEnd: 10,
				authorKind: 'human'
			})
			.returning();
		if (!undiscoveredFact) throw new Error('undiscovered fact insert failed');
		await revealFactLive(db, {
			universeId: uni.id,
			factId: undiscoveredFact.id,
			sessionEntityId: session.id
		});

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

		// An image marked gm_only, plus an attached-but-visible one for contrast (#382:
		// attaching is the accept, so the second needs no explicit action to become
		// visible once the entity is revealed below).
		await db.insert(mediaAsset).values([
			{
				universeId: uni.id,
				entityId: revealed.id,
				kind: 'image',
				path: UNPUBLISHED_IMAGE_PATH,
				mimeType: 'image/png',
				generated: true,
				gmOnly: true,
				prompt: UNPUBLISHED_IMAGE_PROMPT
			},
			{
				universeId: uni.id,
				entityId: revealed.id,
				kind: 'image',
				path: '/media/published-portrait.png',
				mimeType: 'image/png',
				generated: true
				// gmOnly stays at its default false - visible once revealed below.
			}
		]);

		// Reveal the entity, the one safe fact, and every fenced fact (#306: a confirmed
		// revelation is exactly the state the defect needed, so the test has to be in it).
		// Then, defense in depth: reveal the gm_only entity too, simulating a bug - it must
		// still never surface.
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
		for (const factId of fencedFactIds) {
			await revealFactLive(db, { universeId: uni.id, factId, sessionEntityId: session.id });
		}
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

	it('the diary route lists only the session the party has met, its prose filtered like any entry, and never a name or fact the party has not earned (#530, V7, DECISIONS.md)', async () => {
		const layoutData = await loadUniverseLayout();
		const raw = await loadIndex({ parent: async () => layoutData } as Parameters<
			typeof loadIndex
		>[0]);
		const result = raw as PlayerDiaryData;
		assertNoLeak(result);

		// The met session is here; the never-revealed one is not - not its id, not its
		// name, not a word of its prose. Checked against `result.sessions` specifically
		// (never against the whole payload, which legitimately carries the session's name
		// and slug in `mentionTargets` - see this file's own comment on `BANNED_NEEDLES`
		// above), because the diary's own enumeration is what E7's rule actually governs.
		const sessionIds = result.sessions.map((s) => s.id);
		expect(sessionIds).toContain(sessionEntity.id);
		expect(sessionIds).not.toContain(unrevealedSessionEntity.id);
		const sessionsJson = JSON.stringify(result.sessions);
		expect(sessionsJson).not.toContain(unrevealedSessionEntity.slug);
		expect(sessionsJson).not.toContain(UNREVEALED_SESSION_NAME);

		const session = result.sessions.find((s) => s.id === sessionEntity.id);
		if (!session) throw new Error('expected the met session in the diary');

		// Positive control: the session's own safe prose really is there, so the fences'
		// absence below is a real filter, not an empty response.
		expect(session.body).toContain(SESSION_SAFE_PROSE);
		// Guardrail 6's own note for this round: a session's body is canon prose, so its
		// `:::secret`/`:::gmnote` fences go through the same filter an entry's does -
		// neither the seeded world's own payroll secret nor the session's GM note, and
		// not the fence markers themselves.
		expect(session.body).not.toContain(SEEDED_WORLD_SECRET);
		expect(session.body).not.toContain(SESSION_GMNOTE_TEXT);
		expect(session.body).not.toContain(':::secret');
		expect(session.body).not.toContain(':::gmnote');

		// What the party learned: the revealed entity and its one safe fact are there...
		const entityRefs = session.revelations.filter((r) => r.kind === 'entity');
		expect(entityRefs.map((r) => r.entity.slug)).toContain(revealedEntity.slug);
		const factRefs = session.revelations.filter((r) => r.kind === 'fact');
		expect(factRefs.map((r) => r.label)).toContain('The Ashen Ledger lends at knife point.');

		// ...the gm_only entity's revelation never surfaces, simulated bug and all...
		expect(entityRefs.map((r) => r.entity.slug)).not.toContain(gmOnlyEntity.slug);
		// ...none of the three fenced facts on the revealed entity surface either, even
		// though every one of them carries a confirmed revelation (#306, same rule as the
		// entity page), and neither does the fact revealed on the still-undiscovered
		// entity - five confirmed fact revelations point at this session, and exactly one
		// of them, the safe one, is player-safe to name.
		expect(factRefs).toHaveLength(1);
		expect(factRefs.map((r) => r.label)).not.toContain(UNDISCOVERED_ENTITY_FACT_STATEMENT);
		expect(entityRefs.map((r) => r.entity.slug)).not.toContain(undiscoveredEntity.slug);
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

	it('a confirmed fact whose evidence span sits in a secret or GM-note fence is not in what the entry page serves (#306)', async () => {
		const layoutData = await loadUniverseLayout();
		const raw = await loadEntity({
			params: { universe: universeRow.slug, slug: revealedEntity.slug },
			parent: async () => layoutData
		} as Parameters<typeof loadEntity>[0]);
		const result = raw as PublicEntityPageData;
		if (result.entity.status !== 'full') throw new Error('expected a full entity');

		// All three fenced facts carry a confirmed revelation, so the only thing keeping them
		// off this page is the span filter. Withheld whole: no id to key a list item off, no
		// statement, no excerpt.
		const served = result.entity.facts.map((f) => f.id);
		for (const factId of fencedFactIds) expect(served).not.toContain(factId);
		expect(result.entity.facts).toHaveLength(1);
		expect(result.entity.facts[0]?.sourceExcerpt).toBe('A merchant');

		// The payload, which is what SvelteKit serialises into the HTML: neither the fenced
		// sentences nor the markers themselves, in an excerpt or in a statement.
		const payload = JSON.stringify(result);
		expect(payload).not.toContain(SECRET_TEXT);
		expect(payload).not.toContain(GMNOTE_TEXT);
		expect(payload).not.toContain(':::secret');
		expect(payload).not.toContain(':::gmnote');
		expect(payload).not.toContain('now on the Ledger payroll');
	});

	it('an attached, not-gm_only image on an unrevealed entry stays out of the payload - the entry still has to be revealed too (#382)', async () => {
		// The other half of "attaching is the accept": attaching alone is not enough, the
		// entry itself still has to be revealed. undiscoveredEntity above is never
		// revealed - it renders as E7's gap page - so an image attached to it, gmOnly
		// false and all, must still never surface.
		const GAP_ENTITY_IMAGE_PATH = '/media/gap-entity-leak-test-portrait.png';
		const [unattached] = await db
			.insert(mediaAsset)
			.values({
				universeId: universeRow.id,
				kind: 'image',
				path: GAP_ENTITY_IMAGE_PATH,
				mimeType: 'image/png',
				generated: true,
				prompt: 'gap entity leak test portrait, never shown to players'
			})
			.returning();
		if (!unattached) throw new Error('media asset insert did not return a row');

		const attached = await attachMediaAsset(db, unattached.id, undiscoveredEntity.id);
		expect(attached.gmOnly).toBe(false);

		const layoutData = await loadUniverseLayout();
		const raw = await loadEntity({
			params: { universe: universeRow.slug, slug: undiscoveredEntity.slug },
			parent: async () => layoutData
		} as Parameters<typeof loadEntity>[0]);
		const result = raw as PublicEntityPageData;

		assertNoLeak(result);
		expect(result.entity).toEqual({ status: 'gap', name: UNDISCOVERED_NAME, type: 'faction' });
		const payload = JSON.stringify(result);
		expect(payload).not.toContain(attached.id);
		expect(payload).not.toContain(GAP_ENTITY_IMAGE_PATH);
	});

	it('a gm_only image attached to the revealed entity stays out of the payload too, even though the entity itself is fully visible (#382)', async () => {
		// The deliberate exception decision R7 keeps beside "attaching is the accept": a
		// GM can still hold one picture back on an otherwise fully revealed entry.
		const GM_ONLY_IMAGE_PATH = '/media/gm-only-leak-test-portrait.png';
		const [unattached] = await db
			.insert(mediaAsset)
			.values({
				universeId: universeRow.id,
				kind: 'image',
				path: GM_ONLY_IMAGE_PATH,
				mimeType: 'image/png',
				generated: true,
				gmOnly: true,
				prompt: 'gm only leak test portrait, never shown to players'
			})
			.returning();
		if (!unattached) throw new Error('media asset insert did not return a row');

		const attached = await attachMediaAsset(db, unattached.id, revealedEntity.id);
		expect(attached.gmOnly).toBe(true);

		const layoutData = await loadUniverseLayout();
		const raw = await loadEntity({
			params: { universe: universeRow.slug, slug: revealedEntity.slug },
			parent: async () => layoutData
		} as Parameters<typeof loadEntity>[0]);
		const result = raw as PublicEntityPageData;
		if (result.entity.status !== 'full') throw new Error('expected a full entity');

		expect(result.entity.images.map((img) => img.id)).not.toContain(attached.id);
		const payload = JSON.stringify(result);
		expect(payload).not.toContain(attached.id);
		expect(payload).not.toContain(GM_ONLY_IMAGE_PATH);
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

	function requestPreview(slug: string): Promise<Response> {
		return Promise.resolve(
			getPreview({ params: { universe: universeRow.slug, slug } } as Parameters<
				typeof getPreview
			>[0])
		);
	}

	it("the preview endpoint carries a revealed entry's published cover (S6, #411)", async () => {
		const PREVIEW_COVER_PATH = '/media/preview-cover-leak-test.png';
		const [unattached] = await db
			.insert(mediaAsset)
			.values({
				universeId: universeRow.id,
				kind: 'image',
				path: PREVIEW_COVER_PATH,
				mimeType: 'image/png',
				generated: true
			})
			.returning();
		if (!unattached) throw new Error('media asset insert did not return a row');
		const attached = await attachMediaAsset(db, unattached.id, revealedEntity.id);
		await setEntityCover(db, { entityId: revealedEntity.id, mediaAssetId: attached.id });

		const payload = (await (
			await requestPreview(revealedEntity.slug)
		).json()) as MentionPreviewData;
		assertNoLeak(payload);
		expect(payload.coverId).toBe(attached.id);
	});

	it('the preview endpoint never carries a cover for an entity nobody has discovered yet, even when one is attached and set as its cover (S6, #411)', async () => {
		const GAP_COVER_PATH = '/media/gap-entity-preview-cover-leak-test.png';
		const [unattached] = await db
			.insert(mediaAsset)
			.values({
				universeId: universeRow.id,
				kind: 'image',
				path: GAP_COVER_PATH,
				mimeType: 'image/png',
				generated: true
			})
			.returning();
		if (!unattached) throw new Error('media asset insert did not return a row');
		const attached = await attachMediaAsset(db, unattached.id, undiscoveredEntity.id);
		await setEntityCover(db, { entityId: undiscoveredEntity.id, mediaAssetId: attached.id });

		const response = await requestPreview(undiscoveredEntity.slug);
		const payload = await response.json();
		assertNoLeak(payload);
		expect(payload).toEqual({
			name: UNDISCOVERED_NAME,
			type: 'faction',
			status: 'gap',
			excerpt: ''
		});
		const text = JSON.stringify(payload);
		expect(text).not.toContain(attached.id);
		expect(text).not.toContain(GAP_COVER_PATH);
	});

	it('the preview endpoint never carries a gm_only cover, even on a fully revealed entity (S6, #411, R7/#382)', async () => {
		const GM_ONLY_COVER_PATH = '/media/gm-only-preview-cover-leak-test.png';
		const [unattached] = await db
			.insert(mediaAsset)
			.values({
				universeId: universeRow.id,
				kind: 'image',
				path: GM_ONLY_COVER_PATH,
				mimeType: 'image/png',
				generated: true,
				gmOnly: true
			})
			.returning();
		if (!unattached) throw new Error('media asset insert did not return a row');
		const attached = await attachMediaAsset(db, unattached.id, revealedEntity.id);
		expect(attached.gmOnly).toBe(true);
		await setEntityCover(db, { entityId: revealedEntity.id, mediaAssetId: attached.id });

		const payload = (await (
			await requestPreview(revealedEntity.slug)
		).json()) as MentionPreviewData;
		assertNoLeak(payload);
		expect(payload.status).toBe('full');
		expect(payload.coverId).toBeUndefined();
		const text = JSON.stringify(payload);
		expect(text).not.toContain(attached.id);
		expect(text).not.toContain(GM_ONLY_COVER_PATH);
	});
});
