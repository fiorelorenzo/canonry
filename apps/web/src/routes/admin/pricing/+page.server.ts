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
import { messages } from '$lib/i18n';
import { desc, inArray, listPrices, OperationNotPricedError, setPrice } from '@canonry/db';
import { operationPriceChange, user } from '@canonry/db/schema';
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

	// changedBy is a Better Auth user id (issue #86); resolve to an email for the
	// panel rather than showing the raw id, which means nothing to a reader.
	const changedByIds = changes
		.map((change) => change.changedBy)
		.filter((id): id is string => id !== null);
	const emailById = new Map<string, string>();
	if (changedByIds.length > 0) {
		const staffUsers = await database
			.select({ id: user.id, email: user.email })
			.from(user)
			.where(inArray(user.id, changedByIds));
		for (const row of staffUsers) emailById.set(row.id, row.email);
	}

	const lastChangeByOperation = new Map(
		changes.map((change) => [
			change.operation,
			{
				oldCredits: change.oldCredits,
				newCredits: change.newCredits,
				changedBy: change.changedBy ? (emailById.get(change.changedBy) ?? change.changedBy) : null,
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
				error: messages(event.locals.locale).admin.pricing.errors.missingOperation
			});
		}

		const credits = parseCredits(rawCredits);
		if (credits === null) {
			return fail(400, {
				operation,
				credits: typeof rawCredits === 'string' ? rawCredits : '',
				saved: false,
				error: messages(event.locals.locale).admin.pricing.errors.invalidCredits
			});
		}

		try {
			// requireAdmin above guarantees a signed-in, staff-listed user, so this is a
			// real identity (issue #86), not the null the shared-secret gate left behind.
			await setPrice(db(), { operation, credits, changedBy: event.locals.user!.id });
		} catch (err) {
			if (err instanceof OperationNotPricedError) {
				return fail(400, {
					operation,
					credits: rawCredits,
					saved: false,
					error: messages(event.locals.locale).admin.pricing.errors.unknownOperation(operation)
				});
			}
			throw err;
		}

		clearPriceCache();

		return { operation, credits, saved: true };
	}
};
