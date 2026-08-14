import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { operationPriceKindEnum } from './enums.js';

// SPEC.md §15, issue #113: the credit price of every chargeable operation lives here, not
// in code, so an admin edits it and the change takes effect without a deploy. A price of
// zero is a legitimate value - that is the whole mechanism behind reading staying free,
// not a special case bolted onto the meter. There is no "missing row means free" fallback
// anywhere: @canonry/db's priceOf throws for an unpriced operation, because a silent zero
// is how ai-game's credit_costs table lets an operation become free by accident.
export const operationPrice = pgTable(
	'operation_price',
	{
		operation: text('operation').primaryKey(),
		label: text('label').notNull(),
		credits: numeric('credits', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
		kind: operationPriceKindEnum('kind').notNull(),
		// Why this number, for the next admin who finds a price and wonders where it came from.
		notes: text('notes'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		// Better Auth owns the user table (#86); no fk here, just the id it hands us, and null
		// until #86 gives an admin a real identity to record.
		updatedBy: text('updated_by')
	},
	(t) => [check('operation_price_credits_non_negative', sql`${t.credits} >= 0`)]
);

// The audit trail ai-game's credit_costs table does not have (issue #113): every price
// edit through @canonry/db's setPrice writes one row here in the same transaction as the
// price update, so "who made portraits free in March" has an answer. Restricted rather
// than cascaded on delete - a priced operation's history should outlive a mistaken row
// deletion, not vanish with it.
export const operationPriceChange = pgTable(
	'operation_price_change',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		operation: text('operation')
			.notNull()
			.references(() => operationPrice.operation),
		oldCredits: numeric('old_credits', { precision: 12, scale: 4, mode: 'number' }).notNull(),
		newCredits: numeric('new_credits', { precision: 12, scale: 4, mode: 'number' }).notNull(),
		// Better Auth owns the user table (#86); no fk here either, same as updated_by above.
		changedBy: text('changed_by'),
		changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('operation_price_change_operation_changed_idx').on(t.operation, t.changedAt)]
);
