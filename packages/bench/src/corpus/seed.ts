/**
 * Putting a rendered world into Postgres.
 *
 * Two callers need this and they need it for different reasons. The Loremaster bench and
 * the Loremaster end-to-end run need a universe that already holds canon, because ask,
 * complete, propagate and audit all read the graph. The import end-to-end run needs the
 * opposite, an empty universe it can import into, and then needs to compare what the
 * import produced against this same world. So the world is the single source both sides
 * are measured against, and this file is the only place that writes it.
 *
 * Idempotent by deleting the universe's entities first, the same shape
 * `packages/db/src/seed-fixture.ts` uses. It does not delete the universe, because the
 * fixture user's balance and the bench's own `model_call` history hang off it.
 */
import { and, eq, inArray, type Db } from '@canonry/db';
import { entity, relation, relationType, revision } from '@canonry/db/schema';
import { detectLanguage } from '@canonry/lang';
import { markdownBody, type World } from './types.js';

export interface SeedResult {
	universeId: string;
	entities: number;
	relations: number;
	/** Relations the shipped `relation_type` catalogue cannot express, dropped rather than
	 * invented. Reported rather than swallowed: an edge the product cannot store is a
	 * finding about the catalogue, not a detail of the fixture. */
	droppedRelations: string[];
	idBySlug: Map<string, string>;
}

export async function seedWorld(db: Db, universeId: string, world: World): Promise<SeedResult> {
	await db.delete(entity).where(eq(entity.universeId, universeId));

	const inserted = await db
		.insert(entity)
		.values(
			world.entities.map((e) => {
				const body = markdownBody(e);
				return {
					universeId,
					type: e.type,
					name: e.name,
					slug: e.slug,
					aliases: e.aliases,
					body,
					// The seed runs detection exactly as a real save does, rather than trusting
					// the corpus's own `language` field: a fixture that hand-sets what the
					// product detects would hide a detector regression behind the fixture.
					language: detectLanguage(body),
					languageSource: 'detected' as const
				};
			})
		)
		.returning({ id: entity.id, slug: entity.slug });

	const idBySlug = new Map(inserted.map((row) => [row.slug, row.id]));

	// Every entity gets a first revision, human-authored, so `revision.author_kind` has a
	// baseline to contrast an accepted proposal against and `checkFreshness` has something
	// to fingerprint.
	await db.insert(revision).values(
		world.entities.map((e) => ({
			universeId,
			entityId: idBySlug.get(e.slug)!,
			authorKind: 'human' as const,
			name: e.name,
			aliases: e.aliases,
			body: markdownBody(e)
		}))
	);

	const catalogue = await db
		.select({ id: relationType.id, label: relationType.label })
		.from(relationType);
	const typeByLabel = new Map(catalogue.map((row) => [row.label, row.id]));

	const droppedRelations: string[] = [];
	const rows: Array<{
		universeId: string;
		relationTypeId: string;
		fromEntityId: string;
		toEntityId: string;
		authorKind: 'human';
	}> = [];
	for (const r of world.relations) {
		const typeId = typeByLabel.get(r.label);
		const fromId = idBySlug.get(r.from);
		const toId = idBySlug.get(r.to);
		if (!typeId || !fromId || !toId) {
			droppedRelations.push(`${r.from} ${r.label} ${r.to}`);
			continue;
		}
		rows.push({
			universeId,
			relationTypeId: typeId,
			fromEntityId: fromId,
			toEntityId: toId,
			authorKind: 'human'
		});
	}
	if (rows.length > 0) await db.insert(relation).values(rows);

	return {
		universeId,
		entities: inserted.length,
		relations: rows.length,
		droppedRelations,
		idBySlug
	};
}

/** Empties the universe of canon without touching the universe row itself, for the import
 * run that has to start from nothing and build the world out of an export. */
export async function clearWorld(db: Db, universeId: string): Promise<void> {
	await db.delete(entity).where(eq(entity.universeId, universeId));
}

/** Entity ids for a set of slugs in an already-seeded universe. */
export async function idsForSlugs(
	db: Db,
	universeId: string,
	slugs: string[]
): Promise<Map<string, string>> {
	if (slugs.length === 0) return new Map();
	const rows = await db
		.select({ id: entity.id, slug: entity.slug })
		.from(entity)
		.where(and(eq(entity.universeId, universeId), inArray(entity.slug, slugs)));
	return new Map(rows.map((row) => [row.slug, row.id]));
}
