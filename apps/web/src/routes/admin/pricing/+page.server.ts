/**
 * /admin/pricing (issue #113): every operation_price row, grouped by kind in the
 * page component, with its label, credits and notes, plus the most recent audit
 * row per operation so "who made portraits free in March" has an answer. A save
 * goes through @canonry/db's setPrice, which writes operation_price_change in the
 * same transaction as the price update, then clears @canonry/ai's price cache so
 * the next chargeable call sees the new price immediately rather than after its
 * 30 second TTL - the ai-game behaviour issue #113 exists to avoid.
 */
import { fail } from '@sveltejs/kit';
import { desc, listPrices, OperationNotPricedError, setPrice } from '@canonry/db';
import { operationPriceChange } from '@canonry/db/schema';
import { clearPriceCache } from '@canonry/ai';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const database = db();
	const prices = await listPrices(database);

	// One row per operation: the most recent operation_price_change, not the whole
	// history - the panel answers "who changed this last", the full trail is a
	// database query away for whoever needs more than that.
	const changes = await database
		.selectDistinctOn([operationPriceChange.operation])
		.from(operationPriceChange)
		.orderBy(operationPriceChange.operation, desc(operationPriceChange.changedAt));

	const lastChangeByOperation = new Map(
		changes.map((change) => [
			change.operation,
			{
				oldCredits: change.oldCredits,
				newCredits: change.newCredits,
				changedBy: change.changedBy,
				changedAt: change.changedAt
			}
		])
	);

	return { prices, lastChangeByOperation };
};

// Matches the operation_price.credits column: non-negative, at most 4 decimal
// places, no sign, no scientific notation. A value that fails this never reaches
// setPrice - rejected with a message next to the field, not coerced or rounded.
const CREDITS_PATTERN = /^\d+(\.\d{1,4})?$/;

function parseCredits(raw: FormDataEntryValue | null): number | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!CREDITS_PATTERN.test(trimmed)) return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

export const actions: Actions = {
	default: async (event) => {
		// The layout's load already gates page views; a POST runs before any layout load
		// (see src/lib/server/admin.ts), so the action needs its own check.
		requireAdmin(event);

		const formData = await event.request.formData();
		const operation = formData.get('operation');
		const rawCredits = formData.get('credits');

		if (typeof operation !== 'string' || operation.length === 0) {
			return fail(400, {
				operation: null,
				credits: null,
				saved: false,
				error: 'Missing operation.'
			});
		}

		const credits = parseCredits(rawCredits);
		if (credits === null) {
			return fail(400, {
				operation,
				credits: typeof rawCredits === 'string' ? rawCredits : '',
				saved: false,
				error: 'Enter a non-negative number, up to 4 decimal places.'
			});
		}

		try {
			// changedBy stays null until #86 gives the admin panel a real staff identity to
			// record - the shared-secret gate this issue ships with has nobody to name yet.
			await setPrice(db(), { operation, credits, changedBy: null });
		} catch (err) {
			if (err instanceof OperationNotPricedError) {
				return fail(400, {
					operation,
					credits: rawCredits,
					saved: false,
					error: `"${operation}" is not a known operation.`
				});
			}
			throw err;
		}

		clearPriceCache();

		return { operation, credits, saved: true };
	}
};
