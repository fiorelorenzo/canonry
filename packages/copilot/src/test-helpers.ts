/** Shared fixture builders for this package's integration tests. Not a *.test.ts file on
 * purpose, so vitest never treats it as a suite of its own. */
import { randomUUID } from 'node:crypto';
import { sql, type Db } from '@canonry/db';
import { entity, modelConfig, relation, relationType, universe, user } from '@canonry/db/schema';
import type { EntityType, ModelPurpose, RelationCardinality } from '@canonry/db/schema';

export function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function insertUser(db: Db, overrides: Partial<typeof user.$inferInsert> = {}) {
	const id = overrides.id ?? unique('user');
	const [row] = await db
		.insert(user)
		.values({
			id,
			name: 'Test GM',
			email: `${id}@canonry.invalid`,
			emailVerified: true,
			...overrides
		})
		.returning();
	if (!row) throw new Error('insertUser: insert returned no row');
	return row;
}

export async function insertHomebrewUniverse(
	db: Db,
	overrides: Partial<typeof universe.$inferInsert> = {}
) {
	const ownerUserId = overrides.ownerUserId ?? (await insertUser(db)).id;
	const [row] = await db
		.insert(universe)
		.values({
			ownerUserId,
			name: 'Test Universe',
			slug: unique('universe'),
			kind: 'homebrew',
			...overrides
		})
		.returning();
	if (!row) throw new Error('insertHomebrewUniverse: insert returned no row');
	return row;
}

export async function insertEntity(
	db: Db,
	universeId: string,
	overrides: Partial<typeof entity.$inferInsert> & { type: EntityType; name: string }
) {
	const [row] = await db
		.insert(entity)
		.values({ universeId, slug: unique('entity'), aliases: [], body: '', ...overrides })
		.returning();
	if (!row) throw new Error('insertEntity: insert returned no row');
	return row;
}

export async function insertRelationType(
	db: Db,
	universeId: string,
	input: {
		label: string;
		inverseLabel: string;
		cardinality?: RelationCardinality;
		allowedFrom?: EntityType[];
		allowedTo?: EntityType[];
	}
) {
	const [row] = await db
		.insert(relationType)
		.values({
			universeId,
			label: input.label,
			inverseLabel: input.inverseLabel,
			cardinality: input.cardinality ?? 'many_to_many',
			allowedFrom: input.allowedFrom ?? [
				'character',
				'place',
				'faction',
				'item',
				'event',
				'session'
			],
			allowedTo: input.allowedTo ?? ['character', 'place', 'faction', 'item', 'event', 'session']
		})
		.returning();
	if (!row) throw new Error('insertRelationType: insert returned no row');
	return row;
}

export async function insertRelation(
	db: Db,
	universeId: string,
	input: { relationTypeId: string; fromEntityId: string; toEntityId: string }
) {
	const [row] = await db
		.insert(relation)
		.values({
			universeId,
			relationTypeId: input.relationTypeId,
			fromEntityId: input.fromEntityId,
			toEntityId: input.toEntityId,
			authorKind: 'human'
		})
		.returning();
	if (!row) throw new Error('insertRelation: insert returned no row');
	return row;
}

/** Ensures exactly one active `model_config` row for a purpose, and returns it.
 *
 * `model_config_active_purpose_key` is a unique index on `purpose` where `active`, so two
 * test files that each insert their own active row for `cheap` collide, which is what broke
 * CI: vitest runs this package's files in parallel against one database. Upserting on that
 * index makes the second one adopt the row instead of failing, and the model id is
 * deterministic (`test-cheap`, `test-premium`) rather than randomised so a test that asserts
 * which model was called does not have to guess which file won the race. */
export async function insertModelConfig(
	db: Db,
	purpose: ModelPurpose,
	overrides: Partial<typeof modelConfig.$inferInsert> = {}
) {
	const [row] = await db
		.insert(modelConfig)
		.values({
			purpose,
			provider: 'test-provider',
			modelId: `test-${purpose}`,
			active: true,
			params: {},
			...overrides
		})
		.onConflictDoUpdate({
			target: modelConfig.purpose,
			targetWhere: sql`${modelConfig.active} = true`,
			set: {
				provider: overrides.provider ?? 'test-provider',
				modelId: overrides.modelId ?? `test-${purpose}`,
				params: overrides.params ?? {},
				updatedAt: new Date()
			}
		})
		.returning();
	if (!row) throw new Error('insertModelConfig: upsert returned no row');
	return row;
}
