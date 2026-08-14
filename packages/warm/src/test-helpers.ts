/** Shared fixture builders for this package's integration tests. Deliberately minimal
 * (no seedFixture dependency) so store/budget/trigger tests build exactly the graph shape
 * a given test needs rather than depending on the full Valdoria Reach world - that fixture
 * is reserved for context.test.ts, which specifically has to prove the instant lane against
 * it. */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@canonry/db';
import { entity, relation, relationType, revision, universe, user } from '@canonry/db/schema';

/** Ids carry a random suffix rather than a timestamp and a counter, matching every other
 * package's helper. The counter version collided in CI: vitest gives each test file its own
 * module instance, so two files starting inside the same millisecond both produced
 * `user-<same ms>-1` and the second insert died on `user_pkey`. A flake in a shared fixture
 * builder costs far more to diagnose than it ever saves. */
function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function createTestUser(db: Db): Promise<string> {
	const id = unique('user');
	await db
		.insert(user)
		.values({ id, name: 'Test User', email: `${id}@canonry.invalid`, emailVerified: true });
	return id;
}

export async function createTestUniverse(db: Db, ownerUserId: string): Promise<string> {
	const slug = unique('universe');
	const [row] = await db
		.insert(universe)
		.values({ ownerUserId, name: slug, slug, kind: 'homebrew' })
		.returning({ id: universe.id });
	if (!row) throw new Error('createTestUniverse: insert returned no row');
	return row.id;
}

export interface CreateTestEntityInput {
	universeId: string;
	type: 'character' | 'place' | 'faction' | 'item' | 'event' | 'session';
	name?: string;
	body?: string;
}

export async function createTestEntity(db: Db, input: CreateTestEntityInput): Promise<string> {
	const slug = unique(input.type);
	const [row] = await db
		.insert(entity)
		.values({
			universeId: input.universeId,
			type: input.type,
			name: input.name ?? slug,
			slug,
			body: input.body ?? ''
		})
		.returning({ id: entity.id });
	if (!row) throw new Error('createTestEntity: insert returned no row');
	return row.id;
}

/** Inserts a revision for an entity, which is what a fingerprint hangs off. Returns the
 * new revision's id. `createdAt` lets a test backdate a revision (e.g. to simulate a
 * universe whose drift is old rather than recent, for warmNightly's activity window). */
export async function createTestRevision(
	db: Db,
	input: { universeId: string; entityId: string; body?: string; createdAt?: Date }
): Promise<string> {
	const [row] = await db
		.insert(revision)
		.values({
			universeId: input.universeId,
			entityId: input.entityId,
			authorKind: 'human',
			name: 'revised',
			body: input.body ?? unique('body'),
			...(input.createdAt ? { createdAt: input.createdAt } : {})
		})
		.returning({ id: revision.id });
	if (!row) throw new Error('createTestRevision: insert returned no row');
	return row.id;
}

/** Links two entities with a shipped catalogue relation type (SPEC §4.2's built-ins,
 * `relation_type.universe_id is null`), by label. */
export async function createTestRelation(
	db: Db,
	input: { universeId: string; fromEntityId: string; toEntityId: string; label: string }
): Promise<void> {
	const [type] = await db
		.select({ id: relationType.id })
		.from(relationType)
		.where(eq(relationType.label, input.label))
		.limit(1);
	if (!type) throw new Error(`createTestRelation: no shipped relation type "${input.label}"`);
	await db.insert(relation).values({
		universeId: input.universeId,
		relationTypeId: type.id,
		fromEntityId: input.fromEntityId,
		toEntityId: input.toEntityId,
		authorKind: 'human'
	});
}
