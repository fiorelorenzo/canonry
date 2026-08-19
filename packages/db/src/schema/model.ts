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
import { user } from './auth.js';
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
		// The fk exists now that Better Auth's user table does (#86), and it sets null rather
		// than cascading, which is deliberate: deleting an account must not delete the cost
		// history, because that is how the margin question of SPEC.md §11.5 stays answerable,
		// and a deletion request wants the person unlinked rather than the arithmetic
		// rewritten. Nullable for the same reason, plus the calls that have no user at all:
		// nightly warming and indexing run for a universe, not for somebody.
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
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
		// A provider's own metered unit for one call - ElevenLabs' `character-cost` response
		// header on the sound-generation endpoint, credits rather than characters despite the
		// header's name (issue #116). Null for every call whose provider does not bill in its
		// own credits (every text/embedding/image row today): that is "not applicable", not
		// "zero credits used", so it stays a separate column rather than overloading
		// input/output/embedding tokens with a unit those columns were never about. Read
		// alongside cost_eur, not instead of it - on a plan where the provider's price per
		// credit is genuinely 0, this is the only column that still says anything happened.
		providerCredits: integer('provider_credits'),
		// scale 10, not 6: at qwen3-embedding-4b's rate a short embedding call costs about
		// 0.0000002 EUR, which rounded to zero at scale 6 and quietly removed the highest-volume
		// call in the product from every cost sum (migration 0026).
		costEur: numeric('cost_eur', { precision: 14, scale: 10, mode: 'number' }).notNull().default(0),
		latencyMs: integer('latency_ms').notNull(),
		requestId: text('request_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('model_call_universe_created_idx').on(t.universeId, t.createdAt),
		index('model_call_user_created_idx').on(t.userId, t.createdAt)
	]
);
