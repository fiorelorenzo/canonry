// SPEC.md §4.3. A work is a oneshot, a campaign module, a long campaign, a short story or
// a novel, modelled separately from the universe because it has a different shape and a
// different lifecycle. The link runs both ways: a scene records which entries it uses, so
// changing Aldric Vane can say that scene 3 of chapter 2 is affected, and what happens
// while writing or playing flows back into the universe as proposals rather than writes.
import {
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { entity } from './entity.js';
import { workNodeKindEnum, workStatusEnum, workTypeEnum } from './enums.js';
import { universe } from './universe.js';

export const work = pgTable(
	'work',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		type: workTypeEnum('type').notNull(),
		status: workStatusEnum('status').notNull().default('planning'),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		summary: text('summary').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('work_universe_slug_key').on(t.universeId, t.slug)]
);

// An ordered tree. `parentId` plus `position` is enough for act, chapter, scene and
// encounter without a table per level, and the unique index on (parent, position) is what
// stops two siblings claiming the same place after a drag and drop.
export const workNode = pgTable(
	'work_node',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workId: uuid('work_id')
			.notNull()
			.references(() => work.id, { onDelete: 'cascade' }),
		parentId: uuid('parent_id'),
		kind: workNodeKindEnum('kind').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull().default(''),
		position: integer('position').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('work_node_work_parent_idx').on(t.workId, t.parentId, t.position),
		uniqueIndex('work_node_sibling_position_key').on(t.workId, t.parentId, t.position)
	]
);

// SPEC.md §4.3: "work_node_entity records which entries a scene uses, so changing Aldric
// tells you that scene 3 of chapter 2 is affected". Decision B5 renders that as a read
// only signal on the scene rather than as a second proposal inbox.
export const workNodeEntity = pgTable(
	'work_node_entity',
	{
		nodeId: uuid('node_id')
			.notNull()
			.references(() => workNode.id, { onDelete: 'cascade' }),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		// How the scene uses it, in the GM's words. Not a taxonomy.
		note: text('note').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.nodeId, t.entityId] }),
		index('work_node_entity_entity_idx').on(t.entityId)
	]
);
