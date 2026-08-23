/**
 * C9 = B (`docs/ux/DECISIONS.md`; the drawn artifact is in git history at c84c8f8): "a badge on the entry,
 * reading the same flag list an aside section shows." `packages/copilot`'s `runAudit`
 * (issue #55) is the exclusive writer of a `proposal(trigger: 'audit', kind: 'flag')` row;
 * this module is the read side for the entry page - "application-shaped read composition
 * over already-exported tables and operators", the same territory
 * `$lib/server/proposals.ts`'s own header comment describes for its entity-scoped reads.
 * Kept as a separate file because that one belongs to ReviewSurfaces (#106), not because
 * the pattern differs.
 *
 * A flag touches two entities (`proposal.targetEntityId`, `proposal.relatedEntityId`), and
 * either one's entry page has to be able to find it - so this reads "pending flags where
 * `entityId` is on either side", not "flags this entity triggered".
 */
import { and, desc, eq, inArray, or, type Db, type ProposalRow } from '@canonry/db';
import { entity, proposal } from '@canonry/db/schema';
import type { AuditFlagStatement } from '@canonry/copilot';

export interface AuditFlagEntityRef {
	id: string;
	slug: string;
	name: string;
}

export interface OpenAuditFlag {
	proposal: ProposalRow;
	/** The pair `runAudit` wrote, in storage order: `statements[0]` is
	 * `proposal.targetEntityId`'s side, `statements[1]` is `relatedEntityId`'s (see
	 * `audit.ts`'s own header comment on that 1:1 mapping). Guardrail 3's evidence,
	 * verbatim - never re-derived from the entity's current body, which may have moved on
	 * since the flag was written. */
	statements: [AuditFlagStatement, AuditFlagStatement];
	/** Current name/slug for both sides, resolved fresh so a link never points at a stale
	 * slug even if a side was renamed after the flag was written. */
	entities: [AuditFlagEntityRef, AuditFlagEntityRef];
}

/** Open (pending) audit flags touching `entityId`, newest first - the badge's count and
 * the aside's list read the same query, exactly what C9 = B locks in. */
export async function openAuditFlagsForEntity(
	db: Db,
	universeId: string,
	entityId: string
): Promise<OpenAuditFlag[]> {
	const rows = await db
		.select()
		.from(proposal)
		.where(
			and(
				eq(proposal.universeId, universeId),
				eq(proposal.kind, 'flag'),
				eq(proposal.outcome, 'pending'),
				or(eq(proposal.targetEntityId, entityId), eq(proposal.relatedEntityId, entityId))
			)
		)
		.orderBy(desc(proposal.createdAt));

	if (rows.length === 0) return [];

	const otherIds = new Set<string>();
	for (const row of rows) {
		if (row.targetEntityId) otherIds.add(row.targetEntityId);
		if (row.relatedEntityId) otherIds.add(row.relatedEntityId);
	}
	const entityRows = await db
		.select({ id: entity.id, slug: entity.slug, name: entity.name })
		.from(entity)
		.where(inArray(entity.id, [...otherIds]));
	const byId = new Map(entityRows.map((e) => [e.id, e]));

	return rows.map((row) => {
		// The schema cascades the delete of both `targetEntityId` and `relatedEntityId` onto
		// this row (proposal.ts's own FK definitions), so a row read here always has both
		// entities still live - this is a programming error, not a data condition, if it
		// ever fails.
		const a = byId.get(row.targetEntityId ?? '');
		const b = byId.get(row.relatedEntityId ?? '');
		if (!a || !b) {
			throw new Error(`audit flag "${row.id}" references an entity that no longer exists`);
		}
		return {
			proposal: row,
			statements: row.evidence as [AuditFlagStatement, AuditFlagStatement],
			entities: [a, b]
		};
	});
}
