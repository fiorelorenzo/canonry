// Issue #154: what Better Auth's `deleteUser` cascade actually destroys, counted rather
// than estimated. `universe.owner_user_id` is `ON DELETE CASCADE` (packages/db/src/schema/
// universe.ts), and `entity`, `revision`, `proposal` and `media_asset` all cascade off
// `universe_id` in turn, so every owned universe takes its whole tree with it. The
// account-deletion screen reads this before it ever shows a confirmation control - a GM
// who imported a 214 entry world deserves that number, not a generic warning.
import { count, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import { mediaAsset } from '../schema/media.js';
import { proposal } from '../schema/proposal.js';
import { revision } from '../schema/revision.js';
import { universe } from '../schema/universe.js';

export interface AccountDeletionImpact {
	universes: number;
	entities: number;
	revisions: number;
	proposals: number;
	images: number;
}

/** Every universe `userId` owns, and the four cascaded tables' row counts across all of
 * them. Zero owned universes short-circuits the four scoped counts the same way
 * `entityCountsByUniverseIds` treats an empty id list - there is nothing those queries
 * could find. `entity`/`revision`/`proposal`/`media_asset` each carry their own
 * `universe_id` column (none of the four are reached only through a join), so one
 * `inArray` count per table is exact, not an estimate. */
export async function accountDeletionImpact(
	db: Db,
	userId: string
): Promise<AccountDeletionImpact> {
	const owned = await db
		.select({ id: universe.id })
		.from(universe)
		.where(eq(universe.ownerUserId, userId));
	const universes = owned.length;
	if (universes === 0) {
		return { universes: 0, entities: 0, revisions: 0, proposals: 0, images: 0 };
	}

	const ownedUniverseIds = owned.map((row) => row.id);
	const [entityRows, revisionRows, proposalRows, imageRows] = await Promise.all([
		db.select({ total: count() }).from(entity).where(inArray(entity.universeId, ownedUniverseIds)),
		db
			.select({ total: count() })
			.from(revision)
			.where(inArray(revision.universeId, ownedUniverseIds)),
		db
			.select({ total: count() })
			.from(proposal)
			.where(inArray(proposal.universeId, ownedUniverseIds)),
		db
			.select({ total: count() })
			.from(mediaAsset)
			.where(inArray(mediaAsset.universeId, ownedUniverseIds))
	]);

	return {
		universes,
		entities: entityRows[0]?.total ?? 0,
		revisions: revisionRows[0]?.total ?? 0,
		proposals: proposalRows[0]?.total ?? 0,
		images: imageRows[0]?.total ?? 0
	};
}
