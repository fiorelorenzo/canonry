/**
 * Issue #251: publishing a world to its players' wiki. Two halves, because the two things
 * that can go wrong are different in kind.
 *
 * The first half needs no database. `SAMPLE_WORLD_PUBLICATION` names slugs, and the world it
 * names them in is `seed-fixture.ts`'s `ENTITIES`, so an edit to either can silently make the
 * published sample incoherent: a slug that no longer exists, an entry that became `gm_only`,
 * or a `[[mention]]` inside published prose pointing at an entry the plan does not publish,
 * which renders as plain text and reads to a stranger as a hole. Checking that statically is
 * what keeps the answer to "does this read like a world worth carrying on with" from decaying
 * one commit at a time.
 *
 * The second half is guardrail 6 against the real writer. `publishWorld` is the first thing in
 * this codebase that reveals in bulk, and the acceptance it has to hold is that it cannot
 * publish anything a GM did not already mark revealable, cannot publish a fact at all, and
 * cannot make a relation name an entry the public index does not list. Each of those is a
 * test below that fails if the guard is removed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
	closeDb,
	listPublicEntities,
	publicEntityBySlug,
	revealEntityLive,
	type Db
} from '../src/index.js';
import {
	claimUniverse,
	publishWorld,
	PublicationPlanError,
	SAMPLE_WORLD_PUBLICATION,
	type PublicationPlan
} from '../src/publish-world.js';
import { ENTITIES } from '../src/seed-fixture.js';
import { entity } from '../src/schema/entity.js';
import { fact } from '../src/schema/fact.js';
import { revelation } from '../src/schema/players.js';
import { relation, relationType } from '../src/schema/relation.js';
import { revision } from '../src/schema/revision.js';
import { universe, universeMember } from '../src/schema/universe.js';
import { insertHomebrewUniverse, insertUser, testDb, unique } from './helpers.js';

describe('the sample world publication plan (#251)', () => {
	const bySlug = new Map(ENTITIES.map((e) => [e.slug, e]));
	const publishedSlugs = SAMPLE_WORLD_PUBLICATION.sessions.flatMap((step) => [
		step.session,
		...step.entities
	]);

	it('names only entries the fixture actually seeds', () => {
		expect(publishedSlugs.filter((slug) => !bySlug.has(slug))).toEqual([]);
	});

	it('publishes no gm_only entry, and no entry twice', () => {
		expect(publishedSlugs.filter((slug) => bySlug.get(slug)?.visibility === 'gm_only')).toEqual([]);
		expect(new Set(publishedSlugs).size).toBe(publishedSlugs.length);
	});

	it('attributes every session slug to a session entry', () => {
		for (const step of SAMPLE_WORLD_PUBLICATION.sessions) {
			expect(bySlug.get(step.session)?.type).toBe('session');
		}
	});

	// The coherence check the acceptance asks for, at the level a test can hold: a mention
	// inside published prose has to land on another published entry. A mention of anything
	// else is safe (`publicMentionTargets` renders it as plain text, #220) but it reads as a
	// dead end, which is the failure mode a published sample cannot afford.
	it('every mention inside published prose lands on another published entry', () => {
		const published = new Set(publishedSlugs);
		const nameToSlug = new Map<string, string>();
		for (const e of ENTITIES) {
			for (const name of [e.name, ...(e.aliases ?? [])]) {
				nameToSlug.set(name.toLowerCase(), e.slug);
			}
		}

		const dangling: string[] = [];
		for (const slug of publishedSlugs) {
			const body = bySlug.get(slug)?.body ?? '';
			for (const match of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
				const target = nameToSlug.get((match[1] ?? '').toLowerCase());
				if (!target || !published.has(target)) {
					dangling.push(`${slug} -> ${match[1] ?? ''}`);
				}
			}
		}
		expect(dangling).toEqual([]);
	});

	// Guardrail 6's floor, stated as a fact about the plan rather than about the code: the
	// world's one gm_only entry is not in it, so no run of the script can reach that entry.
	it('leaves the world gm_only entry out entirely', () => {
		const gmOnly = ENTITIES.filter((e) => e.visibility === 'gm_only').map((e) => e.slug);
		expect(gmOnly.length).toBeGreaterThan(0);
		expect(publishedSlugs.filter((slug) => gmOnly.includes(slug))).toEqual([]);
	});
});

describe('publishWorld (#251)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	/**
	 * A universe shaped like the published sample's own problems: two sessions, two entries
	 * to publish, one revealable entry left out of the plan, one `gm_only` faction, a
	 * relation between the two published entries, a second relation from a published entry
	 * into the gm_only one, and a fact with a real source revision behind it.
	 */
	async function world() {
		const u = await insertHomebrewUniverse(db, { slug: unique('published') });
		const rows = await db
			.insert(entity)
			.values([
				{ universeId: u.id, type: 'session', name: 'Session 1', slug: 'session-1' },
				{ universeId: u.id, type: 'session', name: 'Session 2', slug: 'session-2' },
				{
					universeId: u.id,
					type: 'character',
					name: 'Aldric Vane',
					slug: 'aldric-vane',
					body: 'Dismissed from the watch, he now answers to [[The Ashen Ledger]].'
				},
				{ universeId: u.id, type: 'faction', name: 'The Ashen Ledger', slug: 'the-ashen-ledger' },
				{ universeId: u.id, type: 'item', name: "The Smugglers' Ledger", slug: 'smugglers-ledger' },
				{
					universeId: u.id,
					type: 'faction',
					name: 'The Drowned Concord',
					slug: 'the-drowned-concord',
					visibility: 'gm_only'
				}
			])
			.returning({ id: entity.id, slug: entity.slug });
		const id = (slug: string) => {
			const found = rows.find((row) => row.slug === slug);
			if (!found) throw new Error(`fixture entity ${slug} missing`);
			return found.id;
		};

		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'employs',
				inverseLabel: 'employed by',
				cardinality: 'one_to_many',
				allowedFrom: ['faction'],
				allowedTo: ['character', 'faction']
			})
			.returning({ id: relationType.id });
		if (!rt) throw new Error('relation type insert returned no row');

		const [employs] = await db
			.insert(relation)
			.values({
				universeId: u.id,
				relationTypeId: rt.id,
				fromEntityId: id('the-ashen-ledger'),
				toEntityId: id('aldric-vane'),
				authorKind: 'human'
			})
			.returning({ id: relation.id });
		const [secretTie] = await db
			.insert(relation)
			.values({
				universeId: u.id,
				relationTypeId: rt.id,
				fromEntityId: id('the-drowned-concord'),
				toEntityId: id('aldric-vane'),
				authorKind: 'human'
			})
			.returning({ id: relation.id });
		if (!employs || !secretTie) throw new Error('relation insert returned no row');

		const [rev] = await db
			.insert(revision)
			.values({
				universeId: u.id,
				entityId: id('aldric-vane'),
				authorKind: 'human',
				name: 'Aldric Vane',
				body: 'Dismissed from the watch, he now answers to [[The Ashen Ledger]].'
			})
			.returning({ id: revision.id });
		if (!rev) throw new Error('revision insert returned no row');
		await db.insert(fact).values({
			universeId: u.id,
			entityId: id('aldric-vane'),
			statement: 'Aldric Vane was dismissed from the watch.',
			sourceRevisionId: rev.id,
			spanStart: 0,
			spanEnd: 10,
			authorKind: 'human'
		});

		return { universeId: u.id, universeSlug: u.slug, id };
	}

	function planFor(universeSlug: string): PublicationPlan {
		return {
			universeSlug,
			sessions: [
				{ session: 'session-1', entities: ['aldric-vane'] },
				{ session: 'session-2', entities: ['the-ashen-ledger'] }
			]
		};
	}

	async function revelationCount(universeId: string): Promise<number> {
		const rows = await db
			.select({ id: revelation.id })
			.from(revelation)
			.where(eq(revelation.universeId, universeId));
		return rows.length;
	}

	it('publishes the planned entries, attributed to their session, and leaves the rest gaps', async () => {
		const w = await world();
		const result = await publishWorld(db, planFor(w.universeSlug));

		expect(result.published.sort()).toEqual(
			['aldric-vane', 'session-1', 'session-2', 'the-ashen-ledger'].sort()
		);
		expect(result.gaps).toEqual(['smugglers-ledger']);
		expect(result.withheld).toEqual(['the-drowned-concord']);
		expect(result.alreadyPublic).toEqual([]);

		const aldric = await publicEntityBySlug(db, w.universeId, 'aldric-vane');
		expect(aldric?.status).toBe('full');
		if (aldric?.status !== 'full') throw new Error('unreachable');
		expect(aldric.revealedInSession).toBe('Session 1');

		const ledger = await publicEntityBySlug(db, w.universeId, 'the-ashen-ledger');
		expect(ledger?.status === 'full' && ledger.revealedInSession).toBe('Session 2');

		// The entry the plan leaves out stays an E7 gap page: listed by name, nothing else.
		const smugglers = await publicEntityBySlug(db, w.universeId, 'smugglers-ledger');
		expect(smugglers?.status).toBe('gap');
	});

	// A world's own history wins over a plan that disagrees with it: the sample world's
	// fixture reveals three entries by itself, and a real table reveals whatever came up
	// whenever it came up. Writing a second row would move when the players learned it,
	// which is a lie the players' wiki would then tell on its own page.
	it('leaves an entry a different session already revealed exactly as it was', async () => {
		const w = await world();
		await revealEntityLive(db, {
			universeId: w.universeId,
			entityId: w.id('aldric-vane'),
			sessionEntityId: w.id('session-2')
		});

		const result = await publishWorld(db, planFor(w.universeSlug));
		expect(result.alreadyPublic).toEqual(['aldric-vane']);
		expect(result.published).not.toContain('aldric-vane');

		const aldric = await publicEntityBySlug(db, w.universeId, 'aldric-vane');
		expect(aldric?.status === 'full' && aldric.revealedInSession).toBe('Session 2');

		const rows = await db
			.select({ id: revelation.id })
			.from(revelation)
			.where(
				and(
					eq(revelation.universeId, w.universeId),
					eq(revelation.kind, 'entity'),
					eq(revelation.entityId, w.id('aldric-vane'))
				)
			);
		expect(rows).toHaveLength(1);
	});

	it('never publishes a gm_only entry, and refuses a plan that names one', async () => {
		const w = await world();
		await publishWorld(db, planFor(w.universeSlug));

		// Not reachable by its slug and not in the index, after a full publication run.
		expect(await publicEntityBySlug(db, w.universeId, 'the-drowned-concord')).toBeUndefined();
		const index = await listPublicEntities(db, w.universeId);
		expect(index.map((row) => row.slug)).not.toContain('the-drowned-concord');

		// And a plan that asks for it is refused, with nothing written for the rest of it
		// either: a half-applied publication is worse than a refused one.
		const second = await world();
		const greedy: PublicationPlan = {
			universeSlug: second.universeSlug,
			sessions: [{ session: 'session-1', entities: ['aldric-vane', 'the-drowned-concord'] }]
		};
		await expect(publishWorld(db, greedy)).rejects.toThrow(PublicationPlanError);
		await expect(publishWorld(db, greedy)).rejects.toThrow(/gm_only/);
		expect(await revelationCount(second.universeId)).toBe(0);

		// The refusal is a refusal, not a flip: visibility is untouched.
		const [row] = await db
			.select({ visibility: entity.visibility })
			.from(entity)
			.where(and(eq(entity.universeId, second.universeId), eq(entity.slug, 'the-drowned-concord')));
		expect(row?.visibility).toBe('gm_only');
	});

	it('reveals a relation only when both of its ends are published', async () => {
		const w = await world();
		const result = await publishWorld(db, planFor(w.universeSlug));
		expect(result.relations).toBe(1);

		const aldric = await publicEntityBySlug(db, w.universeId, 'aldric-vane');
		if (aldric?.status !== 'full') throw new Error('expected a published entry');
		expect(aldric.relations.map((r) => r.other.slug)).toEqual(['the-ashen-ledger']);

		const relationRevelations = await db
			.select({ relationId: revelation.relationId })
			.from(revelation)
			.where(and(eq(revelation.universeId, w.universeId), eq(revelation.kind, 'relation')));
		expect(relationRevelations).toHaveLength(1);
	});

	// Issue #306: a fact's excerpt is cut from the raw revision body with no fence filter in
	// the public read path, so publishing must not be a way to reveal one in bulk.
	it('never reveals a fact', async () => {
		const w = await world();
		await publishWorld(db, planFor(w.universeSlug));

		const aldric = await publicEntityBySlug(db, w.universeId, 'aldric-vane');
		if (aldric?.status !== 'full') throw new Error('expected a published entry');
		expect(aldric.facts).toEqual([]);

		const factRevelations = await db
			.select({ id: revelation.id })
			.from(revelation)
			.where(and(eq(revelation.universeId, w.universeId), eq(revelation.kind, 'fact')));
		expect(factRevelations).toEqual([]);
	});

	it('is idempotent, and a second run does not move when something was learned', async () => {
		const w = await world();
		await publishWorld(db, planFor(w.universeSlug));
		const first = await publicEntityBySlug(db, w.universeId, 'aldric-vane');
		const countAfterFirst = await revelationCount(w.universeId);

		await publishWorld(db, planFor(w.universeSlug));
		const second = await publicEntityBySlug(db, w.universeId, 'aldric-vane');

		expect(await revelationCount(w.universeId)).toBe(countAfterFirst);
		expect(first?.status === 'full' && first.revealedAt.getTime()).toBe(
			second?.status === 'full' && second.revealedAt.getTime()
		);
	});

	it('a dry run reports the same plan and writes nothing', async () => {
		const w = await world();
		const dry = await publishWorld(db, planFor(w.universeSlug), { dryRun: true });
		expect(dry.published).toHaveLength(4);
		expect(dry.relations).toBe(1);
		expect(await revelationCount(w.universeId)).toBe(0);
	});

	it('refuses a plan whose slugs are not in the universe', async () => {
		const w = await world();
		const wrong: PublicationPlan = {
			universeSlug: w.universeSlug,
			sessions: [{ session: 'session-1', entities: ['nobody-here'] }]
		};
		await expect(publishWorld(db, wrong)).rejects.toThrow(/nobody-here/);
		await expect(publishWorld(db, { universeSlug: 'no-such-world', sessions: [] })).rejects.toThrow(
			/no-such-world/
		);
	});

	it('refuses a session slug that is not a session entry', async () => {
		const w = await world();
		const wrong: PublicationPlan = {
			universeSlug: w.universeSlug,
			sessions: [{ session: 'aldric-vane', entities: ['the-ashen-ledger'] }]
		};
		await expect(publishWorld(db, wrong)).rejects.toThrow(/not session entries/);
	});
});

describe('claimUniverse (#251)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('hands the world to an existing account, as owner, idempotently', async () => {
		const u = await insertHomebrewUniverse(db, { slug: unique('claimed') });
		const account = await insertUser(db);

		await claimUniverse(db, { universeSlug: u.slug, ownerEmail: account.email });
		await claimUniverse(db, { universeSlug: u.slug, ownerEmail: account.email });

		const [world] = await db
			.select({ ownerUserId: universe.ownerUserId })
			.from(universe)
			.where(eq(universe.id, u.id));
		expect(world?.ownerUserId).toBe(account.id);

		const members = await db
			.select({ userId: universeMember.userId, role: universeMember.role })
			.from(universeMember)
			.where(eq(universeMember.universeId, u.id));
		expect(members).toEqual([{ userId: account.id, role: 'owner' }]);
	});

	it('refuses an email nobody has signed up with', async () => {
		const u = await insertHomebrewUniverse(db, { slug: unique('claimed') });
		await expect(
			claimUniverse(db, { universeSlug: u.slug, ownerEmail: 'nobody@canonry.invalid' })
		).rejects.toThrow(/no account/);
	});
});
