/**
 * Issue #648: an accept-time admission gap on a *shipped* relation type had no way out.
 *
 * #628 gave the refusal its facts (which pair, which type, which end is short, and
 * whether widening is possible at all) and the queue a widen-and-accept for the case the
 * GM owns the type. The shipped case kept the refusal and nothing else: `widenRelationType`
 * refuses a `universe_id`-null row on purpose, because a shipped key is API surface
 * (decision L1, #195), so there is no row an accept could widen and no button that would
 * be honest to offer. What a GM can have instead is their own version of that type, and
 * `resolveRelationType` already prefers one: `preferUniverseOwned` puts a universe's own
 * row ahead of the shipped one at rung 1.
 *
 * So this file owns two halves of one route. `forkShippedRelationType` is the write the
 * catalogue page now offers (#192's "a universe can add its own types", the half that was
 * never built), and the accept path applies the resolver's own preference one rung later,
 * so a proposal written *before* the fork existed still lands on it. Without the second
 * half the first is a write with no effect on the queue that asked for it: the proposal
 * names the shipped row and refuses again on the next click.
 *
 * Both halves fail on 9a8a4f8: `forkShippedRelationType` does not exist there, and the
 * accept path reads the named type's arrays only, so the fork case below refuses.
 *
 * Reachable in principle and unobserved in the corpus, which is worth stating rather than
 * leaving to a reader: #628's own note records that after its inverse-label fix, four
 * replays of the OneNote recording produced no shipped-type refusal at all. Every case
 * here is built from the shape #628 measured before that fix (`member of` admitting only
 * character -> faction, met by a faction -> character link), not from a run.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	acceptProposal,
	closeDb,
	createProposalPlan,
	forkShippedRelationType,
	undoAcceptedProposal,
	widenRelationType,
	RelationTypeLabelConflictError,
	RelationTypeNotAdmittedError,
	RelationTypeNotShippedError,
	type Db,
	type ProposalRow
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { relation, relationType } from '../src/schema/relation.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('a shipped relation type that fails admission at accept time (issue #648)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function shippedType(label: string) {
		const [row] = await db
			.select()
			.from(relationType)
			.where(and(eq(relationType.label, label), isNull(relationType.universeId)))
			.limit(1);
		if (!row) throw new Error(`no shipped "${label}" relation type`);
		return row;
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
				slug: unique(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
				aliases: [],
				body: `${name} exists.`
			})
			.returning({ id: entity.id });
		if (!row) throw new Error('entity insert returned no row');
		return row.id;
	}

	/** One pending `relation` proposal between two entities that already exist, which is
	 * the shape an import's relation reaches its own accept in once both ends are real. */
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
					evidence: { documentId: 'doc-1' },
					rank: 0
				}
			]
		});
		const [link] = proposals;
		if (!link) throw new Error('plan did not return the relation proposal');
		return link;
	}

	it("copies the shipped type's own words and widens only the copy", async () => {
		const u = await insertHomebrewUniverse(db);
		const shipped = await shippedType('member of');

		const fork = await forkShippedRelationType(db, u.id, shipped.id, {
			addFrom: ['faction'],
			addTo: ['character']
		});

		// The fork reads as the same relation, not as a fourth synonym: label, inverse label
		// and cardinality are the shipped row's, which is the same choice `resolveAdmissionGap`
		// makes when it proposes this fork at propose time.
		expect(fork.universeId).toBe(u.id);
		expect(fork.label).toBe(shipped.label);
		expect(fork.inverseLabel).toBe(shipped.inverseLabel);
		expect(fork.cardinality).toBe(shipped.cardinality);
		// Its key is derived from that same label by the schema's own trigger, so the i18n
		// bundle (#196) renders the fork in the catalogue's words rather than as raw English.
		expect(fork.key).toBe(shipped.key);
		// Admits everything the shipped type did, plus the pair asked for.
		expect(fork.allowedFrom).toEqual(expect.arrayContaining([...shipped.allowedFrom, 'faction']));
		expect(fork.allowedTo).toEqual(expect.arrayContaining([...shipped.allowedTo, 'character']));

		// And the shipped row itself is untouched, which is the whole reason this is a fork.
		const stillShipped = await shippedType('member of');
		expect(stillShipped.allowedFrom).toEqual(shipped.allowedFrom);
		expect(stillShipped.allowedTo).toEqual(shipped.allowedTo);
	});

	it('refuses to fork a row that is not the shipped catalogue', async () => {
		const u = await insertHomebrewUniverse(db);
		const shipped = await shippedType('protects');
		const own = await forkShippedRelationType(db, u.id, shipped.id, { addTo: ['item'] });

		// Forking a universe's own type is not a thing: that row can simply be widened.
		await expect(forkShippedRelationType(db, u.id, own.id, { addTo: ['event'] })).rejects.toThrow(
			RelationTypeNotShippedError
		);
	});

	it('refuses a second fork of the same type, because the first one can be widened', async () => {
		const u = await insertHomebrewUniverse(db);
		const shipped = await shippedType('owns');
		await forkShippedRelationType(db, u.id, shipped.id, { addTo: ['event'] });

		await expect(
			forkShippedRelationType(db, u.id, shipped.id, { addTo: ['session'] })
		).rejects.toThrow(RelationTypeLabelConflictError);
	});

	it("accepts the refused link against the GM's own version of the shipped type", async () => {
		const u = await insertHomebrewUniverse(db);
		// #628's own `member of` case: shipped "member of" admits character -> faction, and
		// the notebook read it backwards, so the accept meets faction -> character.
		const shipped = await shippedType('member of');
		const from = await realEntity(u.id, 'faction', 'X Astartes 5');
		const to = await realEntity(u.id, 'character', 'Myra');
		const link = await pendingRelation(u.id, shipped.id, from, to);

		const refusal = await acceptProposal(db, { proposalId: link.id }).then(
			() => null,
			(err: unknown) => err
		);
		if (!(refusal instanceof RelationTypeNotAdmittedError)) throw new Error('expected a refusal');
		expect(refusal.shipped).toBe(true);
		expect(refusal.relationTypeId).toBe(shipped.id);

		// The GM takes the deliberate route the refusal points at: their own version of the
		// type, in the relation settings, admitting the pair this link needs.
		const fork = await forkShippedRelationType(db, u.id, shipped.id, {
			...(refusal.addFrom ? { addFrom: [refusal.addFrom] } : {}),
			...(refusal.addTo ? { addTo: [refusal.addTo] } : {})
		});

		const accepted = await acceptProposal(db, { proposalId: link.id });
		expect(accepted.outcome).toBe('accepted');
		// Written against the fork, never against the shipped row.
		expect(accepted.relationTypeId).toBe(fork.id);
		const rows = await db.select().from(relation).where(eq(relation.universeId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.relationTypeId).toBe(fork.id);
		// Still an AI-authored row a human accepted, which is the only thing the fork must
		// not change about it (guardrail 2).
		expect(rows[0]?.authorKind).toBe('ai_accepted');

		// And the undo still finds it: the accept recorded which type it wrote with, so the
		// delete matches on the fork rather than on the row the proposal originally named.
		await undoAcceptedProposal(db, { proposalId: link.id });
		const afterUndo = await db.select().from(relation).where(eq(relation.universeId, u.id));
		expect(afterUndo).toHaveLength(0);
	});

	it('names the fork, not the shipped row, when the fork does not admit the pair either', async () => {
		const u = await insertHomebrewUniverse(db);
		const shipped = await shippedType('member of');
		// A fork this universe made earlier, for a different pair.
		const fork = await forkShippedRelationType(db, u.id, shipped.id, { addTo: ['item'] });
		const from = await realEntity(u.id, 'faction', 'Culto di Nerzhul');
		const to = await realEntity(u.id, 'character', 'Thanaak');
		const link = await pendingRelation(u.id, shipped.id, from, to);

		const refusal = await acceptProposal(db, { proposalId: link.id }).then(
			() => null,
			(err: unknown) => err
		);
		if (!(refusal instanceof RelationTypeNotAdmittedError)) throw new Error('expected a refusal');
		// The refusal names the row the GM can actually act on, so the queue offers its
		// ordinary widen-and-accept instead of the shipped dead end.
		expect(refusal.relationTypeId).toBe(fork.id);
		expect(refusal.shipped).toBe(false);
		expect(refusal.addFrom).toBe('faction');

		await widenRelationType(db, u.id, fork.id, {
			...(refusal.addFrom ? { addFrom: [refusal.addFrom] } : {}),
			...(refusal.addTo ? { addTo: [refusal.addTo] } : {})
		});
		const accepted = await acceptProposal(db, { proposalId: link.id });
		expect(accepted.outcome).toBe('accepted');
	});

	it('leaves a pair the shipped type already admits on the shipped type', async () => {
		// The guard on the whole change: the fork is only ever consulted where the accept
		// would otherwise refuse, so a universe owning a fork never moves a link that the
		// shipped catalogue was happy to carry.
		const u = await insertHomebrewUniverse(db);
		const shipped = await shippedType('member of');
		await forkShippedRelationType(db, u.id, shipped.id, { addFrom: ['faction'] });
		const from = await realEntity(u.id, 'character', 'Aldric Vane');
		const to = await realEntity(u.id, 'faction', 'La Corona di Ferro');
		const link = await pendingRelation(u.id, shipped.id, from, to);

		const accepted = await acceptProposal(db, { proposalId: link.id });
		expect(accepted.outcome).toBe('accepted');
		expect(accepted.relationTypeId).toBe(shipped.id);
		const rows = await db.select().from(relation).where(eq(relation.universeId, u.id));
		expect(rows[0]?.relationTypeId).toBe(shipped.id);
	});
});
