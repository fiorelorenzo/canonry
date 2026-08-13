import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { universeKindEnum, universeMemberRoleEnum } from './enums.js';

// SPEC.md §4.1: the container of canon. A `derived` universe reads from its own canon plus
// an official pre-indexed universe underneath it; `homebrew` stands alone.
export const universe = pgTable(
	'universe',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// Better Auth owns the user table (#86); no fk here, just the id it hands us.
		// Slugs are namespaced under this so two owners can each have a "waterdeep".
		ownerUserId: text('owner_user_id').notNull(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		kind: universeKindEnum('kind').notNull(),
		baseUniverseId: uuid('base_universe_id').references((): AnyPgColumn => universe.id),
		// No fk yet: the image style catalogue lands in #65.
		imageStyleId: uuid('image_style_id'),
		loremasterDescription: text('loremaster_description').notNull().default(''),
		// Decision C10 (docs/ux/DECISIONS.md): the per-universe AI on/off switch. Guardrail 4
		// requires that turning this off still leaves a good wiki.
		aiEnabled: boolean('ai_enabled').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('universe_owner_slug_key').on(t.ownerUserId, t.slug),
		check(
			'universe_derived_has_base',
			sql`(${t.kind} = 'derived' and ${t.baseUniverseId} is not null) or (${t.kind} = 'homebrew' and ${t.baseUniverseId} is null)`
		)
	]
);

// SPEC.md §4.1 membership. Deleting a universe removes its memberships; Better Auth deleting
// a user does not cascade here, since we hold no fk to it.
export const universeMember = pgTable(
	'universe_member',
	{
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		// Better Auth owns the user table (#86); no fk here.
		userId: text('user_id').notNull(),
		role: universeMemberRoleEnum('role').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.universeId, t.userId] })]
);
