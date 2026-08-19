/**
 * Issue #332: swapping an image model from /admin/models must not silently change the shape
 * the feature generates at.
 *
 * The shape lives on the row (`params.aspectRatio`) precisely so a model swap cannot drop it,
 * and `IMAGE_PRICE_PARAM_KEYS` does not include it, so the price form cannot clear it either.
 * What a swap can still do is point the row at a model whose own `aspect_ratio` enum has no
 * such value, and Replicate answers that by generating at its own default: that is exactly
 * how every portrait since migration 0011 came back 16:9. So the save refuses, and it says
 * which shapes the chosen model does offer.
 *
 * Calls the real exported `actions.image` from `+page.server.ts`, same technique and same
 * real-Postgres convention as `params-merge.test.ts` next door, and takes the same
 * `image_model_config` session advisory lock that file and `packages/media`'s two suites
 * take (#193), so the three queue instead of racing over the one global row per feature.
 */
import { and, closeDb, createDb, eq, sql, type Db } from '@canonry/db';
import { imageModelConfig } from '@canonry/db/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actions } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

const STAFF_USER = { id: 'admin-models-test-user', email: 'admin-models-test@canonry.invalid' };

// `scene` for the same reason params-merge.test.ts picks it: it is the one image feature no
// other suite drives, and this file owns it for the duration of the lock.
const IMAGE_FEATURE = 'scene' as const;

function postEvent(fields: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return {
		request: new Request('http://localhost/admin/models', { method: 'POST', body: formData }),
		// `locale` matters here in a way it does not in params-merge.test.ts next door: every
		// assertion below reads a message this action looks up by locale, and `hooks.server.ts`
		// is what fills it in for a real request.
		locals: { user: STAFF_USER, locale: 'en' }
	} as Parameters<typeof actions.image>[0];
}

async function activeRow(db: Db) {
	const [row] = await db
		.select()
		.from(imageModelConfig)
		.where(and(eq(imageModelConfig.feature, IMAGE_FEATURE), eq(imageModelConfig.active, true)));
	return row;
}

/** `actions.image` returns a union of its success shape and SvelteKit's `ActionFailure`,
 * with no discriminant to narrow on, so the failing branch's message is read by checking
 * for it rather than by asserting a shape the compiler never saw. */
function failureError(result: unknown): string {
	if (
		result &&
		typeof result === 'object' &&
		'data' in result &&
		result.data &&
		typeof result.data === 'object' &&
		'error' in result.data &&
		typeof result.data.error === 'string'
	) {
		return result.data.error;
	}
	throw new Error('expected an ActionFailure carrying an error message');
}

describe('/admin/models refuses a model that cannot honour the configured shape (#332)', () => {
	let db: Db;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 1 });
		await db.execute(sql`select pg_advisory_lock(hashtext('image_model_config'), 0)`);
	});

	beforeEach(async () => {
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, IMAGE_FEATURE));
		await db.insert(imageModelConfig).values({
			feature: IMAGE_FEATURE,
			provider: 'replicate',
			modelId: 'bytedance/seedream-4',
			active: true,
			params: { pricePerImage: 0.03, currency: 'USD', imagesPerRequest: 1, aspectRatio: '21:9' }
		});
	});

	afterAll(async () => {
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, IMAGE_FEATURE));
		await db.execute(sql`select pg_advisory_unlock(hashtext('image_model_config'), 0)`);
		await closeDb(db);
	});

	it('refuses a model whose enum lacks the configured ratio, and leaves the row alone', async () => {
		// Both are real, both accept plenty of shapes, and only one of them accepts 21:9 -
		// which is why this check cannot be a global list of plausible ratios.
		const result = await actions.image(
			postEvent({
				feature: IMAGE_FEATURE,
				provider: 'replicate',
				modelId: 'prunaai/p-image',
				pricePerImage: '0.005',
				currency: 'USD'
			})
		);

		expect(result).toMatchObject({ status: 400 });
		const error = failureError(result);
		expect(error).toContain('21:9');
		expect(error).toContain('prunaai/p-image');
		// The message has to name what the model does take, or an admin is left guessing.
		expect(error).toContain('16:9');

		const row = await activeRow(db);
		expect(row?.modelId).toBe('bytedance/seedream-4');
		expect(row?.params).toMatchObject({ aspectRatio: '21:9', pricePerImage: 0.03 });
	});

	it('refuses a model nobody has recorded an enum for rather than guessing', async () => {
		const result = await actions.image(
			postEvent({
				feature: IMAGE_FEATURE,
				provider: 'replicate',
				modelId: 'some-owner/never-measured',
				pricePerImage: '0.01',
				currency: 'USD'
			})
		);

		expect(result).toMatchObject({ status: 400 });
		expect(failureError(result)).toContain('IMAGE_MODEL_ASPECT_RATIOS');
		expect((await activeRow(db))?.modelId).toBe('bytedance/seedream-4');
	});

	it('allows a swap to a model that does accept the configured ratio, keeping the shape', async () => {
		// flux-schnell's enum carries 21:9, so this swap is honest and the shape survives it:
		// `aspectRatio` is not one of the price form's owned keys, so the merge keeps it.
		const result = await actions.image(
			postEvent({
				feature: IMAGE_FEATURE,
				provider: 'replicate',
				modelId: 'black-forest-labs/flux-schnell',
				pricePerImage: '0.003',
				currency: 'USD'
			})
		);

		expect(result).toMatchObject({ saved: true });
		const row = await activeRow(db);
		expect(row?.modelId).toBe('black-forest-labs/flux-schnell');
		expect(row?.params).toMatchObject({ aspectRatio: '21:9', pricePerImage: 0.003 });
	});

	it('lets a row with no configured shape through, which is what "model default" means', async () => {
		await db
			.update(imageModelConfig)
			.set({ params: { pricePerImage: 0.03, currency: 'USD' } })
			.where(and(eq(imageModelConfig.feature, IMAGE_FEATURE), eq(imageModelConfig.active, true)));

		const result = await actions.image(
			postEvent({
				feature: IMAGE_FEATURE,
				provider: 'replicate',
				modelId: 'some-owner/never-measured',
				pricePerImage: '0.01',
				currency: 'USD'
			})
		);

		expect(result).toMatchObject({ saved: true });
		expect((await activeRow(db))?.modelId).toBe('some-owner/never-measured');
	});
});
