import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	integer,
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
import { narrationStyle } from './narration.js';

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
		// The Loremaster's voice for this world (issue #451, decision U2): a pointer to a
		// shipped preset or to this universe's own custom row, resolved by
		// `loremasterVoiceInstruction` (packages/copilot/src/speech.ts). Set null rather
		// than cascade, same reasoning as `imageStyleId` above. Replaces the old
		// `loremaster_description` column - migration 0050 moved any real text a GM had
		// already written into a custom `narration_style` row and pointed this at it, so
		// nothing already written was lost.
		narrationStyleId: uuid('narration_style_id').references((): AnyPgColumn => narrationStyle.id, {
			onDelete: 'set null'
		}),
		// Decision C10 (docs/design/DECISIONS.md): the per-universe AI on/off switch. Guardrail 4
		// requires that turning this off still leaves a good wiki.
		aiEnabled: boolean('ai_enabled').notNull().default(true),
		// Decision C3 amendment (docs/design/DECISIONS.md "Round nine", SPEC.md §5.1): how many
		// entries a save's propagation plan may surface, replacing the old hardcoded ~10.
		// Null means no limit - a real value rather than a sentinel like 0 or 9999, because
		// "give me everything" and "the default applies" have to stay two states a query can
		// actually tell apart, not the same column read two ways. `effectiveCap`
		// (packages/copilot/src/reject-signal.ts) is the only thing allowed to tighten this,
		// and it must never turn a null back into a number - a GM who asked for everything
		// does not silently get three.
		//
		// Default null (decision U3, issue #451): no limit. 25 was a real number derived
		// from what a plan actually costs, but a default that silently truncates the
		// propagation of a well-connected entry, with no way for the GM to learn what was
		// dropped, is the opposite of guardrail 7's promise. A universe already sitting at
		// 25 keeps it - migration 0050 only drops the column default, it never rewrites a
		// stored value, because a migration cannot tell a default nobody chose from a cap
		// a GM set on purpose.
		propagationCap: integer('propagation_cap'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('universe_slug_key').on(t.slug),
		check(
			'universe_derived_has_base',
			sql`(${t.kind} = 'derived' and ${t.baseUniverseId} is not null) or (${t.kind} = 'homebrew' and ${t.baseUniverseId} is null)`
		),
		check(
			'universe_propagation_cap_positive',
			sql`${t.propagationCap} is null or ${t.propagationCap} > 0`
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
