/**
 * Issue #628: a relation type is sized from the endpoint types the model *proposed*, while
 * #191's admission check runs at accept time against the endpoints' *real* types.
 *
 * The two propose-time causes of that disagreement are fixed upstream, in
 * `packages/copilot`'s resolver and `packages/import`'s job runner, and
 * `packages/import/src/job-runner-relation-sizing.test.ts` owns those. What this file owns
 * is the residue that only accept time can see, and it is genuinely irreducible: an
 * endpoint's type is not final until the GM has accepted the entry, so a type sized before
 * that can always be met by something else. Two ways in, both real:
 *
 *   - a `create` proposal's declared type changes before it is accepted, which is what a GM
 *     retyping an entry in the queue does, and what a slug-collision fold (#160) does by
 *     itself when a later document's create lands on an entity another document already
 *     made under a different type;
 *   - the relation type is the shipped catalogue's, which no accept may widen at all.
 *
 * The refusal stays, because #191 is right: a relation type is content and a pair a type
 * does not admit must not be written. What these cases defend is that the refusal now says
 * which end is short, by how much, and whether widening is even possible, so a GM ends with
 * a question they can answer rather than a failed click.
 *
 * Every case here fails on f94c9d7: `RelationTypeNotAdmittedError` took four constructor
 * arguments and carried no fields at all, so the assertions below do not compile there, let
 * alone pass. That is the same shape #613's own db-level file has against its predecessor.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	acceptProposal,
	closeDb,
	createProposalPlan,
	recordProposalDiff,
	widenRelationType,
	RelationTypeNotAdmittedError,
	type Db,
	type ProposalRow
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType } from '../src/schema/relation.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe("a relation whose type does not admit its endpoints' real types (issue #628)", () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function shippedTypeId(label: string): Promise<string> {
		const [row] = await db
			.select({ id: relationType.id })
			.from(relationType)
			.where(and(eq(relationType.label, label)))
			.limit(1);
		if (!row) throw new Error(`no shipped "${label}" relation type`);
		return row.id;
	}

	/** A type this universe owns, so an accept-time gap on it is widenable. */
	async function ownType(
		universeId: string,
		allowedFrom: Array<'character' | 'place' | 'faction' | 'item'>,
		allowedTo: Array<'character' | 'place' | 'faction' | 'item'>
	): Promise<string> {
		const [row] = await db
			.insert(relationType)
			.values({
				universeId,
				label: unique('capo di'),
				inverseLabel: 'ha come capo',
				cardinality: 'many_to_one',
				allowedFrom,
				allowedTo
			})
			.returning({ id: relationType.id });
		if (!row) throw new Error('relation type insert returned no row');
		return row.id;
	}

	async function realEntity(
		universeId: string,
		type: 'character' | 'place' | 'faction' | 'item',
		name: string
	): Promise<string> {
		const [row] = await db
			.insert(entity)
			.values({
				universeId,
				type,
				name,
				slug: unique(name.toLowerCase()),
				aliases: [],
				body: `${name} exists.`
			})
			.returning({ id: entity.id });
		if (!row) throw new Error('entity insert returned no row');
		return row.id;
	}

	/** One pending `relation` proposal between two entities that already exist, which is
	 * every relation an import unblocks once the entries at its ends are accepted. */
	async function pendingRelation(
		universeId: string,
		typeId: string,
		fromEntityId: string,
		toEntityId: string
	): Promise<ProposalRow> {
		const { proposals } = await createProposalPlan(db, {
			universeId,
			trigger: 'import',
			summary: 'Import: one link.',
			candidateCap: 1,
			estimatedCredits: 0,
			candidates: [
				{
					kind: 'relation',
					targetEntityId: fromEntityId,
					relationTypeId: typeId,
					relatedEntityId: toEntityId,
					rationale: 'the page says so',
					evidence: { documentId: 'doc-76' },
					rank: 0
				}
			]
		});
		const [link] = proposals;
		if (!link) throw new Error('plan did not return the relation proposal');
		return link;
	}

	it('names which end is short, by how much, and that the type can be widened', async () => {
		const u = await insertHomebrewUniverse(db);
		// "capo di" as an import would have sized it from a document that called the Eye a
		// faction: character -> {place, faction}.
		const typeId = await ownType(u.id, ['character'], ['place', 'faction']);
		const from = await realEntity(u.id, 'character', 'Nezznar il Ragno Nero');
		// What the entity actually turned out to be.
		const to = await realEntity(u.id, 'item', 'Occhio di Nerzhul');
		const link = await pendingRelation(u.id, typeId, from, to);

		const error = await acceptProposal(db, { proposalId: link.id }).then(
			() => null,
			(err: unknown) => err
		);

		expect(error).toBeInstanceOf(RelationTypeNotAdmittedError);
		if (!(error instanceof RelationTypeNotAdmittedError)) throw new Error('unreachable');
		expect(error.relationTypeId).toBe(typeId);
		expect(error.fromType).toBe('character');
		expect(error.toType).toBe('item');
		// The `from` end is admitted, so only the `to` end is named: a GM asked to widen both
		// would be asked to allow something the type already allows.
		expect(error.addFrom).toBeNull();
		expect(error.addTo).toBe('item');
		expect(error.shipped).toBe(false);

		// Guardrail 1: the refusal wrote nothing.
		const rows = await db.select().from(relation).where(eq(relation.universeId, u.id));
		expect(rows).toHaveLength(0);
	});

	it('names both ends when neither is admitted', async () => {
		const u = await insertHomebrewUniverse(db);
		const typeId = await ownType(u.id, ['faction'], ['faction']);
		const from = await realEntity(u.id, 'place', 'Martello di Korr');
		const to = await realEntity(u.id, 'character', 'Korr il Magnanimo');
		const link = await pendingRelation(u.id, typeId, from, to);

		const error = await acceptProposal(db, { proposalId: link.id }).then(
			() => null,
			(err: unknown) => err
		);

		if (!(error instanceof RelationTypeNotAdmittedError)) throw new Error('expected a refusal');
		expect(error.addFrom).toBe('place');
		expect(error.addTo).toBe('character');
	});

	it('says a shipped type cannot be widened, because only a release changes one', async () => {
		const u = await insertHomebrewUniverse(db);
		// Shipped "member of" admits character -> faction. Read backwards it is a faction
		// related to a character, which is #628's own `member of` case at this layer.
		const typeId = await shippedTypeId('member of');
		const from = await realEntity(u.id, 'faction', 'X Astartes 5');
		const to = await realEntity(u.id, 'character', 'Myra');
		const link = await pendingRelation(u.id, typeId, from, to);

		const error = await acceptProposal(db, { proposalId: link.id }).then(
			() => null,
			(err: unknown) => err
		);

		if (!(error instanceof RelationTypeNotAdmittedError)) throw new Error('expected a refusal');
		expect(error.shipped).toBe(true);
		expect(error.typeLabel).toBe('member of');
		expect(error.addFrom).toBe('faction');
		expect(error.addTo).toBe('character');
	});

	it('accepts once the GM widens the type by exactly what the refusal named', async () => {
		const u = await insertHomebrewUniverse(db);
		const typeId = await ownType(u.id, ['character'], ['place', 'faction']);
		const from = await realEntity(u.id, 'character', 'Thanaak il Contagiato');
		const to = await realEntity(u.id, 'item', 'Occhio di Nerzhul');
		const link = await pendingRelation(u.id, typeId, from, to);

		const error = await acceptProposal(db, { proposalId: link.id }).then(
			() => null,
			(err: unknown) => err
		);
		if (!(error instanceof RelationTypeNotAdmittedError)) throw new Error('expected a refusal');

		// The GM answers the question the refusal asked, which is what the review queue's own
		// widen-and-accept posts.
		await widenRelationType(db, u.id, error.relationTypeId, {
			...(error.addFrom ? { addFrom: [error.addFrom] } : {}),
			...(error.addTo ? { addTo: [error.addTo] } : {})
		});
		const accepted = await acceptProposal(db, { proposalId: link.id });

		expect(accepted.outcome).toBe('accepted');
		const rows = await db.select().from(relation).where(eq(relation.universeId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.fromEntityId).toBe(from);
		expect(rows[0]?.toEntityId).toBe(to);
		// Still an AI-authored row that a human accepted, not a human-authored one.
		expect(rows[0]?.authorKind).toBe('ai_accepted');
	});

	it('refuses when the GM retypes the entry at an end before accepting it', async () => {
		// The case the issue names, and the same divergence a slug-collision fold (#160)
		// produces on its own: the relation type was sized against the type the create
		// declared, and the entity that ends up at that end is a different one.
		const u = await insertHomebrewUniverse(db);
		const typeId = await ownType(u.id, ['character'], ['faction']);
		const from = await realEntity(u.id, 'character', "Zer'Al'Ghul");

		const { proposals } = await createProposalPlan(db, {
			universeId: u.id,
			trigger: 'import',
			summary: 'Import: one entry and one link.',
			candidateCap: 2,
			estimatedCredits: 0,
			candidates: [
				{ kind: 'create', targetEntityId: null, rationale: 'extracted', evidence: {}, rank: 0 },
				{
					kind: 'relation',
					targetEntityId: from,
					relationTypeId: typeId,
					relatedEntityId: null,
					relatedEntityProposalIndex: 0,
					rationale: 'the page says so',
					evidence: { documentId: 'doc-76' },
					rank: 1
				}
			]
		});
		const [create, link] = proposals;
		if (!create || !link) throw new Error('plan did not return two proposals');

		// What the import declared, and what the type was therefore sized for.
		const slug = unique('occhio-di-nerzhul');
		await recordProposalDiff(db, {
			proposalId: create.id,
			patch: {
				type: 'faction',
				name: 'Occhio di Nerzhul',
				slug,
				aliases: [],
				body: 'A cult, the import thought.'
			},
			provider: 'import',
			modelId: 'onenote',
			credits: 0
		});
		// The GM decides it is an artifact, not a cult, and retypes it before accepting.
		await recordProposalDiff(db, {
			proposalId: create.id,
			patch: {
				type: 'item',
				name: 'Occhio di Nerzhul',
				slug,
				aliases: [],
				body: 'A cult, the import thought.'
			},
			provider: 'import',
			modelId: 'onenote',
			credits: 0
		});

		const createdEntry = await acceptProposal(db, { proposalId: create.id });
		expect(createdEntry.outcome).toBe('accepted');
		const [created] = await db
			.select({ type: entity.type })
			.from(entity)
			.where(and(eq(entity.universeId, u.id), eq(entity.slug, slug)))
			.limit(1);
		expect(created?.type).toBe('item');

		const error = await acceptProposal(db, { proposalId: link.id }).then(
			() => null,
			(err: unknown) => err
		);

		if (!(error instanceof RelationTypeNotAdmittedError)) throw new Error('expected a refusal');
		// Sized for a faction at that end, met an item, and the refusal says exactly that
		// rather than "cannot be accepted".
		expect(error.addTo).toBe('item');
		expect(error.addFrom).toBeNull();
		expect(error.shipped).toBe(false);
	});
});
