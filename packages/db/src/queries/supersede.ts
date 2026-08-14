/**
 * SPEC.md §4.1, issue #19. A derived universe reads its own canon plus its base
 * universe's indexed corpus, read-only, and **the user's canon always wins**: an entry can
 * declare that it supersedes a specific source page, which then has to stop coming back
 * from retrieval for that universe (`supersededUrlsForUniverse`, wired into
 * `packages/indexing`'s retriever) and has to be visible in the UI as precedence, not just
 * behave differently (decision A2's "what this locks in").
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import { dataSource, supersede } from '../schema/source.js';

export interface SupersedeRow {
	id: string;
	universeId: string;
	entityId: string;
	entityName: string;
	entitySlug: string;
	dataSourceId: string;
	dataSourceName: string;
	sourceUrl: string;
	note: string;
	createdAt: Date;
}

/** Every supersede declaration a universe holds, newest first - the settings page's
 * "Precedence" list (A2's struck-through row, made real). */
export async function listSupersedesForUniverse(
	db: Db,
	universeId: string
): Promise<SupersedeRow[]> {
	return db
		.select({
			id: supersede.id,
			universeId: supersede.universeId,
			entityId: supersede.entityId,
			entityName: entity.name,
			entitySlug: entity.slug,
			dataSourceId: supersede.dataSourceId,
			dataSourceName: dataSource.name,
			sourceUrl: supersede.sourceUrl,
			note: supersede.note,
			createdAt: supersede.createdAt
		})
		.from(supersede)
		.innerJoin(entity, eq(entity.id, supersede.entityId))
		.innerJoin(dataSource, eq(dataSource.id, supersede.dataSourceId))
		.where(eq(supersede.universeId, universeId))
		.orderBy(desc(supersede.createdAt));
}

/** Flat list of every source url a universe has superseded - the exact shape
 * `queryLore`'s `excludedUrlPatterns` already takes (issue #62's exclusion list), so the
 * retriever merges this in with no new filtering mechanism to build. */
export async function supersededUrlsForUniverse(db: Db, universeId: string): Promise<string[]> {
	const rows = await db
		.select({ sourceUrl: supersede.sourceUrl })
		.from(supersede)
		.where(eq(supersede.universeId, universeId));
	return rows.map((row) => row.sourceUrl);
}

export class SupersedeAlreadyExistsError extends Error {
	constructor(universeId: string, sourceUrl: string) {
		super(`universe "${universeId}" already supersedes "${sourceUrl}"`);
		this.name = 'SupersedeAlreadyExistsError';
	}
}

function isUniqueViolation(err: unknown, constraintName: string): boolean {
	if (!err || typeof err !== 'object' || !('cause' in err)) return false;
	const cause = err.cause;
	return (
		!!cause &&
		typeof cause === 'object' &&
		'constraint_name' in cause &&
		cause.constraint_name === constraintName
	);
}

export interface CreateSupersedeInput {
	universeId: string;
	entityId: string;
	dataSourceId: string;
	sourceUrl: string;
	note?: string;
}

/** Records that `entityId` (in `universeId`) supersedes `sourceUrl` on `dataSourceId` -
 * the base universe's official page it replaces. `supersede_universe_url_key` (one
 * declaration per url per universe) surfaces here as `SupersedeAlreadyExistsError` rather
 * than a raw Postgres error, so the settings action can show "already superseded" instead
 * of a stack trace. */
export async function createSupersede(
	db: Db,
	input: CreateSupersedeInput
): Promise<typeof supersede.$inferSelect> {
	try {
		const [row] = await db
			.insert(supersede)
			.values({
				universeId: input.universeId,
				entityId: input.entityId,
				dataSourceId: input.dataSourceId,
				sourceUrl: input.sourceUrl,
				note: input.note ?? ''
			})
			.returning();
		if (!row) throw new Error('createSupersede: insert did not return a row');
		return row;
	} catch (err) {
		if (isUniqueViolation(err, 'supersede_universe_url_key')) {
			throw new SupersedeAlreadyExistsError(input.universeId, input.sourceUrl);
		}
		throw err;
	}
}

/** Scoped by `universeId` as well as `id` so a stray id from another universe can never be
 * used to remove a row it does not own. */
export async function removeSupersede(db: Db, universeId: string, id: string): Promise<void> {
	await db.delete(supersede).where(and(eq(supersede.id, id), eq(supersede.universeId, universeId)));
}
