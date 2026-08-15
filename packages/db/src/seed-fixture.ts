/**
 * Seeds the sample world every UX artifact is drawn on (docs/ux/SAMPLE-WORLD.md), so a
 * developer, a screenshot and a manual check are all looking at the same Valdoria Reach
 * rather than at three different inventions. Idempotent: it deletes the universe by slug
 * first, which cascades, then rebuilds it.
 *
 * Fixture data only. Nothing here is a product requirement, and it must never run
 * against a database that holds somebody's real campaign, which is why it refuses any
 * DATABASE_URL that does not look local unless CANONRY_SEED_FORCE is set.
 */
import { inArray } from 'drizzle-orm';
import { detectLanguage } from '@canonry/lang';
import { closeDb, createDb, type Db } from './client.js';
import { revealEntityLive, revealFactLive, revealRelationLive } from './queries/players.js';
import { entity } from './schema/entity.js';
import { fact } from './schema/fact.js';
import { relation, relationType } from './schema/relation.js';
import { revision } from './schema/revision.js';
import { user } from './schema/auth.js';
import { universe, universeMember } from './schema/universe.js';

const OWNER = 'fixture-owner';

const ALDRIC_BODY = `Dismissed from the watch in the thaw after [[The Sable Winter]], he now answers to [[The Ashen Ledger]]. He still drinks at [[The Gilded Rat]], in the corner seat nobody asks him to leave.

## Standing in the city

Three hundred and forty sworn used to take his word. Forty of them still would, which is the number [[Corvin Ashe]] is paying for.`;

/** The sentence every propagation proposal in the artifacts quotes as its evidence. */
const ALDRIC_EVIDENCE = 'Dismissed from the watch in the thaw after [[The Sable Winter]]';

interface SeedEntity {
	type: 'character' | 'place' | 'faction' | 'item' | 'event' | 'session';
	name: string;
	slug: string;
	aliases?: string[];
	body: string;
	/** Defaults to 'revealable'. Issues #82-85: one gm_only entry in the fixture world so
	 * the players' wiki has something real to demonstrate excluding, not just an empty set. */
	visibility?: 'gm_only' | 'revealable';
}

const ENTITIES: SeedEntity[] = [
	{
		type: 'character',
		name: 'Aldric Vane',
		slug: 'aldric-vane',
		aliases: ['Captain Vane', 'the broken captain'],
		body: ALDRIC_BODY
	},
	{
		type: 'character',
		name: 'Mother Sennah',
		slug: 'mother-sennah',
		aliases: ['the Winter Surgeon'],
		body: 'Keeps [[The Gilded Rat]]. She was a field surgeon through [[The Sable Winter]] and does not talk about it, which is its own kind of talking about it.'
	},
	{
		type: 'character',
		name: 'Corvin Ashe',
		slug: 'corvin-ashe',
		body: "Factor of [[The Ashen Ledger]]. He holds most of the Lantern Quarter's debt and none of its affection."
	},
	{
		type: 'character',
		name: 'Iselde Wrenn',
		slug: 'iselde-wrenn',
		body: 'Harbour magistrate. She appointed [[Aldric Vane]], and then broke him, and has never explained which of the two she regrets.'
	},
	{
		type: 'place',
		name: 'Valdoria',
		slug: 'valdoria',
		body: 'A free port of six quarters. The Lantern Quarter is the poorest and the loudest.\n\n## The Watch\n\nThree hundred and forty sworn, badly paid, and currently without a captain.'
	},
	{
		type: 'place',
		name: 'The Gilded Rat',
		slug: 'the-gilded-rat',
		aliases: ['Gilded Rat Tavern', 'Il Ratto Dorato'],
		body: 'An inn in the Lantern Quarter. [[Mother Sennah]] keeps it, and the corner seat by the stair is understood to belong to somebody.'
	},
	{
		type: 'place',
		name: 'Cairnmouth',
		slug: 'cairnmouth',
		body: 'A fishing town two days up the coast. A third of it starved in [[The Sable Winter]] when [[The Sable Reach]] froze, and the rest remember exactly who did not come. Captain Vane led the watch through the second freeze, the winter after the thaw.'
	},
	{
		type: 'faction',
		name: 'The Ashen Ledger',
		slug: 'the-ashen-ledger',
		body: 'A merchant bank that lends at knife point and keeps better records than the magistrate.\n\n:::secret\nAldric Vane, the dismissed captain of the Valdoria Watch, is now on its payroll.\n:::\n\n:::gmnote\nIselde Wrenn appointed Aldric, then broke him. Play this reveal as her fault circling back, not his.\n:::'
	},
	{
		type: 'faction',
		name: 'The Valdoria Watch',
		slug: 'the-valdoria-watch',
		body: 'Three hundred and forty sworn, paid badly and proud of it anyway.'
	},
	{
		type: 'event',
		name: 'The Sable Winter',
		slug: 'the-sable-winter',
		body: 'The year 1247, when the strait froze and [[Cairnmouth]] starved.'
	},
	{
		type: 'session',
		name: 'Session 1',
		slug: 'session-1',
		body: 'The party arrived in the Lantern Quarter and started asking questions about Aldric Vane.'
	},
	{
		type: 'faction',
		name: 'The Drowned Concord',
		slug: 'the-drowned-concord',
		visibility: 'gm_only',
		body: 'A smuggling ring nobody at the table has heard of yet. Not for players (#82-85 fixture).'
	},
	{
		type: 'faction',
		name: 'La Casa dei Mercanti',
		slug: 'la-casa-dei-mercanti',
		aliases: ['The Merchant House'],
		// Issue #122, SPEC.md §17: the fixture's Italian entry, so every downstream test
		// that needs real bilingual canon reads this one rather than inventing its own -
		// packages/eval's copy of this world mirrors it exactly (`nextEntityLanguage`
		// reads this as 'it').
		body: 'La Casa dei Mercanti tiene i suoi registri nel Quartiere della Lanterna, non lontano dal porto di [[Valdoria]]. Nessuno entra senza un debito da saldare o una lettera di credito da mostrare, e il vecchio Contabile non dimentica mai un nome.\n\n## Il libro nero\n\nOgni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa. [[The Ashen Ledger]] la considera una concorrente, mai un’alleata, e i loro uomini non bevono mai allo stesso tavolo.'
	},
	{
		type: 'item',
		name: "The Smugglers' Ledger",
		slug: 'smugglers-ledger',
		// Issue #122: the fixture's deliberately mixed entry - roughly even English and
		// Italian sentences, so `detectLanguage` refuses to pick a winner. `null` here is
		// the honest answer, not a missing one (`nextEntityLanguage` reads this as null).
		body: 'A ledger nobody at the table has read yet, kept by whoever is running goods through the Lantern Quarter that week. The handwriting changes hands more than the goods do, and nobody has ever admitted to owning it.\n\nIl carico di questa settimana non è passato dal molo, ma dalla porta sul retro della locanda, dove nessuno guarda mai due volte. Chi scrive non firma mai con il proprio nome, e questo non è un caso.\n\nHalf the entries are crossed out, and the other half do not match what actually left the harbour that night. Whoever kept it after [[Aldric Vane]] stopped writing has a different hand entirely, but the same habit of saying less than they know.'
	}
];

/** Relations by slug, using the shipped catalogue's labels. */
const RELATIONS: Array<[from: string, label: string, to: string]> = [
	['the-ashen-ledger', 'employs', 'aldric-vane'],
	['iselde-wrenn', 'appointed', 'aldric-vane'],
	['aldric-vane', 'member of', 'the-valdoria-watch'],
	['the-valdoria-watch', 'located in', 'valdoria'],
	['the-gilded-rat', 'part of', 'valdoria'],
	['mother-sennah', 'owns', 'the-gilded-rat'],
	['the-ashen-ledger', 'employs', 'corvin-ashe'],
	['la-casa-dei-mercanti', 'located in', 'valdoria'],
	['smugglers-ledger', 'located in', 'valdoria']
];

function assertLocal(url: string): void {
	const local = /@(127\.0\.0\.1|localhost|postgres|host\.docker\.internal)[:/]/.test(url);
	if (!local && !process.env.CANONRY_SEED_FORCE) {
		throw new Error(
			'refusing to seed fixture data into a database that does not look local. ' +
				'Set CANONRY_SEED_FORCE=1 if you really mean it.'
		);
	}
}

export async function seedFixture(db: Db): Promise<{ universeId: string; entities: number }> {
	// universe.owner_user_id points at Better Auth's user table now, so the fixture owner
	// has to be a real row. Inserted rather than assumed, and left alone if it already
	// exists, because a developer may have signed in as it.
	await db
		.insert(user)
		.values({
			id: OWNER,
			name: 'Fixture Owner',
			email: 'fixture@canonry.invalid',
			emailVerified: true
		})
		.onConflictDoNothing();

	// Order matters: a derived universe holds a foreign key to its base with no cascade,
	// which is deliberate (deleting a base out from under a derived world should hurt), so
	// the derived rows go first or the delete below is refused.
	await db.delete(universe).where(inArray(universe.slug, ['sword-coast-ours', 'ashport-frontier']));
	await db.delete(universe).where(inArray(universe.slug, ['valdoria-reach', 'forgotten-realms']));

	// Stands in for the official pre-indexed universe of SPEC 4.1 and 7. Those arrive with
	// the indexing issues (#57 to #59); until then a derived universe still needs a base to
	// point at, and the switcher needs the precedence case to be real rather than drawn.
	const [base] = await db
		.insert(universe)
		.values({
			ownerUserId: OWNER,
			name: 'Forgotten Realms',
			slug: 'forgotten-realms',
			kind: 'homebrew',
			loremasterDescription: 'Quotes the published books and says so.'
		})
		.returning({ id: universe.id });
	if (!base) throw new Error('base universe insert returned no row');

	const [world] = await db
		.insert(universe)
		.values({
			ownerUserId: OWNER,
			name: 'Valdoria Reach',
			slug: 'valdoria-reach',
			kind: 'homebrew',
			loremasterDescription:
				'Dry, unsentimental, a little tired. Speaks about the city the way a clerk speaks about a debtor.'
		})
		.returning({ id: universe.id });
	if (!world) throw new Error('universe insert returned no row');

	await db.insert(universeMember).values({ universeId: world.id, userId: OWNER, role: 'owner' });

	// Issue #122, SPEC.md §17: a fixture entity is exactly what a save from the "GM" who
	// wrote it would produce, and every real save runs detection - so the seed does too,
	// rather than leaving every entity's language null until somebody happens to open and
	// re-save it. Nobody has hand-set anything at seed time, so every row lands as
	// 'detected', same as a fresh entity anywhere else.
	const inserted = await db
		.insert(entity)
		.values(
			ENTITIES.map((e) => ({
				universeId: world.id,
				type: e.type,
				name: e.name,
				slug: e.slug,
				aliases: e.aliases ?? [],
				body: e.body,
				visibility: e.visibility ?? 'revealable',
				language: detectLanguage(e.body),
				languageSource: 'detected' as const
			}))
		)
		.returning({ id: entity.id, slug: entity.slug });

	const bySlug = new Map(inserted.map((row) => [row.slug, row.id]));
	const catalogue = await db
		.select({ id: relationType.id, label: relationType.label })
		.from(relationType);
	const typeByLabel = new Map(catalogue.map((row) => [row.label, row.id]));

	const relationIdByKey = new Map<string, string>();
	for (const [from, label, to] of RELATIONS) {
		const typeId = typeByLabel.get(label);
		const fromId = bySlug.get(from);
		const toId = bySlug.get(to);
		if (!typeId || !fromId || !toId)
			throw new Error(`fixture relation ${from} ${label} ${to} does not resolve`);
		const [row] = await db
			.insert(relation)
			.values({
				universeId: world.id,
				relationTypeId: typeId,
				fromEntityId: fromId,
				toEntityId: toId,
				authorKind: 'human'
			})
			.returning({ id: relation.id });
		if (!row) throw new Error(`fixture relation ${from} ${label} ${to} insert returned no row`);
		relationIdByKey.set(`${from}|${label}|${to}`, row.id);
	}

	// Two revisions on Aldric Vane: the human edit that triggers propagation in every
	// artifact, and one accepted AI proposal before it, so the history view has both
	// author kinds to render (#18, guardrail 2).
	const aldricId = bySlug.get('aldric-vane');
	if (!aldricId) throw new Error('fixture entity aldric-vane does not resolve');

	const [aiRevision] = await db
		.insert(revision)
		.values({
			universeId: world.id,
			entityId: aldricId,
			authorKind: 'ai_accepted',
			name: 'Aldric Vane',
			aliases: ['Captain Vane'],
			body: 'Captain of the Valdoria Watch, forty sworn under him in the Lantern Quarter.'
		})
		.returning({ id: revision.id });
	if (!aiRevision) throw new Error('revision insert returned no row');

	const [humanRevision] = await db
		.insert(revision)
		.values({
			universeId: world.id,
			entityId: aldricId,
			parentRevisionId: aiRevision.id,
			authorKind: 'human',
			authorUserId: OWNER,
			name: 'Aldric Vane',
			aliases: ['Captain Vane', 'the broken captain'],
			body: ALDRIC_BODY
		})
		.returning({ id: revision.id });
	if (!humanRevision) throw new Error('revision insert returned no row');

	const spanStart = ALDRIC_BODY.indexOf(ALDRIC_EVIDENCE);
	if (spanStart < 0) throw new Error('fixture evidence sentence is not in the body');
	const [dismissedFact] = await db
		.insert(fact)
		.values({
			universeId: world.id,
			entityId: aldricId,
			statement: 'Aldric Vane was dismissed from the Valdoria Watch after the Sable Winter.',
			sourceRevisionId: humanRevision.id,
			spanStart,
			spanEnd: spanStart + ALDRIC_EVIDENCE.length,
			authorKind: 'human'
		})
		.returning({ id: fact.id });
	if (!dismissedFact) throw new Error('fact insert returned no row');

	// Issues #82-85: reveal a representative slice of Valdoria so the public players' wiki
	// (/p/valdoria-reach) has real content to show rather than an empty index - an entity,
	// the fact that drives every propagation artifact, and one relation. Idempotent along
	// with the rest of this function, thanks to revelation's own unique index per session.
	const sessionId = bySlug.get('session-1');
	const gildedRatId = bySlug.get('the-gilded-rat');
	const ashenLedgerId = bySlug.get('the-ashen-ledger');
	const memberRelationId = relationIdByKey.get('aldric-vane|member of|the-valdoria-watch');
	if (!sessionId || !gildedRatId || !ashenLedgerId || !memberRelationId) {
		throw new Error('fixture players-wiki seed data does not resolve');
	}
	await revealEntityLive(db, {
		universeId: world.id,
		entityId: aldricId,
		sessionEntityId: sessionId
	});
	await revealEntityLive(db, {
		universeId: world.id,
		entityId: gildedRatId,
		sessionEntityId: sessionId
	});
	// The Ashen Ledger carries the secret and gmnote blocks (#84's own worked example) -
	// revealing the entity itself, not just the fact, is what shows a secret staying hidden
	// even inside a fully public entry.
	await revealEntityLive(db, {
		universeId: world.id,
		entityId: ashenLedgerId,
		sessionEntityId: sessionId
	});
	await revealFactLive(db, {
		universeId: world.id,
		factId: dismissedFact.id,
		sessionEntityId: sessionId
	});
	await revealRelationLive(db, {
		universeId: world.id,
		relationId: memberRelationId,
		sessionEntityId: sessionId
	});

	// The derived case from SAMPLE-WORLD.md, so the universe switcher can show precedence
	// with real rows: the user's canon always wins over the base corpus (SPEC 4.1).
	const [derived] = await db
		.insert(universe)
		.values({
			ownerUserId: OWNER,
			name: 'Sword Coast (ours)',
			slug: 'sword-coast-ours',
			kind: 'derived',
			baseUniverseId: base.id,
			loremasterDescription: 'Ours first, the books second, and it says which is which.'
		})
		.returning({ id: universe.id });
	if (!derived) throw new Error('derived universe insert returned no row');
	await db.insert(universeMember).values({ universeId: derived.id, userId: OWNER, role: 'owner' });
	await db.insert(entity).values([
		{
			universeId: derived.id,
			type: 'place',
			name: 'Waterdeep',
			slug: 'waterdeep',
			body: 'Ours diverges from the published city in one way that matters: the Masked Lords are a fiction the guilds maintain, and three of them are dead.'
		},
		{
			universeId: derived.id,
			type: 'character',
			name: 'Laeral Silverhand',
			slug: 'laeral-silverhand',
			body: 'Open Lord in the books. Here she has been missing for a season and [[Waterdeep]] is pretending otherwise.'
		}
	]);

	return { universeId: world.id, entities: inserted.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	assertLocal(url);
	const db = createDb(url);
	const result = await seedFixture(db);
	console.log(`seeded Valdoria Reach: ${result.entities} entities, universe ${result.universeId}`);
	await closeDb(db);
}
