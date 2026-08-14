// SPEC.md §4.4 and §5.1. The proposal is the whole product in one table: the unapplied
// diff, its evidence, what it cost, and what the human decided. Guardrail 1 lives here,
// because nothing writes canon except an accept that flips `outcome` and writes a
// revision with author_kind 'ai_accepted'.
//
// `proposal.outcome` with its reject reason IS the instrumentation of the accept rate,
// which SPEC.md §14 calls the metric that decides whether this product works. It is a
// query over this table rather than a later addition, so the columns it needs are here
// from the first migration that creates it.
import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { entity } from './entity.js';
import {
	authorKindEnum,
	proposalKindEnum,
	proposalOutcomeEnum,
	proposalPlanStatusEnum,
	proposalTriggerEnum
} from './enums.js';
import { relationType } from './relation.js';
import { revision } from './revision.js';
import { importJob } from './source.js';
import { universe } from './universe.js';

// SPEC.md §5.1 step 3: "a readable, editable plan: this change touches 4 entries, here is
// why", and the GM can drop entries before any diff is generated. The plan exists as its
// own row because dropping an entry from it has to be cheap and has to happen before the
// premium model is paid to write anything (decision C3).
export const proposalPlan = pgTable(
	'proposal_plan',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		trigger: proposalTriggerEnum('trigger').notNull(),
		// The edit that started it. Null for a plan that came from an import.
		triggerEntityId: uuid('trigger_entity_id').references(() => entity.id, {
			onDelete: 'cascade'
		}),
		triggerRevisionId: uuid('trigger_revision_id').references((): AnyPgColumn => revision.id, {
			onDelete: 'set null'
		}),
		// The import run that produced this plan, for trigger = 'import'. Null otherwise.
		// Lets a review screen join straight to the job instead of matching on
		// evidence->>'documentId' against import_job.checkpoint, which is only an
		// approximate join since two different jobs can reuse the same document id.
		importJobId: uuid('import_job_id').references(() => importJob.id, { onDelete: 'set null' }),
		summary: text('summary').notNull().default(''),
		status: proposalPlanStatusEnum('status').notNull().default('planning'),
		// What generating the surviving diffs is expected to cost, shown before it is spent.
		estimatedCredits: numeric('estimated_credits', { precision: 12, scale: 4, mode: 'number' })
			.notNull()
			.default(0),
		// SPEC.md §5.1: "Cap: ~10 entries per plan", because without a ceiling the copilot
		// becomes noise. Stored per plan so the cap is auditable rather than implicit.
		candidateCap: integer('candidate_cap').notNull().default(10),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('proposal_plan_universe_created_idx').on(t.universeId, t.createdAt)]
);

export const proposal = pgTable(
	'proposal',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		planId: uuid('plan_id').references(() => proposalPlan.id, { onDelete: 'cascade' }),
		trigger: proposalTriggerEnum('trigger').notNull(),
		kind: proposalKindEnum('kind').notNull(),
		// Null for `create` and `draft_entity`: there is no target entry yet.
		targetEntityId: uuid('target_entity_id').references(() => entity.id, { onDelete: 'cascade' }),
		// For a relation proposal, which relation type and which other end.
		relationTypeId: uuid('relation_type_id').references(() => relationType.id, {
			onDelete: 'set null'
		}),
		relatedEntityId: uuid('related_entity_id').references(() => entity.id, {
			onDelete: 'cascade'
		}),
		// The unapplied change. Shape is the app's, and the database does not interpret it.
		patch: jsonb('patch').notNull(),
		rationale: text('rationale').notNull().default(''),
		// Guardrail 3: every proposal shows its evidence, which entry and which sentence,
		// and never a bare confidence score. This column is that evidence: the source
		// entity, the source revision, the span, and the path it travelled (a relation and
		// a hop count, or "similar wording only"). A score alone is not acceptable here,
		// and decision C5 spells out what replaces it.
		evidence: jsonb('evidence').notNull().default({}),
		// Ordering inside a plan, which is what survives the cap (decision C3).
		rank: integer('rank').notNull().default(0),
		provider: text('provider'),
		modelId: text('model_id'),
		credits: numeric('credits', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
		outcome: proposalOutcomeEnum('outcome').notNull().default('pending'),
		// SPEC.md §5.1: rejection asks for a one word reason, which is training signal for
		// the ranking rather than a survey (decision C7).
		rejectReason: text('reject_reason'),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
		// The revision an accept produced, which is how a proposal and the canon it wrote
		// stay tied together after the fact.
		appliedRevisionId: uuid('applied_revision_id').references((): AnyPgColumn => revision.id, {
			onDelete: 'set null'
		}),
		authorKind: authorKindEnum('author_kind').notNull().default('ai_accepted'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('proposal_universe_outcome_idx').on(t.universeId, t.outcome, t.createdAt),
		index('proposal_plan_rank_idx').on(t.planId, t.rank),
		index('proposal_target_idx').on(t.targetEntityId),
		// The accept rate query, which SPEC.md §14 makes the metric that matters, reads
		// outcomes over time. Kept as its own index so that query never scans the table.
		index('proposal_outcome_decided_idx')
			.on(t.outcome, t.decidedAt)
			.where(sql`${t.decidedAt} is not null`)
	]
);
