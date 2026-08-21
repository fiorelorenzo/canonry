/**
 * One universe per import source.
 *
 * The first version of the end-to-end runner used a single universe and emptied it between
 * sources, which destroyed the evidence it had just produced: `proposal.target_entity_id`
 * is `ON DELETE CASCADE`, so deleting the entities took every `update` and `relation`
 * proposal with them and left a database in which only the `create` proposals of the last
 * source survived. The counts in the report were still right, because they were read
 * before the delete, but nothing could be checked afterwards, which is half the point of
 * running this against a real database.
 *
 * Separate universes also make the run closer to the truth: `queryLore` filters on
 * `universe_id` and SPEC.md §11.3 calls cross-universe contamination a bug, so seven
 * imports into seven universes is the shape a real deployment has.
 */
import { eq, type Db } from '@canonry/db';
import { universe, universeMember } from '@canonry/db/schema';

export async function universeForSource(db: Db, userId: string, source: string): Promise<string> {
	const slug = `bench-import-${source}`;
	const existing = await db
		.select({ id: universe.id })
		.from(universe)
		.where(eq(universe.slug, slug))
		.limit(1);
	const found = existing[0]?.id;
	if (found) return found;

	const inserted = await db
		.insert(universe)
		.values({
			ownerUserId: userId,
			name: `Valdoria Reach (import: ${source})`,
			slug,
			kind: 'homebrew'
		})
		.returning({ id: universe.id });
	const id = inserted[0]?.id;
	if (!id) throw new Error(`universe insert for ${source} returned no row`);
	await db
		.insert(universeMember)
		.values({ universeId: id, userId, role: 'owner' })
		.onConflictDoNothing();
	return id;
}
