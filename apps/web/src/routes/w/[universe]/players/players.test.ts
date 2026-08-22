/**
 * Issue R11, round thirteen, reshaped by issue #530 (round eighteen): proof that the
 * GM's players page reads the real `revelation` log (kept per session, across every kind
 * it can carry), groups it by session server-side, and orders "still behind the screen"
 * (`listPublicEntities`) with what is connected to something already revealed first - not
 * a page that merely renders without throwing. Runs against the real handlers and a real
 * Postgres, same convention as `e/[slug]/cover-gate.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, type Db } from '@canonry/db';
import {
	entity,
	fact,
	relation,
	relationType,
	revelation,
	revision,
	universe,
	universeMember,
	user
} from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { load } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same convention as cover-gate.test.ts: the route's own `$lib/server/db.ts` singleton
// reads `$env/dynamic/private` with no fallback, and it has to be set before the first
// `load` call rather than inside one.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
	try {
		await promise;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
	throw new Error('expected the load to throw an HTTP error, but it returned data');
}

describe('/w/[universe]/players (issue R11, round thirteen)', () => {
	let db: Db;
	let ownerId: string;
	let viewerId: string;
	let outsiderId: string;
	let universeSlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('players-owner');
		const viewerKey = unique('players-viewer');
		const outsiderKey = unique('players-outsider');
		const [owner, viewer, outsider] = await db
			.insert(user)
			.values([
				{ id: ownerKey, name: 'Players Owner', email: `${ownerKey}@example.test` },
				{ id: viewerKey, name: 'Players Viewer', email: `${viewerKey}@example.test` },
				{ id: outsiderKey, name: 'Players Outsider', email: `${outsiderKey}@example.test` }
			])
			.returning({ id: user.id });
		if (!owner || !viewer || !outsider) throw new Error('user insert did not return three rows');
		ownerId = owner.id;
		viewerId = viewer.id;
		outsiderId = outsider.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Players Universe',
				slug: unique('players-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		universeSlug = uni.slug;

		// A viewer, not the outsider below: 'viewer' is a real member, who this route's
		// own doc comment says sees an identical read-only page - not the 404 a
		// non-member gets.
		await db
			.insert(universeMember)
			.values({ universeId: uni.id, userId: viewerId, role: 'viewer' });

		const [session, revealed, hidden, gmOnly, other] = await db
			.insert(entity)
			.values([
				{
					universeId: uni.id,
					type: 'session',
					name: 'The First Session',
					slug: unique('session'),
					body: 'The party met in the tavern.'
				},
				{
					universeId: uni.id,
					type: 'character',
					name: 'Aldric Revealed',
					slug: unique('revealed'),
					body: 'A face the party has met.'
				},
				{
					universeId: uni.id,
					type: 'place',
					name: 'The Unfound Vault',
					slug: unique('hidden'),
					body: 'Nobody has found this yet.'
				},
				{
					universeId: uni.id,
					type: 'faction',
					name: 'The Secret Cabal',
					slug: unique('gm-only'),
					body: 'The GM keeps this entirely to themself.',
					visibility: 'gm_only'
				},
				{
					universeId: uni.id,
					type: 'character',
					name: 'The Other Side',
					slug: unique('other'),
					body: 'The far end of a revealed relation.'
				}
			])
			.returning({ id: entity.id, name: entity.name });
		if (!session || !revealed || !hidden || !gmOnly || !other) {
			throw new Error('entity insert did not return five rows');
		}

		const [relType] = await db
			.insert(relationType)
			.values({
				universeId: uni.id,
				label: 'allies with',
				inverseLabel: 'allied by',
				cardinality: 'many_to_many',
				allowedFrom: ['character'],
				allowedTo: ['character']
			})
			.returning({ id: relationType.id });
		if (!relType) throw new Error('relation type insert did not return a row');

		const [rel] = await db
			.insert(relation)
			.values({
				universeId: uni.id,
				relationTypeId: relType.id,
				fromEntityId: revealed.id,
				toEntityId: other.id,
				authorKind: 'human'
			})
			.returning({ id: relation.id });
		if (!rel) throw new Error('relation insert did not return a row');

		// Issue #492: a fact revelation names its own subject (`fact.entity_id`), not a
		// second entity - `revealed`'s here, so its row is expected to link the same
		// entry the entity row above does.
		const [factRevision] = await db
			.insert(revision)
			.values({
				universeId: uni.id,
				entityId: revealed.id,
				authorKind: 'human',
				name: 'Aldric Revealed',
				body: 'Aldric Revealed owes a debt neither side has mentioned aloud.'
			})
			.returning({ id: revision.id });
		if (!factRevision) throw new Error('revision insert did not return a row');

		const [factRow] = await db
			.insert(fact)
			.values({
				universeId: uni.id,
				entityId: revealed.id,
				statement: 'Aldric Revealed owes a debt neither side has mentioned aloud.',
				sourceRevisionId: factRevision.id,
				spanStart: 0,
				spanEnd: 10,
				authorKind: 'human'
			})
			.returning({ id: fact.id });
		if (!factRow) throw new Error('fact insert did not return a row');

		await db.insert(revelation).values([
			{
				universeId: uni.id,
				kind: 'entity',
				entityId: revealed.id,
				sessionEntityId: session.id,
				confirmedAt: new Date()
			},
			{
				universeId: uni.id,
				kind: 'relation',
				relationId: rel.id,
				sessionEntityId: session.id,
				confirmedAt: new Date()
			},
			{
				universeId: uni.id,
				kind: 'fact',
				factId: factRow.id,
				sessionEntityId: session.id,
				confirmedAt: new Date()
			}
		]);
		// `other` and `hidden` stay revealable with no confirmed 'entity' revelation of
		// their own - both belong in "still behind the screen"; `gmOnly` must appear in
		// neither list, the same guard `listPublicEntities` already enforces.
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function loadAs(userId: string) {
		return load({
			params: { universe: universeSlug },
			locals: { user: { id: userId }, locale: 'en' }
		} as Parameters<typeof load>[0]);
	}

	it('shows a member the revealed log grouped by session, and what is still hidden', async () => {
		const data = (await loadAs(ownerId)) as {
			log: Array<{
				key: string;
				sessionName: string | null;
				items: Array<{
					kind: 'entity' | 'fact' | 'relation';
					label?: string;
					entity?: { slug: string; name: string; revealed: boolean };
					relationLabel?: string;
					from?: { slug: string; name: string; revealed: boolean };
					to?: { slug: string; name: string; revealed: boolean };
				}>;
			}>;
			hidden: Array<{ name: string; connected: boolean }>;
		};

		// Issue #530: every row this fixture confirmed landed in the one session it was
		// confirmed in, so the whole log is a single group rather than three.
		expect(data.log).toHaveLength(1);
		const group = data.log[0];
		expect(group.sessionName).toBe('The First Session');
		expect(group.items).toHaveLength(3);

		const entityRow = group.items.find((row) => row.kind === 'entity');
		const factLogRow = group.items.find((row) => row.kind === 'fact');
		const relationRow = group.items.find((row) => row.kind === 'relation');

		// #492: the entity row links the entry it names, and its own 'entity'
		// revelation is exactly what makes `statusBySlug` say 'full', so it also offers
		// the player's own view of it.
		expect(entityRow?.entity?.name).toBe('Aldric Revealed');
		expect(entityRow?.entity?.revealed).toBe(true);

		// A fact names its own subject (`fact.entity_id`), not a second entity - the
		// same one the entity row above names, so the same reveal status applies.
		expect(factLogRow?.label).toBe('Aldric Revealed owes a debt neither side has mentioned aloud.');
		expect(factLogRow?.entity?.name).toBe('Aldric Revealed');
		expect(factLogRow?.entity?.revealed).toBe(true);

		// A relation names both sides independently. `other` never got its own 'entity'
		// revelation, so it stays a gap on the players' wiki even though the relation
		// naming it is revealed - no player-view link for that half.
		expect(relationRow?.relationLabel).toBe('allies with');
		expect(relationRow?.from?.name).toBe('Aldric Revealed');
		expect(relationRow?.from?.revealed).toBe(true);
		expect(relationRow?.to?.name).toBe('The Other Side');
		expect(relationRow?.to?.revealed).toBe(false);

		const hiddenNames = data.hidden.map((row) => row.name);
		expect(hiddenNames).toContain('The Unfound Vault');
		expect(hiddenNames).toContain('The Other Side');
		expect(hiddenNames).not.toContain('Aldric Revealed');
		expect(hiddenNames).not.toContain('The Secret Cabal');

		// Issue #530: `The Other Side` is one hop from `Aldric Revealed` (the confirmed
		// relation), so `pinnedNeighbors` marks it connected and it sorts before
		// `The Unfound Vault`, which touches nothing revealed.
		const other = data.hidden.find((row) => row.name === 'The Other Side');
		const vault = data.hidden.find((row) => row.name === 'The Unfound Vault');
		expect(other?.connected).toBe(true);
		expect(vault?.connected).toBe(false);
		expect(data.hidden.indexOf(other!)).toBeLessThan(data.hidden.indexOf(vault!));
	});

	it('shows a viewer the identical read-only page, not a 404', async () => {
		const data = (await loadAs(viewerId)) as {
			log: Array<{ items: unknown[] }>;
			hidden: unknown[];
		};
		expect(data.log).toHaveLength(1);
		expect(data.log[0].items).toHaveLength(3);
		expect(data.hidden.length).toBeGreaterThan(0);
	});

	it('refuses a non-member the same 404 as any other /w/ route', async () => {
		expect(await statusOf(loadAs(outsiderId))).toBe(404);
	});
});
