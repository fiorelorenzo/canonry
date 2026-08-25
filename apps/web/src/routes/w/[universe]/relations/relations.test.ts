/**
 * Issue #648: the relation catalogue's own fork action, run against the real action and a
 * real Postgres.
 *
 * The review queue's shipped-refusal notice is only a route if what it links to can act.
 * `widenRelationType` cannot serve a shipped row and never will (decision L1: a shipped
 * key is API surface, so the ten change through a migration and nothing else), and this
 * page had rename, widen, merge and translate but no way to add a type at all, which is
 * the half of #192's "a universe can add its own types" that was never built. So the
 * notice pointed at a page where the GM could read the ten and do nothing about them.
 *
 * What is pinned here is that action's three refusals and the query string the notice
 * arrives with, because a link carrying a hand-edited entity type must not put it in front
 * of the GM as if the refusal had asked for it. The fork's own write is covered at the db
 * layer (`packages/db/test/relation-type-fork.test.ts`), and the whole route end to end,
 * refusal through fork through accept, in the review queue's own file.
 *
 * Every case fails on 9a8a4f8: neither the action nor the load's fork parameters exist
 * there.
 *
 * Issue #795 (DECISIONS.md "Round twenty-one"): moved here from
 * `settings/relations/relations.test.ts` alongside the route it tests.
 */
import { randomUUID } from 'node:crypto';
import { and, closeDb, createDb, eq, isNull, type Db } from '@canonry/db';
import { relationType, universe, user } from '@canonry/db/schema';
import { isActionFailure } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions, load } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function failureData(result: unknown): { action: string; typeId: string; error?: string } {
	if (result && typeof result === 'object' && 'data' in result && result.data) {
		return result.data as { action: string; typeId: string; error?: string };
	}
	throw new Error('expected an ActionFailure');
}

describe('/w/[universe]/relations: a universe gets its own version of a shipped type (#648)', () => {
	let db: Db;
	let ownerId: string;
	let universeId: string;
	let universeSlug: string;
	let shippedTypeId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('w648-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'W648 Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'W648 Universe',
				slug: unique('w648-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;
		universeSlug = uni.slug;

		const [shipped] = await db
			.select({ id: relationType.id })
			.from(relationType)
			.where(and(eq(relationType.label, 'member of'), isNull(relationType.universeId)))
			.limit(1);
		if (!shipped) throw new Error('no shipped "member of" relation type');
		shippedTypeId = shipped.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	function postEvent(fields: Array<[string, string]>) {
		const formData = new FormData();
		for (const [key, value] of fields) formData.append(key, value);
		return {
			request: new Request(`http://localhost/w/${universeSlug}/relations`, {
				method: 'POST',
				body: formData
			}),
			params: { universe: universeSlug },
			locals: { user: { id: ownerId }, locale: 'en' }
		};
	}

	function loadEvent(query: string) {
		return {
			params: { universe: universeSlug },
			url: new URL(`http://localhost/w/${universeSlug}/relations${query}`),
			locals: { user: { id: ownerId }, locale: 'en' }
		};
	}

	/** `load`'s own generated type is a union with `void`, since it may `error()` out, so the
	 * three fields under test are read through the shape rather than off that union. */
	async function loadFork(query: string) {
		const data = await load(loadEvent(query) as Parameters<typeof load>[0]);
		return data as unknown as {
			forkTypeId: string | null;
			forkAddFrom: string[];
			forkAddTo: string[];
		};
	}

	it('carries the refused pair through from the query string, and only real entity types', async () => {
		const data = await loadFork(
			`?fork=${shippedTypeId}&addFrom=faction&addTo=character&addTo=dragon`
		);

		expect(data.forkTypeId).toBe(shippedTypeId);
		expect(data.forkAddFrom).toEqual(['faction']);
		// `dragon` is not an entity type, so it never reaches the dialog as a box the refusal
		// supposedly asked for.
		expect(data.forkAddTo).toEqual(['character']);
	});

	it('reads no fork target when the GM opened the catalogue by itself', async () => {
		const data = await loadFork('');
		expect(data.forkTypeId).toBeNull();
		expect(data.forkAddFrom).toEqual([]);
		expect(data.forkAddTo).toEqual([]);
	});

	it('refuses a fork that adds nothing, because a copy that is not wider buys nothing', async () => {
		const result = await actions.forkShippedRelationType(
			postEvent([['typeId', shippedTypeId]]) as Parameters<
				typeof actions.forkShippedRelationType
			>[0]
		);

		expect(isActionFailure(result)).toBe(true);
		expect(failureData(result).action).toBe('fork');
		const rows = await db
			.select({ id: relationType.id })
			.from(relationType)
			.where(eq(relationType.universeId, universeId));
		expect(rows).toHaveLength(0);
	});

	it('refuses to fork a type the universe already owns, naming the widen instead', async () => {
		const own = await db
			.insert(relationType)
			.values({
				universeId,
				label: unique('capo di'),
				inverseLabel: 'ha come capo',
				cardinality: 'many_to_many',
				allowedFrom: ['character'],
				allowedTo: ['place']
			})
			.returning({ id: relationType.id });
		const ownId = own[0]?.id;
		if (!ownId) throw new Error('relation type insert did not return a row');

		const result = await actions.forkShippedRelationType(
			postEvent([
				['typeId', ownId],
				['addTo', 'item']
			]) as Parameters<typeof actions.forkShippedRelationType>[0]
		);

		expect(isActionFailure(result)).toBe(true);
		const data = failureData(result);
		expect(data.typeId).toBe(ownId);
		expect(data.error).toContain('widen');
	});

	it('forks once, then refuses the second fork of the same type', async () => {
		const first = await actions.forkShippedRelationType(
			postEvent([
				['typeId', shippedTypeId],
				['addFrom', 'faction'],
				['addTo', 'character']
			]) as Parameters<typeof actions.forkShippedRelationType>[0]
		);
		expect(isActionFailure(first)).toBe(false);
		expect(first).toMatchObject({ action: 'fork', createdLabel: 'member of' });

		const [fork] = await db
			.select({ allowedFrom: relationType.allowedFrom, allowedTo: relationType.allowedTo })
			.from(relationType)
			.where(and(eq(relationType.universeId, universeId), eq(relationType.label, 'member of')))
			.limit(1);
		// Wider than the shipped row by exactly the pair asked for, and no narrower anywhere.
		expect(fork?.allowedFrom).toEqual(expect.arrayContaining(['character', 'faction']));
		expect(fork?.allowedTo).toEqual(expect.arrayContaining(['faction', 'character']));

		const second = await actions.forkShippedRelationType(
			postEvent([
				['typeId', shippedTypeId],
				['addTo', 'place']
			]) as Parameters<typeof actions.forkShippedRelationType>[0]
		);
		expect(isActionFailure(second)).toBe(true);
		expect(failureData(second).error).toContain('Widen that one');
	});
});
