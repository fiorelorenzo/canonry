/**
 * Issue #69's own tiny per-subtree guard, mirroring the pattern
 * `u/[universe]/e/[slug]/media/_context.ts` and `u/[universe]/table/_server/guard.ts`
 * both already establish independently: every route under this subtree re-checks
 * universe membership itself rather than depending on a layout `load` a raw
 * `+server.ts` request never runs. `_`-prefixed so SvelteKit never treats it as a route.
 */
import { error } from '@sveltejs/kit';
import { universeAccessBySlug, type UniverseAccess } from '@canonry/db';
import { db } from '$lib/server/db';

interface GuardEvent {
	params: { universe?: string };
	locals: { user: { id: string } | null };
}

/** 404, never 401 - same reasoning as `requireTableAccess`: a slug that does not exist
 * and one this account cannot see must be indistinguishable to the caller. Reading a
 * pack's layers is never gated on role (H1, docs/ux/DECISIONS.md: "reading is free") -
 * every member, viewer included, may list and play what already exists. */
export async function requireAmbientAccess(
	event: GuardEvent
): Promise<UniverseAccess & { userId: string }> {
	const universeSlug = event.params.universe;
	if (!event.locals.user || !universeSlug) error(404, 'Not Found');

	const access = await universeAccessBySlug(db(), universeSlug, event.locals.user.id);
	if (!access) error(404, 'Not Found');

	return { ...access, userId: event.locals.user.id };
}
