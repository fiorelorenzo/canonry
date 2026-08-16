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
 *
 * #198 adds one more direct human write of the same kind: `setRelationTypeLabel` /
 * `clearRelationTypeLabel` let a GM author a per-locale reading of their own type, from
 * the catalogue page, right next to rename/widen/merge above. Ownership-checked the
 * same way, and not a proposal either - the model-authored half of #198 (a copilot
 * proposing a translation, accepted or rejected like any other queue item) is
 * deliberately not built here; see #198's own tracking note for what that would need.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { AuthorKind, EntityType, RelationCardinality } from '../schema/enums.js';
import { relation, relationType, relationTypeLabel } from '../schema/relation.js';

export type RelationTypeRow = typeof relationType.$inferSelect;

export type RelationTypeLabelRow = typeof relationTypeLabel.$inferSelect;

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
	/** #198: this type's own per-locale translations, keyed by locale. `null` for a
	 * universe's own type nobody has translated yet, and always `null` for a shipped
	 * type - the migration's `relation_type_label_owned_only_trigger` makes a row here
	 * for one structurally impossible, so this column needs no separate "is this
	 * shipped" branch to stay empty for the shipped ten.
	 * `relationTypeDisplayLabel`/`relationTypeDisplayInverseLabel`
	 * (apps/web's `components/relations/types.ts`) read this, for the active locale,
	 * before falling back to `label`/`inverseLabel` above. */
	labels: Record<string, { label: string; inverseLabel: string; authorKind: AuthorKind }> | null;
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
	// #198: every locale this type has been translated into, as one JSON object keyed
	// by locale. `jsonb_object_agg` returns null over zero rows, which is exactly
	// "nothing translated yet" and matches `labels`'s `| null` type - a shipped row
	// (structurally impossible to have any, per the migration's trigger) and an
	// untranslated own type read identically, with no separate branch for either. Same
	// unaliased `"relation_type"."id"` correlation as `usageCount` above, for the same
	// reason.
	const labels = sql<Record<
		string,
		{ label: string; inverseLabel: string; authorKind: AuthorKind }
	> | null>`(
		select jsonb_object_agg(
			${relationTypeLabel.locale},
			jsonb_build_object(
				'label', ${relationTypeLabel.label},
				'inverseLabel', ${relationTypeLabel.inverseLabel},
				'authorKind', ${relationTypeLabel.authorKind}
			)
		)
		from ${relationTypeLabel}
		where ${relationTypeLabel.relationTypeId} = "relation_type"."id"
	)`;
	return db
		.select({
			id: relationType.id,
			universeId: relationType.universeId,
			key: relationType.key,
			label: relationType.label,
			inverseLabel: relationType.inverseLabel,
			cardinality: relationType.cardinality,
			allowedFrom: relationType.allowedFrom,
			allowedTo: relationType.allowedTo,
			createdAt: relationType.createdAt,
			usageCount,
			labels
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
 * else stores a label copy. `.set()` below only ever writes `label`/`inverseLabel`, never
 * `key` - issue #195's whole point: renaming a type must not orphan it from its own
 * history (its relations, its evidence paths, its rejection history), and identity lives
 * on `key` now, not on the words being renamed. Scoped by `universe_id = universeId` in
 * the same query as the id match, so a shipped row or another universe's row can never
 * match: this throws `RelationTypeNotOwnedError` rather than silently updating nothing. */
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

// ---------------------------------------------------------------------------
// #198: a universe's own type's per-locale translations. The GM-written half only -
// `authorKind` is exposed on the input so an accepted copilot proposal could call this
// same function with `'ai_accepted'` the day that half exists, but nothing here drafts
// or accepts a proposal itself. See this file's module doc for why that half is not
// built yet.
// ---------------------------------------------------------------------------

export interface SetRelationTypeLabelInput {
	locale: string;
	label: string;
	inverseLabel: string;
	authorKind: AuthorKind;
}

/** Writes (or revises) one locale's translation of a universe's own type - the whole of
 * #198's interactive path, called once per locale the catalogue page's translate form
 * submits. Ownership-checked the same way rename/widen/merge are: scoped to
 * `relation_type.universe_id = universeId` before the write, so neither a shipped type
 * nor another universe's type can gain a row here (the migration's
 * `relation_type_label_owned_only_trigger` is the second, unconditional guard against
 * the shipped half specifically - this check exists so a mismatched write reports
 * `RelationTypeNotOwnedError` instead of a raw trigger exception). `onConflictDoUpdate`
 * on the `(relation_type_id, locale)` unique constraint makes a second save for the
 * same locale a revision of the one row, never a duplicate next to it. */
export async function setRelationTypeLabel(
	db: Db,
	universeId: string,
	typeId: string,
	input: SetRelationTypeLabelInput
): Promise<RelationTypeLabelRow> {
	const [owned] = await db
		.select({ id: relationType.id })
		.from(relationType)
		.where(and(eq(relationType.id, typeId), eq(relationType.universeId, universeId)))
		.limit(1);
	if (!owned) throw new RelationTypeNotOwnedError(typeId, universeId);

	const [row] = await db
		.insert(relationTypeLabel)
		.values({
			relationTypeId: typeId,
			locale: input.locale,
			label: input.label,
			inverseLabel: input.inverseLabel,
			authorKind: input.authorKind
		})
		.onConflictDoUpdate({
			target: [relationTypeLabel.relationTypeId, relationTypeLabel.locale],
			set: {
				label: input.label,
				inverseLabel: input.inverseLabel,
				authorKind: input.authorKind,
				updatedAt: sql`now()`
			}
		})
		.returning();
	if (!row) throw new RelationTypeNotOwnedError(typeId, universeId);
	return row;
}

/** Clears one locale's translation - a GM emptying both fields back to "no translation
 * here", which is display fallback to the authored label, never a translation of the
 * empty string. Ownership-checked the same way `setRelationTypeLabel` is. Deleting a
 * locale that was never translated is a no-op, not an error: the catalogue page's
 * translate form always submits every shipped locale's pair, whether or not each one
 * has a saved row yet, so "nothing to delete" is the ordinary case for most locales on
 * most submits. */
export async function clearRelationTypeLabel(
	db: Db,
	universeId: string,
	typeId: string,
	locale: string
): Promise<void> {
	const [owned] = await db
		.select({ id: relationType.id })
		.from(relationType)
		.where(and(eq(relationType.id, typeId), eq(relationType.universeId, universeId)))
		.limit(1);
	if (!owned) throw new RelationTypeNotOwnedError(typeId, universeId);

	await db
		.delete(relationTypeLabel)
		.where(and(eq(relationTypeLabel.relationTypeId, typeId), eq(relationTypeLabel.locale, locale)));
}
