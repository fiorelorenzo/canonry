import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { authorKindEnum } from './enums.js';
import { entity } from './entity.js';
import { universe } from './universe.js';

// SPEC.md §4.4: per-entry history, `author_kind` = `human` | `ai_accepted`. This is
// guardrail 2's persistence half - AI text stays tracked as such after acceptance.
export const revision = pgTable('revision', {
	id: uuid('id').primaryKey().defaultRandom(),
	universeId: uuid('universe_id')
		.notNull()
		.references(() => universe.id, { onDelete: 'cascade' }),
	entityId: uuid('entity_id')
		.notNull()
		.references(() => entity.id, { onDelete: 'cascade' }),
	parentRevisionId: uuid('parent_revision_id').references((): AnyPgColumn => revision.id),
	authorKind: authorKindEnum('author_kind').notNull(),
	// Set when author_kind = 'human'; null for an accepted AI proposal, which has no human
	// author, only a human acceptor recorded by the (later) proposal outcome.
	authorUserId: text('author_user_id'),
	// No fk yet: proposals land in #47.
	proposalId: uuid('proposal_id'),
	// Snapshot the history view needs, so historyFor never has to replay a diff chain.
	name: text('name').notNull(),
	aliases: text('aliases')
		.array()
		.notNull()
		.default(sql`'{}'::text[]`),
	body: text('body').notNull().default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
