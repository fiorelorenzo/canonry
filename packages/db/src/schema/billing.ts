// SPEC.md §15 and §11.5. What a user has, what they spent it on, and the key they brought
// themselves. The price of an operation lives in `operation_price` (see prices.ts); this is
// the balance side, which is deliberately separate: a price is a product decision an admin
// edits, a balance is an account fact only a payment or a spend may change.
import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { creditTransactionKindEnum } from './enums.js';
import { modelCall } from './model.js';
import { universe } from './universe.js';

// SPEC.md §15: included quota, never "unlimited", with a stated ceiling. Two balances
// rather than one, following ai-game: the subscription's monthly allowance is spent first
// and expires with the period, while purchased credits do not expire. Collapsing them into
// one number makes a refund ambiguous and makes "what do I lose if I cancel" unanswerable.
export const userBilling = pgTable('user_billing', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	subscriptionCredits: numeric('subscription_credits', {
		precision: 12,
		scale: 4,
		mode: 'number'
	})
		.notNull()
		.default(0),
	purchasedCredits: numeric('purchased_credits', { precision: 12, scale: 4, mode: 'number' })
		.notNull()
		.default(0),
	// The warm cache draws on its own budget (SPEC.md §8.1, §15), because it spends when
	// nobody is watching and an invisible spend is how a quota loses its meaning.
	warmBudgetCredits: numeric('warm_budget_credits', { precision: 12, scale: 4, mode: 'number' })
		.notNull()
		.default(0),
	warmBudgetSpent: numeric('warm_budget_spent', { precision: 12, scale: 4, mode: 'number' })
		.notNull()
		.default(0),
	// SPEC.md §6.7 wants a per-user import quota "in jobs and documents as well as in
	// currency", because one enormous world can consume a month without exceeding any
	// euro ceiling. Null means no cap of this kind, which is not the same as unlimited:
	// the currency ceiling and the queue still apply, and §15 forbids ever saying
	// unlimited to a user. Usage is counted from import_job rows over the period rather
	// than kept as a running total, so a cancelled job cannot leak quota.
	importJobsQuota: integer('import_jobs_quota'),
	importDocumentsQuota: integer('import_documents_quota'),
	periodStart: timestamp('period_start', { withTimezone: true }).notNull().defaultNow(),
	periodEnd: timestamp('period_end', { withTimezone: true }),
	plan: text('plan').notNull().default('free'),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// Every movement, in both directions, with the call it paid for. The idempotency key is
// what makes a retried payment webhook or a retried spend safe, which ai-game learned by
// putting a unique index on its own external reference.
export const creditTransaction = pgTable(
	'credit_transaction',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		universeId: uuid('universe_id').references(() => universe.id, { onDelete: 'set null' }),
		kind: creditTransactionKindEnum('kind').notNull(),
		// Negative for a spend, positive for a grant or a refund, so the balance is the sum
		// and a mistake is visible as a row rather than as a missing one.
		credits: numeric('credits', { precision: 12, scale: 4, mode: 'number' }).notNull(),
		operation: text('operation'),
		modelCallId: uuid('model_call_id').references(() => modelCall.id, { onDelete: 'set null' }),
		// Stripe's event id, an import job id, whatever the caller can repeat safely.
		idempotencyKey: text('idempotency_key'),
		note: text('note').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('credit_transaction_user_created_idx').on(t.userId, t.createdAt),
		uniqueIndex('credit_transaction_idempotency_key')
			.on(t.kind, t.idempotencyKey)
			.where(sql`${t.idempotencyKey} is not null`)
	]
);

// SPEC.md §15: bring your own key stays available and is never the default. Stored
// encrypted at rest with a key from the environment, which is why only the ciphertext and
// the last four characters live here: the last four are for the settings page to show
// which key is configured without ever decrypting to display it.
export const byoKey = pgTable(
	'byo_key',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		ciphertext: text('ciphertext').notNull(),
		lastFour: text('last_four').notNull(),
		active: boolean('active').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true })
	},
	(t) => [uniqueIndex('byo_key_user_provider_key').on(t.userId, t.provider)]
);
