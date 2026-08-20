/**
 * Loads everything the fixed sidebar (A2 = A) needs for every route nested under a
 * universe, Entry's entry and editor routes included: the current universe, every
 * universe for the switcher, and a short Recent list.
 *
 * Issue #86: real ownership and membership gate this now. `universeAccessBySlug`
 * returns null both for a slug that does not exist and for one that exists but this
 * account cannot see - the same 404 either way, so a probe cannot learn which case it
 * hit (the pattern requireAdmin already uses for /admin, for the same reason).
 *
 * Issue #379, decision R4 (DECISIONS.md "Round thirteen"): `setupItems` is
 * `universeSetupItems()` (`$lib/server/universe-setup`) run against this universe's
 * row, never the row's own `imageStyleId`/`loremasterDescription` - `UniverseSetupItem`
 * carries only an id and a `done` boolean, so the sidebar can count what is unset
 * without this payload ever widening past that. `UniverseSummary` (the switcher's own
 * shape) is untouched: only the current universe's checklist is relevant here, not
 * every universe's.
 */
import { error } from '@sveltejs/kit';
import { universeAccessBySlug, universesForUser } from '@canonry/db';
import { db } from '$lib/server/db';
import { pendingProposalCount } from '$lib/server/proposals';
import { universeSetupItems } from '$lib/server/universe-setup';
import type { UniverseSummary } from '$lib/components/shell/types';
import type { LayoutServerLoad } from './$types';

const SIDEBAR_RECENT_LIMIT = 5;

export const load: LayoutServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);

	const database = db();

	const access = await universeAccessBySlug(database, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);
	const currentRow = access.universe;

	const memberRows = await universesForUser(database, locals.user.id);
	const nameById = new Map(memberRows.map((row) => [row.id, row.name]));

	const universes: UniverseSummary[] = await Promise.all(
		memberRows.map(async (row) => {
			const entities = await database.query.entity.findMany({
				where: (entity, { eq }) => eq(entity.universeId, row.id),
				columns: { id: true }
			});
			return {
				id: row.id,
				name: row.name,
				slug: row.slug,
				kind: row.kind,
				baseUniverseName: row.baseUniverseId ? (nameById.get(row.baseUniverseId) ?? null) : null,
				entityCount: entities.length
			};
		})
	);

	const current = universes.find((universe) => universe.id === currentRow.id);
	if (!current) error(404, `no universe called "${params.universe}"`);

	const [recent, proposalsPending] = await Promise.all([
		database.query.entity.findMany({
			where: (entity, { eq }) => eq(entity.universeId, currentRow.id),
			orderBy: (entity, { desc }) => desc(entity.updatedAt),
			limit: SIDEBAR_RECENT_LIMIT,
			columns: { id: true, name: true, slug: true, type: true }
		}),
		pendingProposalCount(database, currentRow.id)
	]);

	return {
		universeSlug: current.slug,
		current,
		universes,
		recent,
		navCounts: { entries: current.entityCount, proposals: proposalsPending },
		setupItems: universeSetupItems({
			imageStyleId: currentRow.imageStyleId,
			loremasterDescription: currentRow.loremasterDescription
		}),
		// Threaded to the edit action below and to any future write surface under this
		// subtree, so "may this account save here" is answered once per request rather
		// than re-derived per page.
		membershipRole: access.role
	};
};
