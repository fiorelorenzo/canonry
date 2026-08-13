import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { modelCallAgentEnum, modelPurposeEnum } from './enums.js';
import { universe } from './universe.js';

// SPEC.md §5.1, §9: "the active model lives in the database and is the one always used",
// switchable without a deploy. Only one active row per purpose - resolveModel in
// @canonry/ai reads the active row for a purpose with a short TTL cache.
export const modelConfig = pgTable(
	'model_config',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		purpose: modelPurposeEnum('purpose').notNull(),
		provider: text('provider').notNull(),
		modelId: text('model_id').notNull(),
		active: boolean('active').notNull().default(true),
		// App-defined shape (pricing, routing hints); @canonry/db does not interpret it.
		params: jsonb('params').notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('model_config_active_purpose_key')
			.on(t.purpose)
			.where(sql`${t.active} = true`)
	]
);

// SPEC.md §11.5: "Every model call is attributed: user, universe, agent, operation,
// input/output/embedding tokens, credits." Without this the included-quota pricing is
// blind and the warm cache is unbudgetable.
export const modelCall = pgTable(
	'model_call',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// Better Auth owns the user table (#86); no fk here.
		userId: text('user_id').notNull(),
		// Nullable, set null on delete: cost history must survive a universe being deleted,
		// unlike canon content which cascades away with it.
		universeId: uuid('universe_id').references(() => universe.id, { onDelete: 'set null' }),
		agent: modelCallAgentEnum('agent').notNull(),
		operation: text('operation').notNull(),
		provider: text('provider').notNull(),
		modelId: text('model_id').notNull(),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		embeddingTokens: integer('embedding_tokens').notNull().default(0),
		credits: numeric('credits', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
		costEur: numeric('cost_eur', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
		latencyMs: integer('latency_ms').notNull(),
		requestId: text('request_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('model_call_universe_created_idx').on(t.universeId, t.createdAt),
		index('model_call_user_created_idx').on(t.userId, t.createdAt)
	]
);
