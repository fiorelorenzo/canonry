/**
 * Pure parsing for the image price form's two fields (issue #221), split out of
 * `+page.server.ts` because SvelteKit rejects any module-level export from a route file
 * beyond its own recognised set (`load`, `actions`, ...) - a plain exported function
 * there 500s the route at request time, not at build or test time, which is exactly the
 * kind of gap `pnpm check`/`vitest` never touches and a real page load does.
 */
import { isCurrency } from '@canonry/ai';

const PRICE_PATTERN = /^\d+(\.\d{1,6})?$/;

/** Parses the amount typed into the image price field - never a currency conversion, on
 * purpose (issue #221): whatever number was typed is exactly what gets stored, in
 * whichever currency `parseCurrency` below reads alongside it. `computeCost`
 * (`@canonry/ai/usage.ts`) is the only place that number ever turns into euros. */
export function parsePricePerImage(raw: FormDataEntryValue | null): number | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!PRICE_PATTERN.test(trimmed)) return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/** Narrows the raw currency field to one `toEur` can actually convert. The select this
 * feeds (`CurrencySelect.svelte`) offers exactly `CURRENCIES`, so in practice this only
 * ever rejects a hand-crafted request - but it is the same defense-in-depth the text
 * save already applies to `provider` via `isKnownProvider`. */
export function parseCurrency(raw: FormDataEntryValue | null): string | null {
	return typeof raw === 'string' && isCurrency(raw) ? raw : null;
}

/** The only `params` keys the image price form renders and therefore owns (issue
 * #235) - passed as `upsertImageModel`'s `paramKeys` so every other key already on the
 * row (`imagesPerRequest`, seeded by migration 0011 and rendered by nothing here)
 * survives a save through this form untouched. */
export const IMAGE_PRICE_PARAM_KEYS = ['pricePerImage', 'currency'] as const;
