/**
 * SPEC.md §4.2's catalogue, decision K1 (DECISIONS.md "Round six"): relation types are
 * free labels, reconciled. This file is shared by agreement between two issues: #189's
 * resolver read path (`relationTypesForUniverse`, added alongside this comment) and
 * #192's settings page below it - the plain GM-initiated CRUD behind the catalogue a GM
 * can see: list with usage counts, rename, merge, widen. Nothing below is a proposal and
 * none of it touches guardrail 1 - a GM reading the catalogue directly and renaming,
 * merging or widening their own universe's types is a direct human action, the same kind
 * of write accepting an import proposal already is, not a model output landing unreviewed.
 *
 * The shipped catalogue (`relation_type.universe_id` null) is never written by anything
 * here. Every mutation below filters on `relation_type.universe_id = universeId`, so a
 * shipped row structurally cannot match and be renamed, widened or merged away - that is
 * enforced by the query shape, not left to a caller to remember. Adding to the shipped
 * ten stays a migration's job (0001_seed_relation_type_catalogue.sql,
 * 0029_containment_and_protects_relations.sql).
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { EntityType, RelationCardinality } from '../schema/enums.js';
import { relation, relationType } from '../schema/relation.js';

export type RelationTypeRow = typeof relationType.$inferSelect;

/** #189's own read: every relation type a label proposed in `universeId` could
 * legitimately match - the shipped catalogue plus this universe's own types, in one
 * unordered set. Deliberately no usage count and no ordering guarantee (unlike
 * `listRelationTypesForUniverse` below, #192's settings-page read) - the resolver
 * (packages/copilot/src/relation-types.ts) decides preference among candidates itself,
 * this call is only the read. */
export async function relationTypesForUniverse(
	db: Db,
	universeId: string
): Promise<RelationTypeRow[]> {
	return db
		.select()
		.from(relationType)
		.where(or(isNull(relationType.universeId), eq(relationType.universeId, universeId)));
}

// ---------------------------------------------------------------------------
// #192's settings page: every type a universe can use, with a real usage count, then
// rename, merge and widen for a universe's own types.
// ---------------------------------------------------------------------------

export interface RelationTypeCatalogueRow extends RelationTypeRow {
	/** Relations in *this* universe using this type - a shipped type is counted per
	 * universe, not globally, since two universes both using "commands" do not share a
	 * count any more than they share canon. */
	usageCount: number;
}

/** Every type a universe can use: the shipped catalogue plus its own, each carrying its
 * usage count. Shipped rows sort first (so the read-only half of the page renders as one
 * block), then alphabetically by label within each half. */
export async function listRelationTypesForUniverse(
	db: Db,
	universeId: string
): Promise<RelationTypeCatalogueRow[]> {
	// `"relation_type"."id"` is written as a literal rather than `${relationType.id}`
	// interpolated: drizzle renders an unaliased column reference as a bare
	// `"id"`, and `relation` has its own `id` column in scope inside this
	// subquery, so an interpolated reference here silently correlates against the
	// wrong table (every count came back 0 before this was qualified explicitly -
	// caught by driving the page against valdoria-reach's real relations, #192).
	const usageCount = sql<number>`(
		select count(*)::int from ${relation}
		where ${relation.relationTypeId} = "relation_type"."id"
		and ${relation.universeId} = ${universeId}
	)`;
	return db
		.select({
			id: relationType.id,
			universeId: relationType.universeId,
			label: relationType.label,
			inverseLabel: relationType.inverseLabel,
			cardinality: relationType.cardinality,
			allowedFrom: relationType.allowedFrom,
			allowedTo: relationType.allowedTo,
			createdAt: relationType.createdAt,
			usageCount
		})
		.from(relationType)
		.where(or(isNull(relationType.universeId), eq(relationType.universeId, universeId)))
		.orderBy(sql`${relationType.universeId} is null desc`, relationType.label);
}

export class RelationTypeNotOwnedError extends Error {
	constructor(typeId: string, universeId: string) {
		super(`relation_type "${typeId}" is not a type universe "${universeId}" owns`);
		this.name = 'RelationTypeNotOwnedError';
	}
}

export class RelationTypeLabelConflictError extends Error {
	constructor(universeId: string, label: string) {
		super(`universe "${universeId}" already has a relation type labelled "${label}"`);
		this.name = 'RelationTypeLabelConflictError';
	}
}

function isUniqueViolation(err: unknown): boolean {
	const cause = err instanceof Error ? err.cause : err;
	if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
	return cause.code === '23505';
}

export interface RenameRelationTypeInput {
	label: string;
	inverseLabel: string;
}

/** Renames a universe's own type. One row holds both labels (SPEC.md §4.2's "one row,
 * never two, so the two sides cannot drift apart"), so this is the only place either one
 * changes, and every relation using the type shows the new wording immediately - nothing
 * else stores a label copy. Scoped by `universe_id = universeId` in the same query as the
 * id match, so a shipped row or another universe's row can never match: this throws
 * `RelationTypeNotOwnedError` rather than silently updating nothing. */
export async function renameRelationType(
	db: Db,
	universeId: string,
	typeId: string,
	input: RenameRelationTypeInput
): Promise<RelationTypeRow> {
	try {
		const [updated] = await db
			.update(relationType)
			.set({ label: input.label, inverseLabel: input.inverseLabel })
			.where(and(eq(relationType.id, typeId), eq(relationType.universeId, universeId)))
			.returning();
		if (!updated) throw new RelationTypeNotOwnedError(typeId, universeId);
		return updated;
	} catch (err) {
		if (err instanceof RelationTypeNotOwnedError) throw err;
		if (isUniqueViolation(err)) throw new RelationTypeLabelConflictError(universeId, input.label);
		throw err;
	}
}

export interface WidenRelationTypeInput {
	addFrom?: EntityType[];
	addTo?: EntityType[];
}

/** Adds entity types to a universe's own type's `allowed_from`/`allowed_to` - the manual
 * half of the resolver's `widen-proposed` (#189), and #191's constraint made real: these
 * arrays are read at the write (packages/copilot's accept path) rather than only seeded
 * and ignored. Only ever grows the arrays - reads the row first and unions in JS rather
 * than a blind array append, so asking to add a type that is already there is a no-op
 * instead of a duplicate entry. */
export async function widenRelationType(
	db: Db,
	universeId: string,
	typeId: string,
	input: WidenRelationTypeInput
): Promise<RelationTypeRow> {
	const [existing] = await db
		.select()
		.from(relationType)
		.where(and(eq(relationType.id, typeId), eq(relationType.universeId, universeId)))
		.limit(1);
	if (!existing) throw new RelationTypeNotOwnedError(typeId, universeId);

	const allowedFrom = [...new Set([...existing.allowedFrom, ...(input.addFrom ?? [])])];
	const allowedTo = [...new Set([...existing.allowedTo, ...(input.addTo ?? [])])];

	const [updated] = await db
		.update(relationType)
		.set({ allowedFrom, allowedTo })
		.where(eq(relationType.id, typeId))
		.returning();
	if (!updated) throw new RelationTypeNotOwnedError(typeId, universeId);
	return updated;
}

export interface MergeRelationTypesInput {
	/** The losing type. Must be a type this universe owns - the shipped catalogue can
	 * never be merged away through this function. */
	fromTypeId: string;
	/** The surviving type. May be shipped or the universe's own: merging *into* a type
	 * never writes to that type's own row, only to the relations that move onto it, so
	 * the "shipped catalogue is read-only from here" rule is not broken by using one as
	 * a merge target. */
	intoTypeId: string;
}

export interface MergeRelationTypesResult {
	movedCount: number;
	dedupedCount: number;
	intoType: RelationTypeRow;
}

/** Merges `fromTypeId` into `intoTypeId`: every `relation` row using the losing type is
 * repointed at the surviving one, then the losing type is deleted. A relation that would
 * collide with one `intoTypeId` already has for the same pair of entities
 * (`relation_type_from_to_key`'s unique index) cannot move without violating it - those
 * are counted as `dedupedCount` and removed rather than erroring, because the fact they
 * represent already exists under the label being merged onto, so nothing is lost, only
 * consolidated. `movedCount + dedupedCount` always equals the losing type's usage count
 * going in, which is what a caller shows *before* calling this, and gets back confirmed
 * after. Runs in one transaction: a GM never sees a losing type deleted with its
 * relations still pointing at a row that no longer exists. */
export async function mergeRelationTypes(
	db: Db,
	universeId: string,
	input: MergeRelationTypesInput
): Promise<MergeRelationTypesResult> {
	if (input.fromTypeId === input.intoTypeId) {
		throw new Error('mergeRelationTypes: fromTypeId and intoTypeId must differ');
	}
	return db.transaction(async (tx) => {
		const [fromType] = await tx
			.select()
			.from(relationType)
			.where(and(eq(relationType.id, input.fromTypeId), eq(relationType.universeId, universeId)))
			.limit(1);
		if (!fromType) throw new RelationTypeNotOwnedError(input.fromTypeId, universeId);

		const [intoType] = await tx
			.select()
			.from(relationType)
			.where(
				and(
					eq(relationType.id, input.intoTypeId),
					or(isNull(relationType.universeId), eq(relationType.universeId, universeId))
				)
			)
			.limit(1);
		if (!intoType) throw new RelationTypeNotOwnedError(input.intoTypeId, universeId);

		const [losingRows, survivingRows] = await Promise.all([
			tx
				.select({ id: relation.id, from: relation.fromEntityId, to: relation.toEntityId })
				.from(relation)
				.where(and(eq(relation.relationTypeId, fromType.id), eq(relation.universeId, universeId))),
			tx
				.select({ from: relation.fromEntityId, to: relation.toEntityId })
				.from(relation)
				.where(and(eq(relation.relationTypeId, intoType.id), eq(relation.universeId, universeId)))
		]);

		const survivingPairs = new Set(survivingRows.map((r) => `${r.from}:${r.to}`));
		const duplicateIds = losingRows
			.filter((r) => survivingPairs.has(`${r.from}:${r.to}`))
			.map((r) => r.id);
		const movableIds = losingRows
			.filter((r) => !survivingPairs.has(`${r.from}:${r.to}`))
			.map((r) => r.id);

		if (duplicateIds.length > 0) {
			await tx.delete(relation).where(inArray(relation.id, duplicateIds));
		}
		if (movableIds.length > 0) {
			await tx
				.update(relation)
				.set({ relationTypeId: intoType.id })
				.where(inArray(relation.id, movableIds));
		}
		await tx.delete(relationType).where(eq(relationType.id, fromType.id));

		return { movedCount: movableIds.length, dedupedCount: duplicateIds.length, intoType };
	});
}
