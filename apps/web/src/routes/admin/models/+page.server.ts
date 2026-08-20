/**
 * /admin/models: two panels behind the same admin gate. Text models render above image
 * models, since text is what every flow (loremaster, propagate, warm, indexing,
 * embedding) reads through `model_config`'s `cheap`/`premium`/`multimodal`/`embedding`/
 * `image` purposes (SPEC.md §11.1) - `image_model_config` gates only "Generate image"
 * and previously had this page to itself (#64).
 *
 * Before this, `model_config` had no admin surface at all: the only way to change the
 * active text model was psql directly against the database. Filed as a gap found while
 * building #64's sibling panel; report it to Lorenzo to open the tracking issue.
 *
 * Both saves follow /admin/pricing's fail()/no-redirect validation pattern: a bad
 * submission re-renders the page with `form.error` next to the field that failed, never
 * a redirect and never a 500. The text save additionally constrains `provider` to
 * `KNOWN_PROVIDERS` (`@canonry/ai`) with a `<select>`, not free text - a provider
 * `createLanguageModel` cannot construct is not a valid configuration, and letting one
 * through here would turn a loud startup error into a silent failure on the next Ask.
 */
import { fail } from '@sveltejs/kit';
import { messages } from '$lib/i18n';
import {
	activeImageModelRow,
	listImageModels,
	listActiveTextModels,
	upsertImageModel,
	upsertTextModel,
	type ModelConfigRow
} from '@canonry/db';
import { modelPurposeEnum, type ModelPurpose } from '@canonry/db/schema';
import {
	clearImageModelCache,
	readImageModelParams,
	IMAGE_MODEL_ASPECT_RATIOS
} from '@canonry/media';
import { isKnownProvider, KNOWN_PROVIDERS, CURRENCIES, clearModelCache } from '@canonry/ai';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/admin';
import { IMAGE_PRICE_PARAM_KEYS, parseCurrency, parsePricePerImage } from './image-price.js';
import { COVER_ASPECT_RATIOS } from '$lib/components/media/cover-crop';
import type { Actions, PageServerLoad } from './$types';

export interface TextModelPurposeRow {
	purpose: ModelPurpose;
	active: ModelConfigRow | null;
}

export const load: PageServerLoad = async () => {
	const database = db();
	const [images, activeTextModels] = await Promise.all([
		listImageModels(database),
		listActiveTextModels(database)
	]);

	// One row per purpose the enum holds, not per row the table happens to have -
	// upsertTextModel keeps deactivated rows as history, and a purpose nobody has
	// configured yet still needs a visible "not configured" row rather than vanishing.
	const activeByPurpose = new Map(activeTextModels.map((row) => [row.purpose, row]));
	const textModels: TextModelPurposeRow[] = modelPurposeEnum.enumValues.map((purpose) => ({
		purpose,
		active: activeByPurpose.get(purpose) ?? null
	}));

	return { images, textModels, knownProviders: KNOWN_PROVIDERS, currencies: CURRENCIES };
};

function isModelPurpose(value: string): value is ModelPurpose {
	return (modelPurposeEnum.enumValues as readonly string[]).includes(value);
}

export const actions: Actions = {
	// SvelteKit refuses a `default` action alongside named ones, so image's save (below)
	// moved from `default` to `image` in the same edit that added this action.
	text: async (event) => {
		// The layout's load already gates page views; a POST runs before any layout load
		// (see src/lib/server/admin.ts), so the action needs its own check.
		requireAdmin(event);

		const formData = await event.request.formData();
		const rawPurpose = formData.get('purpose');
		const rawProvider = formData.get('provider');
		const rawModelId = formData.get('modelId');

		const purposeOut = typeof rawPurpose === 'string' ? rawPurpose : '';
		const providerOut = typeof rawProvider === 'string' ? rawProvider : '';
		const modelId = typeof rawModelId === 'string' ? rawModelId.trim() : '';

		if (typeof rawPurpose !== 'string' || !isModelPurpose(rawPurpose)) {
			return fail(400, {
				purpose: purposeOut,
				provider: providerOut,
				modelId,
				saved: false,
				error: messages(event.locals.locale).admin.models.errors.unknownPurpose(purposeOut)
			});
		}

		if (typeof rawProvider !== 'string' || !isKnownProvider(rawProvider)) {
			return fail(400, {
				purpose: rawPurpose,
				provider: providerOut,
				modelId,
				saved: false,
				error: messages(event.locals.locale).admin.models.errors.unknownProvider(
					providerOut,
					KNOWN_PROVIDERS.join(', ')
				)
			});
		}

		if (modelId.length === 0) {
			return fail(400, {
				purpose: rawPurpose,
				provider: rawProvider,
				modelId,
				saved: false,
				error: messages(event.locals.locale).admin.models.errors.modelIdRequired
			});
		}

		// The text form owns no key of `params` (issue #235) - passing an empty
		// `paramKeys` leaves whatever pricing @canonry/bench's setActiveModel already
		// wrote for this purpose exactly as it was, rather than replacing it with `{}`.
		await upsertTextModel(db(), {
			purpose: rawPurpose,
			provider: rawProvider,
			modelId,
			paramKeys: [],
			params: {}
		});
		// SPEC.md §11.1: switchable without a deploy. resolveModel's cache (packages/ai's
		// models.ts) has a short TTL, but "short" still reads as "broken" to an admin who
		// just saved and expects the very next AI call to use it - clear it immediately.
		clearModelCache();

		return { purpose: rawPurpose, provider: rawProvider, modelId, saved: true };
	},

	image: async (event) => {
		// The layout's load already gates page views; a POST runs before any layout load
		// (see src/lib/server/admin.ts), so the action needs its own check.
		requireAdmin(event);

		const formData = await event.request.formData();
		const feature = formData.get('feature');
		const provider = formData.get('provider');
		const modelId = formData.get('modelId');
		const rawPricePerImage = formData.get('pricePerImage');
		const rawCurrency = formData.get('currency');

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
				pricePerImage: typeof rawPricePerImage === 'string' ? rawPricePerImage : '',
				currency: typeof rawCurrency === 'string' ? rawCurrency : '',
				saved: false,
				error: messages(event.locals.locale).admin.models.errors.providerAndModelIdRequired
			});
		}

		const pricePerImage = parsePricePerImage(rawPricePerImage);
		if (pricePerImage === null) {
			return fail(400, {
				feature,
				provider,
				modelId,
				pricePerImage: typeof rawPricePerImage === 'string' ? rawPricePerImage : '',
				currency: typeof rawCurrency === 'string' ? rawCurrency : '',
				saved: false,
				error: messages(event.locals.locale).admin.models.errors.invalidPricePerImage
			});
		}

		const currency = parseCurrency(rawCurrency);
		if (currency === null) {
			return fail(400, {
				feature,
				provider,
				modelId,
				pricePerImage: String(pricePerImage),
				currency: typeof rawCurrency === 'string' ? rawCurrency : '',
				saved: false,
				error: messages(event.locals.locale).admin.models.errors.invalidCurrency
			});
		}

		// #332: the shape a feature generates at lives on this row (`params.aspectRatio`),
		// which is what makes it survive a model swap - `paramKeys` below does not include it,
		// so this form cannot clear it. What a swap can do is point the row at a model whose
		// own schema does not offer that value, and Replicate answers that by generating at
		// its default instead, which is the whole of #332. So the save refuses rather than
		// the generation quietly going wrong later.
		//
		// #366 widens what "that value" means without weakening the check. A cover's shape
		// comes from the entity type now, so `portrait` and `variants` can ask their model for
		// any of `COVER_ASPECT_RATIOS` at generation time, and a model that accepts the row's
		// default but not a character's portrait would fail on the first cover rather than on
		// save. The set a save has to satisfy is therefore every shape the feature can
		// actually ask for, and the message names whichever one this model cannot draw.
		const configuredAspectRatio = readImageModelParams(
			(await activeImageModelRow(db(), feature))?.params
		).aspectRatio;
		const requiredAspectRatios =
			feature === 'scene'
				? configuredAspectRatio
					? [configuredAspectRatio]
					: []
				: [
						...new Set([
							...(configuredAspectRatio ? [configuredAspectRatio] : []),
							...COVER_ASPECT_RATIOS
						])
					];
		const acceptedAspectRatios = IMAGE_MODEL_ASPECT_RATIOS[modelId];
		const unsupported = requiredAspectRatios.find(
			(ratio) => !acceptedAspectRatios?.includes(ratio)
		);
		if (unsupported) {
			const errors = messages(event.locals.locale).admin.models.errors;
			return fail(400, {
				feature,
				provider,
				modelId,
				pricePerImage: String(pricePerImage),
				currency,
				saved: false,
				error: acceptedAspectRatios
					? errors.aspectRatioUnsupported(modelId, unsupported, acceptedAspectRatios.join(', '))
					: errors.aspectRatioModelUnknown(modelId, unsupported)
			});
		}

		// No conversion here (issue #221) - `pricePerImage` is stored exactly as typed, in
		// the currency just chosen. `computeCost` (@canonry/ai/usage.ts) is the only place
		// this ever becomes euros.
		await upsertImageModel(db(), {
			feature,
			provider,
			modelId,
			// Only these two keys are the image price form's own (issue #235) - every
			// other key already on the row (`imagesPerRequest`, seeded by migration 0011)
			// survives this save untouched.
			paramKeys: IMAGE_PRICE_PARAM_KEYS,
			params: { pricePerImage, currency }
		});
		clearImageModelCache();

		return {
			feature,
			provider,
			modelId,
			pricePerImage: String(pricePerImage),
			currency,
			saved: true
		};
	}
};
