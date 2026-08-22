/**
 * Migration 0044's two corrections, both of them restatements of rows an earlier migration
 * seeded: import matching's own price row (issue #309) and the real Replicate list price
 * behind `portrait` and `variants` (issue #333).
 *
 * Neither is defended by anything else. A label nobody asserts drifts back the first time
 * somebody copies a nearby `createGatewayEmbedder` call, and a price seeded once and never
 * read again is how both image rows spent months at three to four times what Replicate
 * charges, so both facts are checked against the migrated database rather than reviewed once.
 *
 * `scene` is deliberately not asserted here. media.test.ts in this package owns that row
 * outright and deletes it before every test, and reading its price from a second file would
 * force a cross-file lock for the sake of one number. Migration 0044's comment records what
 * re-reading Replicate's price for it on 2026-08-19 said, which is that it needed no change.
 *
 * The "seeded image prices" block below still takes `lockImageModelConfigForFile` (#341):
 * it reads `portrait`/`variants`, and any file that later rewrites those rows as a fixture
 * (media.test.ts did, before #235 moved it to `scene`) races this file's assertions unless
 * both sides hold the lock. See test/helpers.ts's doc comment on the lock.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, priceOf, type Db } from '../src/index.js';
import { imageModelConfig } from '../src/schema/media.js';
import {
	lockableTestDb,
	lockImageModelConfigForFile,
	testDb,
	unlockImageModelConfigForFile
} from './helpers.js';

describe('import.match.embed (issue #309)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('is priced, at zero, as a reading operation', async () => {
		const row = await priceOf(db, 'import.match.embed');

		// Priced at all is half the point: `withUsage` throws OperationNotPricedError on an
		// operation with no row, so relabelling the embedder without this row would have turned
		// every import that matches an entity into a failed import.
		expect(row.credits).toBe(0);
		expect(row.kind).toBe('reading');
	});

	it('leaves index.embed exactly where it was, since canon-save still bills it', async () => {
		const canonSave = await priceOf(db, 'index.embed');

		expect(canonSave.credits).toBe(0);
		expect(canonSave.kind).toBe('reading');
	});

	it('states its claim without a repo citation, because /admin/pricing renders notes verbatim', async () => {
		// Issue #209's rule, applied to a row seeded after it: the note keeps the claim and the
		// provenance stays in the migration comment, where no staff admin reads it.
		const row = await priceOf(db, 'import.match.embed');

		expect(row.notes).toMatch(/reading is free/i);
		expect(row.notes).not.toMatch(/SPEC\.md|docs\/|issue #|§/i);
	});
});

describe('seeded image prices (issue #333)', () => {
	let db: Db;

	beforeAll(async () => {
		db = lockableTestDb();
		await lockImageModelConfigForFile(db);
	});

	afterAll(async () => {
		await unlockImageModelConfigForFile(db);
		await closeDb(db);
	});

	it('prices a portrait at what Replicate charges for it, in Replicate own currency', async () => {
		const [portrait] = await db
			.select()
			.from(imageModelConfig)
			.where(eq(imageModelConfig.feature, 'portrait'));

		// USD 0.005, which is "$5 per thousand output images" on prunaai/p-image's model page
		// (read 2026-08-19), against the 0.02 migrations 0011 and 0034 carried. The whole row is
		// asserted rather than the price alone: `imagesPerRequest` is what makes a variant batch
		// four images rather than one, and the correction had to leave it untouched.
		//
		// `aspectRatio` is the fourth key because migration 0045 (#332) adds it after this
		// correction, with a jsonb merge rather than a restatement, which is what lets the two
		// migrations touch the same row without either losing the other's key. Asserting the
		// whole object is what makes that composition visible here rather than only in review.
		expect(portrait?.modelId).toBe('prunaai/p-image');
		expect(portrait?.params).toEqual({
			pricePerImage: 0.005,
			imagesPerRequest: 1,
			currency: 'USD',
			aspectRatio: '3:2'
		});
	});

	it('prices a variant batch at what Replicate charges for it, per image and not per batch', async () => {
		const [variants] = await db
			.select()
			.from(imageModelConfig)
			.where(eq(imageModelConfig.feature, 'variants'));

		// USD 0.003, "$3 per thousand output images" on black-forest-labs/flux-schnell's model
		// page (read 2026-08-19), against the 0.01 that was seeded. Four of these is what one
		// variants call costs, which is where the overstatement was largest. `aspectRatio` is
		// migration 0045's, and it is 3:2 here because a variant batch is four alternates of
		// what `portrait` produces and has to be offered at the shape the chosen one will have.
		expect(variants?.modelId).toBe('black-forest-labs/flux-schnell');
		expect(variants?.params).toEqual({
			pricePerImage: 0.003,
			imagesPerRequest: 4,
			currency: 'USD',
			aspectRatio: '3:2'
		});
	});
});
