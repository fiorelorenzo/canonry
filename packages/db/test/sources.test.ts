import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	addExclusion,
	closeDb,
	createDataSource,
	type Db,
	DataSourceExcludedError,
	DataSourceNotFoundError,
	getDataSource,
	LicenceNotReviewedError,
	listDataSourcesForUniverse,
	listExclusionPatterns,
	listExclusionPatternsForUniverse,
	markIndexed,
	markIndexingFailed,
	markIndexingStarted,
	recordLicenceReview,
	requireIndexableDataSource
} from '../src/index.js';
import { insertHomebrewUniverse, insertUser, testDb, unique } from './helpers.js';

describe('data source lifecycle (SPEC.md §7, issues #59/#61)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('starts at licence_review_pending regardless of the column default', async () => {
		const universe = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki'),
			url: 'https://wiki.example.com'
		});
		expect(source.status).toBe('licence_review_pending');
		expect(source.licenceReviewedAt).toBeNull();
		expect(source.licenceReviewedBy).toBeNull();
	});

	it('requireIndexableDataSource refuses a source whose licence has never been reviewed', async () => {
		const universe = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		await expect(requireIndexableDataSource(db, source.id)).rejects.toBeInstanceOf(
			LicenceNotReviewedError
		);
	});

	it('requireIndexableDataSource refuses an unknown id', async () => {
		await expect(requireIndexableDataSource(db, randomUUID())).rejects.toBeInstanceOf(
			DataSourceNotFoundError
		);
	});

	it('recordLicenceReview stores the reviewer and date and moves status to pending', async () => {
		const universe = await insertHomebrewUniverse(db);
		const reviewer = await insertUser(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});

		const reviewedAt = new Date();
		const reviewed = await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
			reviewedBy: reviewer.id,
			notes: 'Attribution + share-alike required.'
		});

		expect(reviewed.status).toBe('pending');
		expect(reviewed.licence).toBe('CC BY-SA 3.0');
		expect(reviewed.licenceReviewedBy).toBe(reviewer.id);
		expect(reviewed.licenceReviewedAt?.getTime()).toBeGreaterThanOrEqual(
			reviewedAt.getTime() - 1000
		);
	});

	it('requireIndexableDataSource accepts a reviewed source and returns its row', async () => {
		const universe = await insertHomebrewUniverse(db);
		const reviewer = await insertUser(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: reviewer.id
		});

		const row = await requireIndexableDataSource(db, source.id);
		expect(row.id).toBe(source.id);
	});

	it('requireIndexableDataSource refuses an excluded source even if its licence was reviewed', async () => {
		const universe = await insertHomebrewUniverse(db);
		const reviewer = await insertUser(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: reviewer.id
		});
		await db.$client`update data_source set status = 'excluded' where id = ${source.id}`;

		await expect(requireIndexableDataSource(db, source.id)).rejects.toBeInstanceOf(
			DataSourceExcludedError
		);
	});

	it('markIndexingStarted, markIndexed and markIndexingFailed move status and clear/set last_error', async () => {
		const universe = await insertHomebrewUniverse(db);
		const reviewer = await insertUser(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: reviewer.id
		});

		await markIndexingStarted(db, source.id);
		expect((await getDataSource(db, source.id))?.status).toBe('indexing');

		await markIndexingFailed(db, source.id, 'crawl timed out');
		const failed = await getDataSource(db, source.id);
		expect(failed?.status).toBe('failed');
		expect(failed?.lastError).toBe('crawl timed out');

		await markIndexed(db, source.id, { chunkCount: 42 });
		const indexed = await getDataSource(db, source.id);
		expect(indexed?.status).toBe('indexed');
		expect(indexed?.chunkCount).toBe(42);
		expect(indexed?.lastError).toBeNull();
		expect(indexed?.lastIndexedAt).not.toBeNull();
	});

	it('listDataSourcesForUniverse only returns rows for that universe', async () => {
		const universeA = await insertHomebrewUniverse(db);
		const universeB = await insertHomebrewUniverse(db);
		const sourceA = await createDataSource(db, {
			universeId: universeA.id,
			type: 'wiki',
			name: unique('wiki')
		});
		await createDataSource(db, { universeId: universeB.id, type: 'wiki', name: unique('wiki') });

		const rows = await listDataSourcesForUniverse(db, universeA.id);
		expect(rows.map((r) => r.id)).toEqual([sourceA.id]);
	});
});

describe('exclusion patterns (issue #62)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('a pattern scoped to a data source only applies to that source', async () => {
		const universe = await insertHomebrewUniverse(db);
		const sourceA = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		const sourceB = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		const pattern = `https://wiki.example.com/${unique('bad')}*`;
		await addExclusion(db, { dataSourceId: sourceA.id, urlPattern: pattern });

		expect(await listExclusionPatterns(db, [sourceA.id])).toContain(pattern);
		expect(await listExclusionPatterns(db, [sourceB.id])).not.toContain(pattern);
	});

	it('a pattern with no data source excludes everywhere', async () => {
		const universe = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		const pattern = `https://spoilers.example.com/${unique('page')}*`;
		await addExclusion(db, { urlPattern: pattern, reason: 'no spoilers ever' });

		expect(await listExclusionPatterns(db, [source.id])).toContain(pattern);
		expect(await listExclusionPatterns(db, [])).toContain(pattern);
	});

	it('listExclusionPatternsForUniverse unions every source feeding that universe with the global patterns', async () => {
		const universe = await insertHomebrewUniverse(db);
		const otherUniverse = await insertHomebrewUniverse(db);
		const source = await createDataSource(db, {
			universeId: universe.id,
			type: 'wiki',
			name: unique('wiki')
		});
		const otherSource = await createDataSource(db, {
			universeId: otherUniverse.id,
			type: 'wiki',
			name: unique('wiki')
		});
		const ownPattern = `https://wiki.example.com/${unique('own')}*`;
		const otherPattern = `https://wiki.example.com/${unique('other')}*`;
		const globalPattern = `https://everywhere.example.com/${unique('global')}*`;
		await addExclusion(db, { dataSourceId: source.id, urlPattern: ownPattern });
		await addExclusion(db, { dataSourceId: otherSource.id, urlPattern: otherPattern });
		await addExclusion(db, { urlPattern: globalPattern });

		const patterns = await listExclusionPatternsForUniverse(db, universe.id);
		expect(patterns).toContain(ownPattern);
		expect(patterns).toContain(globalPattern);
		expect(patterns).not.toContain(otherPattern);
	});
});
