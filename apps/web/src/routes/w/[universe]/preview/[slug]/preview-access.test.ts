/**
 * #364, the GM endpoint. Two things worth a test and nothing else: it is gated like every
 * other route under `/w/[universe]` (no session and no membership both answer the same 404
 * as a universe that does not exist), and its excerpt goes through the same fence filter the
 * players' one does, even though the GM may read the fenced text on the page below.
 *
 * That last assertion is the one with a reason that is not obvious. A glance card is exactly
 * the surface somebody reads over a shoulder at a table, and more to the point one filter
 * with one code path for both surfaces means the players' side cannot be the one that
 * regresses on its own.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, universe, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const PUBLIC_OPENING = 'A merchant bank that lends at knife point.';
const SECRET_TEXT = 'Aldric Vane is on the Ledger payroll in secret.';
const GM_ONLY_NAME = 'The Umbral Concord';

describe('GET /w/[universe]/preview/[slug] (#364)', () => {
	let db: Db;
	let universeRow: { id: string; ownerUserId: string; slug: string };
	let strangerId: string;
	let entrySlug: string;
	let gmOnlySlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerId = unique('preview-access-owner');
		const outsiderId = unique('preview-access-stranger');
		const owners = await db
			.insert(user)
			.values([
				{ id: ownerId, name: 'Preview Access Owner', email: `${ownerId}@example.test` },
				{ id: outsiderId, name: 'Preview Access Stranger', email: `${outsiderId}@example.test` }
			])
			.returning({ id: user.id });
		if (owners.length !== 2) throw new Error('user insert did not return both rows');
		strangerId = outsiderId;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Preview Access Universe',
				slug: unique('preview-access-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeRow = uni;

		const [entry, gmOnly] = await db
			.insert(entity)
			.values([
				{
					universeId: uni.id,
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: unique('ledger'),
					body: [PUBLIC_OPENING, '', ':::secret', SECRET_TEXT, ':::'].join('\n')
				},
				{
					universeId: uni.id,
					type: 'faction',
					name: GM_ONLY_NAME,
					slug: unique('umbral-concord'),
					visibility: 'gm_only',
					body: 'A body only the table owner reads.'
				}
			])
			.returning({ slug: entity.slug });
		if (!entry || !gmOnly) throw new Error('fixture entity insert failed');
		entrySlug = entry.slug;
		gmOnlySlug = gmOnly.slug;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeRow.id));
		await db.delete(user).where(eq(user.id, universeRow.ownerUserId));
		await db.delete(user).where(eq(user.id, strangerId));
		await closeDb(db);
	});

	function request(slug: string, userId: string | null): Promise<Response> {
		return Promise.resolve(
			GET({
				params: { universe: universeRow.slug, slug },
				locals: userId ? { user: { id: userId } } : {}
			} as Parameters<typeof GET>[0])
		);
	}

	async function statusOf(promise: Promise<Response>): Promise<number> {
		try {
			await promise;
		} catch (err) {
			if (isHttpError(err)) return err.status;
			throw err;
		}
		throw new Error('expected the request to throw an HTTP error, but it returned a response');
	}

	it('404s with no session at all', async () => {
		expect(await statusOf(request(entrySlug, null))).toBe(404);
	});

	it('404s for a signed-in user with no access to this universe', async () => {
		expect(await statusOf(request(entrySlug, strangerId))).toBe(404);
	});

	it('previews an entry for a member, with the fenced sentence stripped out of it', async () => {
		const response = await request(entrySlug, universeRow.ownerUserId);
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({
			name: 'The Ashen Ledger',
			type: 'faction',
			status: 'full',
			excerpt: PUBLIC_OPENING
		});
		expect(text).not.toContain(SECRET_TEXT);
		expect(text).not.toContain(':::');
	});

	it('previews a gm_only entry for a member, because the GM reads it on the page anyway', async () => {
		const payload = await (await request(gmOnlySlug, universeRow.ownerUserId)).json();
		expect(payload).toMatchObject({ name: GM_ONLY_NAME, status: 'full' });
	});

	it('404s for an entry slug this universe does not have', async () => {
		expect(await statusOf(request('no-such-entry-here', universeRow.ownerUserId))).toBe(404);
	});
});
