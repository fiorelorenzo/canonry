/**
 * #364's adversarial half, run against the real `GET` handler rather than against the query
 * under it. A preview is a second way to read an entry, so this is the same test `p/leak
 * .test.ts` is for the page, pointed at the endpoint the card fetches: a fixture universe
 * built to hold exactly what guardrail 6 forbids surfacing, and then an attempt to get it
 * out through a hover.
 *
 * Three things it pins down, each of which a plausible future refactor breaks silently:
 *
 * - A `gm_only` entry answers identically to a slug that never existed, status and message
 *   both, so the response carries no signal that it is there. The tempting change here is a
 *   "clearer" 403 for the gm_only case.
 * - A gap entry answers with name and type and nothing else (E7), never its unrevealed body.
 * - The excerpt of a revealed entry never carries a fenced sentence or a fence marker. The
 *   tempting change is `body.slice(0, 200)`, which is faster and passes nothing here.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, revealEntityLive, type Db } from '@canonry/db';
import { entity, universe, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// `$lib/server/db.ts`'s `db()` singleton, which the handler under test calls, reads
// `env.DATABASE_URL` with no fallback of its own - same convention as `p/leak.test.ts`.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const PUBLIC_OPENING = 'A merchant bank that lends at knife point.';
const SECRET_TEXT = 'Aldric Vane, the dismissed captain, is on the Ledger payroll in secret.';
const GMNOTE_TEXT = 'GM only: play this reveal as her fault circling back.';
const GM_ONLY_NAME = 'The Umbral Concord';
const GM_ONLY_BODY = 'A body nobody but the table owner should ever read.';
const UNDISCOVERED_NAME = 'The Quiet Cabal';
const UNDISCOVERED_BODY = 'Nobody at the table has found this one yet.';

const FENCED_BODY = [
	PUBLIC_OPENING,
	'',
	':::secret',
	SECRET_TEXT,
	':::',
	'',
	':::gmnote',
	GMNOTE_TEXT,
	':::'
].join('\n');

interface HttpFailure {
	status: number;
	message: string;
}

/** The handler `error()`s rather than returning a response, so a plain await would hand the
 * exception to the runner. Returns the status and the message text, because "the same 404"
 * has to mean both. */
async function failureOf(promise: Promise<Response>): Promise<HttpFailure> {
	try {
		await promise;
	} catch (err) {
		if (isHttpError(err)) return { status: err.status, message: err.body.message };
		throw err;
	}
	throw new Error('expected the request to throw an HTTP error, but it returned a response');
}

describe('GET /p/[universe]/preview/[slug] (#364)', () => {
	let db: Db;
	let universeRow: { id: string; ownerUserId: string; slug: string };
	let revealedSlug: string;
	let gmOnlySlug: string;
	let undiscoveredSlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const userId = unique('preview-gate-user');
		const [owner] = await db
			.insert(user)
			.values({ id: userId, name: 'Preview Gate Owner', email: `${userId}@example.test` })
			.returning();
		if (!owner) throw new Error('user insert did not return a row');

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Preview Gate Universe',
				slug: unique('preview-gate-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeRow = uni;

		const [session] = await db
			.insert(entity)
			.values({ universeId: uni.id, type: 'session', name: 'Session 1', slug: unique('session') })
			.returning();

		const [revealed, gmOnly, undiscovered] = await db
			.insert(entity)
			.values([
				{
					universeId: uni.id,
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: unique('ledger'),
					body: FENCED_BODY
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
					body: UNDISCOVERED_BODY
				}
			])
			.returning({ id: entity.id, slug: entity.slug });
		if (!session || !revealed || !gmOnly || !undiscovered)
			throw new Error('fixture entity insert failed');
		revealedSlug = revealed.slug;
		gmOnlySlug = gmOnly.slug;
		undiscoveredSlug = undiscovered.slug;

		await revealEntityLive(db, {
			universeId: uni.id,
			entityId: revealed.id,
			sessionEntityId: session.id
		});
		// Defense in depth, the same shape `p/leak.test.ts` uses: reveal the gm_only entity
		// too, simulating the bug the schema comment says can never be allowed to matter. It
		// must still be unreachable.
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

	function request(slug: string, universeSlug = universeRow.slug): Promise<Response> {
		return Promise.resolve(
			GET({ params: { universe: universeSlug, slug } } as Parameters<typeof GET>[0])
		);
	}

	it('previews a revealed entry with its name, its type and the opening of its prose', async () => {
		const payload = await (await request(revealedSlug)).json();
		expect(payload).toEqual({
			name: 'The Ashen Ledger',
			type: 'faction',
			status: 'full',
			excerpt: PUBLIC_OPENING
		});
	});

	it('never carries a fenced sentence or a fence marker into the preview', async () => {
		const body = await (await request(revealedSlug)).text();
		expect(body).not.toContain(SECRET_TEXT);
		expect(body).not.toContain(GMNOTE_TEXT);
		expect(body).not.toContain(':::');
		expect(body).not.toContain('Aldric Vane');
	});

	it('answers a gm_only entry exactly as it answers a slug that never existed', async () => {
		const hidden = await failureOf(request(gmOnlySlug));
		const absent = await failureOf(request('a-slug-nobody-ever-created'));
		// The message echoes the slug the requester just typed and carries nothing else, so
		// the two responses are the same response with that one substitution. Comparing them
		// with the slug taken back out is what "indistinguishable" actually means here: a
		// clearer 403 for the gm_only case, or a message naming the entry, fails this.
		const shapeOf = (failure: HttpFailure, slug: string) => ({
			status: failure.status,
			message: failure.message.replaceAll(slug, '<the slug that was asked for>')
		});
		expect(shapeOf(hidden, gmOnlySlug)).toEqual(shapeOf(absent, 'a-slug-nobody-ever-created'));
		expect(hidden.status).toBe(404);
		expect(hidden.message).not.toContain(GM_ONLY_NAME);
		expect(hidden.message).not.toContain(GM_ONLY_BODY);
	});

	it('gives a gap entry E7s shape and never its unrevealed prose', async () => {
		const response = await request(undiscoveredSlug);
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({
			name: UNDISCOVERED_NAME,
			type: 'faction',
			status: 'gap',
			excerpt: ''
		});
		expect(text).not.toContain(UNDISCOVERED_BODY);
	});

	it('404s for a universe nobody has', async () => {
		const failure = await failureOf(request(revealedSlug, 'no-such-universe-anywhere'));
		expect(failure.status).toBe(404);
	});
});
