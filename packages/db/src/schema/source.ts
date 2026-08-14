// SPEC.md §4.6, §6.4, §7. Everything about where canon came from: the import run, the
// reference that makes a second import an update instead of a duplicate world, and the
// indexed corpora a derived universe reads.
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
import { entity } from './entity.js';
import { dataSourceStatusEnum, dataSourceTypeEnum, importJobStatusEnum } from './enums.js';
import { universe } from './universe.js';

// SPEC.md §4.6: one run of the import agent, which is what makes a run resumable,
// auditable and billable. The playbook version is part of the fingerprint that decides
// whether a later run is an update or a no-op (§6.2, §6.4).
export const importJob = pgTable(
	'import_job',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		sourceType: text('source_type').notNull(),
		playbook: text('playbook').notNull(),
		playbookVersion: integer('playbook_version').notNull(),
		// Where the uploaded export lives while the job runs, under the app's own storage.
		artefactPath: text('artefact_path').notNull(),
		artefactBytes: integer('artefact_bytes').notNull().default(0),
		artefactSha256: text('artefact_sha256').notNull(),
		documentCount: integer('document_count').notNull().default(0),
		// SPEC.md §6.7: a per-job ceiling, an estimate before the run, and a clean stop when
		// it is reached with the proposals so far intact.
		budgetCredits: numeric('budget_credits', { precision: 12, scale: 4, mode: 'number' })
			.notNull()
			.default(0),
		spentCredits: numeric('spent_credits', { precision: 12, scale: 4, mode: 'number' })
			.notNull()
			.default(0),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		// SPEC.md §6.1: progress is checkpointed per document, so a crash costs one document
		// rather than an afternoon. Shape is the driver's, and the database does not read it.
		checkpoint: jsonb('checkpoint').notNull().default({}),
		status: importJobStatusEnum('status').notNull().default('queued'),
		// Why it stopped, in words a GM can act on, for a failure or a ceiling.
		outcomeNote: text('outcome_note').notNull().default(''),
		proposalsEmitted: integer('proposals_emitted').notNull().default(0),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('import_job_universe_created_idx').on(t.universeId, t.createdAt),
		index('import_job_status_idx').on(t.status)
	]
);

// SPEC.md §4.2 and §6.4: where an entity came from, and the content hash of what we last
// imported. This is what makes a second import update instead of duplicate, and the
// matching order of §6.4 starts with the external id in this table because that match is
// exact, free, and involves no model at all.
export const entitySourceRef = pgTable(
	'entity_source_ref',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		sourceSystem: text('source_system').notNull(),
		externalId: text('external_id'),
		sourceUrl: text('source_url'),
		// Hash of the source document as we last saw it, so an unchanged document is a
		// no-op rather than a diff to review.
		contentHash: text('content_hash').notNull(),
		// SPEC.md §6.4: an entity that disappeared from the source is never deleted. It is
		// marked, and the GM decides.
		missingInSource: boolean('missing_in_source').notNull().default(false),
		lastImportJobId: uuid('last_import_job_id').references(() => importJob.id, {
			onDelete: 'set null'
		}),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// The exact match of §6.4 step 1. Unique per source system so two systems can both
		// claim the same entity without colliding.
		uniqueIndex('entity_source_ref_external_key').on(t.sourceSystem, t.externalId),
		index('entity_source_ref_entity_idx').on(t.entityId)
	]
);

// SPEC.md §7: the pre-indexed universes, tracked the way ai-game tracks them, with the
// licence review that has to happen **before** indexing recorded next to the data itself.
// Not all wikis carry the same licence, so this is a per-source fact, never a global
// assumption.
export const dataSource = pgTable(
	'data_source',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// Null for a shared official corpus that several derived universes read.
		universeId: uuid('universe_id').references(() => universe.id, { onDelete: 'cascade' }),
		type: dataSourceTypeEnum('type').notNull(),
		name: text('name').notNull(),
		url: text('url'),
		config: jsonb('config').notNull().default({}),
		status: dataSourceStatusEnum('status').notNull().default('pending'),
		// Issue #61 and SPEC.md §7: the licence, who reviewed it and when. An unreviewed
		// source must not be indexed, and this is where that is auditable rather than
		// remembered.
		licence: text('licence'),
		licenceUrl: text('licence_url'),
		licenceReviewedAt: timestamp('licence_reviewed_at', { withTimezone: true }),
		licenceReviewedBy: text('licence_reviewed_by').references(() => user.id, {
			onDelete: 'set null'
		}),
		licenceNotes: text('licence_notes').notNull().default(''),
		// Attribution shown on every answer that used this source (SPEC.md §7, issue #60).
		attribution: text('attribution').notNull().default(''),
		lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
		chunkCount: integer('chunk_count').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('data_source_universe_idx').on(t.universeId, t.status)]
);

// SPEC.md §7: "an exclusion list, honoured on request". A pattern rather than an id,
// because the request arrives as "stop using this wiki" or "stop using these pages".
export const dataSourceExclusion = pgTable(
	'data_source_exclusion',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		dataSourceId: uuid('data_source_id').references(() => dataSource.id, {
			onDelete: 'cascade'
		}),
		// Matched against a chunk's page url at retrieval time (issue #62). A row with no
		// data source excludes the pattern everywhere.
		urlPattern: text('url_pattern').notNull(),
		reason: text('reason').notNull().default(''),
		requestedBy: text('requested_by').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('data_source_exclusion_source_idx').on(t.dataSourceId)]
);

// SPEC.md §4.1: a derived universe may declare that one of its entries **supersedes** a
// specific source page, which then disappears from retrieval for that universe. Without
// this, a GM who diverges from the published canon gets it quoted back at them.
export const supersede = pgTable(
	'supersede',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		dataSourceId: uuid('data_source_id')
			.notNull()
			.references(() => dataSource.id, { onDelete: 'cascade' }),
		// The page this entry replaces, by url, since that is what retrieval filters on.
		sourceUrl: text('source_url').notNull(),
		note: text('note').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('supersede_universe_url_key').on(t.universeId, t.sourceUrl)]
);
