import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { operationPrice, operationPriceChange } from '../schema/prices.js';
import type { OperationPriceKind } from '../schema/enums.js';

export interface PriceRow {
	operation: string;
	label: string;
	credits: number;
	kind: OperationPriceKind;
	notes: string | null;
	updatedAt: Date;
	updatedBy: string | null;
}

/** Thrown by priceOf and setPrice for an operation with no operation_price row. SPEC.md
 * §15: "an operation nobody has priced must fail loudly rather than silently charge
 * nothing" - a missing row is never treated as a price of zero. */
export class OperationNotPricedError extends Error {
	constructor(operation: string) {
		super(`no operation_price row for operation "${operation}"`);
		this.name = 'OperationNotPricedError';
	}
}

/** Uncached read of one operation's current price. Throws OperationNotPricedError rather
 * than returning null - see the class doc. Hot callers (every chargeable AI call) should
 * go through @canonry/ai's chargeFor instead, which wraps this with a short TTL cache. */
export async function priceOf(db: Db, operation: string): Promise<PriceRow> {
	const rows = await db
		.select()
		.from(operationPrice)
		.where(eq(operationPrice.operation, operation))
		.limit(1);
	const row = rows[0];
	if (!row) throw new OperationNotPricedError(operation);
	return row;
}

/** Every priced operation, for the admin panel's catalogue view. Grouped by kind so
 * reading, generation and import sort together. */
export async function listPrices(db: Db): Promise<PriceRow[]> {
	return db
		.select()
		.from(operationPrice)
		.orderBy(asc(operationPrice.kind), asc(operationPrice.operation));
}

export interface SetPriceInput {
	operation: string;
	credits: number;
	/** Who made the change, for the audit row. Null until #86 gives the admin panel real
	 * staff identities; the shared-secret gate issue #113 ships with has no user to name. */
	changedBy?: string | null;
}

/** Changes an operation's price and writes the audit row that ai-game's credit_costs table
 * never had (issue #113), in one transaction: either both the price update and the
 * operation_price_change row land, or neither does. Locks the row first (SELECT ... FOR
 * UPDATE) so two concurrent admin edits cannot race past each other and lose an audit
 * entry. Requires the operation to already have a price row - like priceOf, this never
 * silently creates one; the catalogue is seeded, not grown ad hoc from an admin form. */
export async function setPrice(db: Db, input: SetPriceInput): Promise<PriceRow> {
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(operationPrice)
			.where(eq(operationPrice.operation, input.operation))
			.for('update')
			.limit(1);
		const before = existing[0];
		if (!before) throw new OperationNotPricedError(input.operation);

		const [updated] = await tx
			.update(operationPrice)
			.set({
				credits: input.credits,
				updatedAt: new Date(),
				updatedBy: input.changedBy ?? null
			})
			.where(eq(operationPrice.operation, input.operation))
			.returning();
		if (!updated) {
			throw new Error(`setPrice: update returned no row for operation "${input.operation}"`);
		}

		await tx.insert(operationPriceChange).values({
			operation: input.operation,
			oldCredits: before.credits,
			newCredits: updated.credits,
			changedBy: input.changedBy ?? null
		});

		return updated;
	});
}
