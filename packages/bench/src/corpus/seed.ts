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
 * `packages/db/src/seed-fixture.ts` uses - and, since issue #168 wired the bench to the
 * real per-entity `indexEntity` (`index-corpus.ts`), idempotent for entity *ids* too:
 * `entity.id` used to come from Postgres's own `defaultRandom()`, a fresh UUID on every
 * reseed. That was harmless while nothing downstream kept state keyed on it across runs,
 * but `indexEntity` deletes a universe's own-canon Qdrant points by
 * `entityLoreUrl(entityId)` before writing new ones - a random id on every reseed means
 * every re-run of `seed`/`loremaster-e2e`/`retrieval-sweep` against an already-indexed
 * universe leaves the previous run's points orphaned in Qdrant instead of replacing them,
 * silently doubling the corpus a second run measures against. `deterministicEntityId`
 * derives the id from `(universeId, slug)` instead, so the same entity gets the same id
 * every time and `indexEntity`'s delete-before-upsert actually cleans up after itself.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, type Db } from '@canonry/db';
import { entity, relation, relationType, revision } from '@canonry/db/schema';
import { detectLanguage } from '@canonry/lang';
import { markdownBody, type World } from './types.js';

// RFC 4122 UUID v5 (SHA-1 of namespace + name), the same technique
// `packages/indexing/src/point-id.ts` uses for chunk ids - only has to be stable across
// runs, not meaningful on its own. Reimplemented locally rather than imported: this
// package owns its own fixture ids, and the two have no reason to share a namespace.
const ENTITY_ID_NAMESPACE = '1c9b7e6a-3f0d-5a8c-8e2b-7a5d4c9f0e6b';

function deterministicEntityId(universeId: string, slug: string): string {
	const namespaceBytes = Buffer.from(ENTITY_ID_NAMESPACE.replace(/-/g, ''), 'hex');
	const hash = createHash('sha1')
		.update(namespaceBytes)
		.update(`${universeId}\u0000${slug}`, 'utf8')
		.digest();
	const bytes = hash.subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
					id: deterministicEntityId(universeId, e.slug),
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
