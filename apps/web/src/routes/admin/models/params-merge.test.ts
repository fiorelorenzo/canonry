/**
 * Issue #235, the test the issue itself asks for: a save through `/admin/models` must
 * preserve every `params` key the saving form does not render, and still be able to
 * change or clear a key the form does own. This calls the *actual* exported
 * `actions.image`/`actions.text` from `+page.server.ts` (same technique as
 * `../p/leak.test.ts`) rather than re-deriving what they do, so a route-wiring
 * regression - forgetting to pass the right owned-keys list, or reverting to the old
 * wholesale replace - fails here even if `upsertImageModel`/`upsertTextModel` (unit
 * tested directly in `packages/db/test/media.test.ts` and `model.test.ts`) are correct.
 *
 * Runs against the real dev Postgres, same convention as `leak.test.ts` and
 * `export.test.ts`. Unlike those, `image_model_config`/`model_config` are global
 * singletons keyed by a fixed enum rather than a randomly-slugged row, so this file
 * picks the one feature (`scene`) and purpose (`image`) that ship with no seed data and
 * that no other suite in this repo drives (grep confirms it), and still takes the same
 * session advisory lock `packages/media/src/test-db.ts` uses for `image_model_config`,
 * plus the equivalent for `model_config`, so a second concurrent run of this exact file
 * queues instead of racing. Every row this file writes is deleted again in `afterAll`.
 */
import { randomUUID } from 'node:crypto';
import { and, closeDb, createDb, eq, sql, type Db } from '@canonry/db';
import { imageModelConfig, modelConfig } from '@canonry/db/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actions } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// `$lib/server/db.ts`'s `db()` singleton, which the actions under test call, reads
// `env.DATABASE_URL` with no fallback of its own - set once, before any action runs,
// the same reasoning `leak.test.ts` documents for the same line.
process.env.DATABASE_URL ??= DATABASE_URL;

// Matches vite.config.ts's `STAFF_EMAILS` test default, which has to be set at config
// resolution time rather than here (see that file's own comment on issue #235).
const STAFF_USER = { id: 'admin-models-test-user', email: 'admin-models-test@canonry.invalid' };

const IMAGE_FEATURE = 'scene' as const;
const TEXT_PURPOSE = 'image' as const;

function postEvent(fields: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return {
		request: new Request('http://localhost/admin/models', { method: 'POST', body: formData }),
		locals: { user: STAFF_USER }
	} as Parameters<typeof actions.image>[0];
}

describe('/admin/models save actions merge params (issue #235)', () => {
	let db: Db;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 1 });
		await db.execute(sql`select pg_advisory_lock(hashtext('image_model_config'), 0)`);
		await db.execute(sql`select pg_advisory_lock(hashtext('model_config'), 0)`);
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, IMAGE_FEATURE));
		await db.delete(modelConfig).where(eq(modelConfig.purpose, TEXT_PURPOSE));
		// 120s rather than vitest's default 10s `hookTimeout`. Both locks above are now contended
		// by files that hold them for far longer than ten seconds - `canon-save.test.ts` holds
		// `model_config` for about 13.5s of its run - and a hook that waits past the timeout
		// fails this whole file with `Hook timed out in 10000ms`, reporting its three tests
		// skipped, rather than queueing the way the lock intends.
	}, 120_000);

	// Every test seeds its own active row, and image_model_config's partial unique
	// index allows only one active row per feature - clear both target rows before
	// each test rather than only once in beforeAll.
	beforeEach(async () => {
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, IMAGE_FEATURE));
		await db.delete(modelConfig).where(eq(modelConfig.purpose, TEXT_PURPOSE));
	});

	afterAll(async () => {
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, IMAGE_FEATURE));
		await db.delete(modelConfig).where(eq(modelConfig.purpose, TEXT_PURPOSE));
		await db.execute(sql`select pg_advisory_unlock(hashtext('image_model_config'), 0)`);
		await db.execute(sql`select pg_advisory_unlock(hashtext('model_config'), 0)`);
		await closeDb(db);
	});

	it('actions.image preserves a params key the price form does not render, across an unrelated save', async () => {
		await db.insert(imageModelConfig).values({
			feature: IMAGE_FEATURE,
			provider: 'replicate',
			modelId: `canonry-web-test-${randomUUID().slice(0, 8)}`,
			active: true,
			// Exactly the shape migration 0011 seeded and no form renders - this issue's
			// own description of the bug (`imagesPerRequest`).
			params: { pricePerImage: 0.02, currency: 'USD', imagesPerRequest: 4 }
		});

		const newModelId = `canonry-web-test-${randomUUID().slice(0, 8)}`;
		const result = await actions.image(
			postEvent({
				feature: IMAGE_FEATURE,
				provider: 'replicate',
				modelId: newModelId,
				pricePerImage: '0.02',
				currency: 'USD'
			})
		);

		expect(result).toMatchObject({ saved: true, modelId: newModelId });

		const [row] = await db
			.select()
			.from(imageModelConfig)
			.where(and(eq(imageModelConfig.feature, IMAGE_FEATURE), eq(imageModelConfig.active, true)));
		expect(row?.modelId).toBe(newModelId);
		expect(row?.params).toEqual({ pricePerImage: 0.02, currency: 'USD', imagesPerRequest: 4 });
	});

	it('actions.image changes the keys it owns when the admin actually edits them', async () => {
		await db.insert(imageModelConfig).values({
			feature: IMAGE_FEATURE,
			provider: 'replicate',
			modelId: 'canonry-web-test-owned',
			active: true,
			params: { pricePerImage: 0.02, currency: 'USD' }
		});

		const result = await actions.image(
			postEvent({
				feature: IMAGE_FEATURE,
				provider: 'replicate',
				modelId: 'canonry-web-test-owned',
				pricePerImage: '0.05',
				currency: 'EUR'
			})
		);
		expect(result).toMatchObject({ saved: true, pricePerImage: '0.05', currency: 'EUR' });

		const [row] = await db
			.select()
			.from(imageModelConfig)
			.where(and(eq(imageModelConfig.feature, IMAGE_FEATURE), eq(imageModelConfig.active, true)));
		expect(row?.params).toEqual({ pricePerImage: 0.05, currency: 'EUR' });
	});

	it('actions.text preserves the whole params object across an unrelated provider switch', async () => {
		await db.insert(modelConfig).values({
			purpose: TEXT_PURPOSE,
			provider: 'openai',
			modelId: 'canonry-web-test-seed',
			active: true,
			// The text form renders no pricing field at all (issue #235) - whatever set
			// this (@canonry/bench's setActiveModel in production) has to survive.
			params: { pricePerInputMTok: 1, pricePerOutputMTok: 2, currency: 'USD' }
		});

		const result = await actions.text(
			postEvent({
				purpose: TEXT_PURPOSE,
				provider: 'anthropic',
				modelId: 'canonry-web-test-switched'
			})
		);
		expect(result).toMatchObject({
			saved: true,
			provider: 'anthropic',
			modelId: 'canonry-web-test-switched'
		});

		const [row] = await db
			.select()
			.from(modelConfig)
			.where(and(eq(modelConfig.purpose, TEXT_PURPOSE), eq(modelConfig.active, true)));
		expect(row?.modelId).toBe('canonry-web-test-switched');
		expect(row?.params).toEqual({ pricePerInputMTok: 1, pricePerOutputMTok: 2, currency: 'USD' });
	});
});
