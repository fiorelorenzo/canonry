/**
 * /admin/models (#64): the active image model per feature, switchable without a deploy -
 * the same pattern /admin/pricing already established for operation_price, applied to
 * image_model_config instead. A save calls @canonry/db's upsertImageModel, then clears
 * @canonry/media's resolveImageModel cache so the next "Generate image" dialog sees the
 * new model immediately rather than after its 30 second TTL.
 */
import { fail } from '@sveltejs/kit';
import { listImageModels, upsertImageModel } from '@canonry/db';
import { clearImageModelCache } from '@canonry/media';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const models = await listImageModels(db());
	return { models };
};

const EUR_PATTERN = /^\d+(\.\d{1,6})?$/;

function parseEurPerImage(raw: FormDataEntryValue | null): number | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!EUR_PATTERN.test(trimmed)) return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

export const actions: Actions = {
	default: async (event) => {
		// The layout's load already gates page views; a POST runs before any layout load
		// (see src/lib/server/admin.ts), so the action needs its own check.
		requireAdmin(event);

		const formData = await event.request.formData();
		const feature = formData.get('feature');
		const provider = formData.get('provider');
		const modelId = formData.get('modelId');
		const rawEurPerImage = formData.get('eurPerImage');

		if (
			(feature !== 'portrait' && feature !== 'variants' && feature !== 'scene') ||
			typeof provider !== 'string' ||
			provider.length === 0 ||
			typeof modelId !== 'string' ||
			modelId.length === 0
		) {
			return fail(400, {
				feature: typeof feature === 'string' ? feature : null,
				provider: typeof provider === 'string' ? provider : '',
				modelId: typeof modelId === 'string' ? modelId : '',
				eurPerImage: typeof rawEurPerImage === 'string' ? rawEurPerImage : '',
				saved: false,
				error: 'Provider and model id are required.'
			});
		}

		const eurPerImage = parseEurPerImage(rawEurPerImage);
		if (eurPerImage === null) {
			return fail(400, {
				feature,
				provider,
				modelId,
				eurPerImage: typeof rawEurPerImage === 'string' ? rawEurPerImage : '',
				saved: false,
				error: 'Enter a non-negative EUR-per-image cost, up to 6 decimal places.'
			});
		}

		await upsertImageModel(db(), { feature, provider, modelId, params: { eurPerImage } });
		clearImageModelCache();

		return { feature, provider, modelId, eurPerImage: String(eurPerImage), saved: true };
	}
};
