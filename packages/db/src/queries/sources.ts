/**
 * `data_source` and `data_source_exclusion` queries (SPEC.md §7, issues #59/#61/#62). The
 * licence guard lives here rather than in packages/indexing so nothing can reach the
 * pipeline without going through it - `requireIndexableDataSource` is the one function
 * that turns "reviewed" into a fact the indexing pipeline can act on.
 */
import { eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import { dataSource, dataSourceExclusion } from '../schema/source.js';
import type { DataSourceStatus, DataSourceType } from '../schema/enums.js';

export interface DataSourceRow {
	id: string;
	universeId: string | null;
	type: DataSourceType;
	name: string;
	url: string | null;
	config: unknown;
	status: DataSourceStatus;
	licence: string | null;
	licenceUrl: string | null;
	licenceReviewedAt: Date | null;
	licenceReviewedBy: string | null;
	licenceNotes: string;
	attribution: string;
	lastIndexedAt: Date | null;
	lastError: string | null;
	chunkCount: number;
	createdAt: Date;
}

export class DataSourceNotFoundError extends Error {
	constructor(id: string) {
		super(`no data_source row for id "${id}"`);
		this.name = 'DataSourceNotFoundError';
	}
}

/** Issue #61, SPEC.md §7: "no wiki is indexed before its licence and terms are reviewed
 * and the verdict recorded". Thrown by `requireIndexableDataSource` for a source that has
 * not cleared review - checked against `licenceReviewedAt`/`licenceReviewedBy` directly,
 * not just `status`, because those two columns are the durable evidence of an actual
 * review and a status value alone is easier to get wrong. */
export class LicenceNotReviewedError extends Error {
	constructor(id: string) {
		super(`data source "${id}" cannot be indexed: its licence has not been reviewed`);
		this.name = 'LicenceNotReviewedError';
	}
}

/** A source explicitly taken off the indexable list (`status = 'excluded'`) - distinct
 * from an unreviewed one, and worth its own error so a caller can tell the two apart. */
export class DataSourceExcludedError extends Error {
	constructor(id: string) {
		super(`data source "${id}" cannot be indexed: it is excluded`);
		this.name = 'DataSourceExcludedError';
	}
}

export async function getDataSource(db: Db, id: string): Promise<DataSourceRow | null> {
	const rows = await db.select().from(dataSource).where(eq(dataSource.id, id)).limit(1);
	return rows[0] ?? null;
}

export async function listDataSourcesForUniverse(
	db: Db,
	universeId: string
): Promise<DataSourceRow[]> {
	return db.select().from(dataSource).where(eq(dataSource.universeId, universeId));
}

export interface CreateDataSourceInput {
	universeId?: string | null;
	type: DataSourceType;
	name: string;
	url?: string | null;
	config?: unknown;
}

/** SPEC.md §7: "data_source rows track type, url, config, and indexing status" (issue
 * #59). Always inserts at `'licence_review_pending'` regardless of the column's own
 * default, so this is correct even if that default is ever changed for an unrelated
 * reason - the guard in `requireIndexableDataSource` does not depend on either. */
export async function createDataSource(
	db: Db,
	input: CreateDataSourceInput
): Promise<DataSourceRow> {
	const [row] = await db
		.insert(dataSource)
		.values({
			universeId: input.universeId ?? null,
			type: input.type,
			name: input.name,
			url: input.url ?? null,
			config: input.config ?? {},
			status: 'licence_review_pending'
		})
		.returning();
	if (!row) throw new Error('createDataSource: insert returned no row');
	return row;
}

export interface RecordLicenceReviewInput {
	dataSourceId: string;
	licence: string;
	licenceUrl?: string | null;
	/** The reviewing user's id - stored, not just implied by who called this (issue #61:
	 * "the reviewer and the date in the row"). */
	reviewedBy: string;
	notes?: string;
}

/** Issue #61: records the licence verdict and moves a still-pending source out of
 * `'licence_review_pending'` into `'pending'` (ready to index). A source already past
 * that state (re-reviewed, or already indexed) keeps its current status - a re-review
 * is not implicitly a reset back to square one. */
export async function recordLicenceReview(
	db: Db,
	input: RecordLicenceReviewInput
): Promise<DataSourceRow> {
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(dataSource)
			.where(eq(dataSource.id, input.dataSourceId))
			.for('update')
			.limit(1);
		const before = existing[0];
		if (!before) throw new DataSourceNotFoundError(input.dataSourceId);

		const [updated] = await tx
			.update(dataSource)
			.set({
				licence: input.licence,
				licenceUrl: input.licenceUrl ?? null,
				licenceReviewedAt: new Date(),
				licenceReviewedBy: input.reviewedBy,
				licenceNotes: input.notes ?? '',
				status: before.status === 'licence_review_pending' ? 'pending' : before.status
			})
			.where(eq(dataSource.id, input.dataSourceId))
			.returning();
		if (!updated) throw new Error('recordLicenceReview: update returned no row');
		return updated;
	});
}

/**
 * Issue #61's enforcement point: the indexing pipeline calls this before doing anything
 * else, and a source that has not cleared review or is excluded never gets past it.
 * Returns the row so a caller does not need a second read.
 */
export async function requireIndexableDataSource(db: Db, id: string): Promise<DataSourceRow> {
	const row = await getDataSource(db, id);
	if (!row) throw new DataSourceNotFoundError(id);
	if (row.status === 'excluded') throw new DataSourceExcludedError(id);
	if (!row.licenceReviewedAt || !row.licenceReviewedBy) throw new LicenceNotReviewedError(id);
	return row;
}

export async function markIndexingStarted(db: Db, id: string): Promise<void> {
	await db.update(dataSource).set({ status: 'indexing' }).where(eq(dataSource.id, id));
}

export interface MarkIndexedInput {
	chunkCount: number;
	indexedAt?: Date;
}

/** Clears `lastError` on success (source.ts's comment on the column: "a stale message
 * never outlives the failure it described"). */
export async function markIndexed(db: Db, id: string, input: MarkIndexedInput): Promise<void> {
	await db
		.update(dataSource)
		.set({
			status: 'indexed',
			lastIndexedAt: input.indexedAt ?? new Date(),
			chunkCount: input.chunkCount,
			lastError: null
		})
		.where(eq(dataSource.id, id));
}

export async function markIndexingFailed(db: Db, id: string, errorMessage: string): Promise<void> {
	await db
		.update(dataSource)
		.set({ status: 'failed', lastError: errorMessage })
		.where(eq(dataSource.id, id));
}

/**
 * Issue #62: exclusion patterns that apply when retrieving for the given data sources -
 * each source's own rows plus every row with a null `data_source_id`, which SPEC.md §7
 * defines as excluding the pattern everywhere regardless of source.
 */
export async function listExclusionPatterns(db: Db, dataSourceIds: string[]): Promise<string[]> {
	const condition =
		dataSourceIds.length > 0
			? or(
					isNull(dataSourceExclusion.dataSourceId),
					inArray(dataSourceExclusion.dataSourceId, dataSourceIds)
				)
			: isNull(dataSourceExclusion.dataSourceId);
	const rows = await db
		.select({ urlPattern: dataSourceExclusion.urlPattern })
		.from(dataSourceExclusion)
		.where(condition);
	return rows.map((r) => r.urlPattern);
}

/** All exclusion patterns effective for a universe's retrieval: unions every data source
 * that feeds that universe's collection with the global (no-source) patterns. */
export async function listExclusionPatternsForUniverse(
	db: Db,
	universeId: string
): Promise<string[]> {
	const sources = await listDataSourcesForUniverse(db, universeId);
	return listExclusionPatterns(
		db,
		sources.map((s) => s.id)
	);
}

export interface AddExclusionInput {
	dataSourceId?: string | null;
	urlPattern: string;
	reason?: string;
	requestedBy?: string;
}

export interface DataSourceExclusionRow {
	id: string;
	dataSourceId: string | null;
	urlPattern: string;
	reason: string;
	requestedBy: string;
	createdAt: Date;
}

export async function addExclusion(
	db: Db,
	input: AddExclusionInput
): Promise<DataSourceExclusionRow> {
	const [row] = await db
		.insert(dataSourceExclusion)
		.values({
			dataSourceId: input.dataSourceId ?? null,
			urlPattern: input.urlPattern,
			reason: input.reason ?? '',
			requestedBy: input.requestedBy ?? ''
		})
		.returning();
	if (!row) throw new Error('addExclusion: insert returned no row');
	return row;
}
