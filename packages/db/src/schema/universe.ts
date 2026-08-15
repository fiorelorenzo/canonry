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
import { user } from './auth.js';
import { universeKindEnum, universeMemberRoleEnum } from './enums.js';
import { imageStyle } from './media.js';

// SPEC.md §4.1: the container of canon. A `derived` universe reads from its own canon plus
// an official pre-indexed universe underneath it; `homebrew` stands alone.
export const universe = pgTable(
	'universe',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// The fk exists now that Better Auth's user table does (#86): deleting an account
		// takes its worlds with it, which is what a deletion request has to mean.
		ownerUserId: text('owner_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// Globally unique (decision J1, issue #153): a world's URL carries no owner
		// (/w/<slug>), so two worlds cannot share one without one of them becoming
		// unreachable depending on Postgres's scan order. See universe_slug_key below.
		slug: text('slug').notNull(),
		kind: universeKindEnum('kind').notNull(),
		baseUniverseId: uuid('base_universe_id').references((): AnyPgColumn => universe.id),
		// The style every image in this universe is generated with (SPEC.md §9, #65).
		// Set null rather than cascade: losing a style must not delete a world.
		imageStyleId: uuid('image_style_id').references((): AnyPgColumn => imageStyle.id, {
			onDelete: 'set null'
		}),
		loremasterDescription: text('loremaster_description').notNull().default(''),
		// Decision C10 (docs/ux/DECISIONS.md): the per-universe AI on/off switch. Guardrail 4
		// requires that turning this off still leaves a good wiki.
		aiEnabled: boolean('ai_enabled').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('universe_slug_key').on(t.slug),
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
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: universeMemberRoleEnum('role').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.universeId, t.userId] })]
);
