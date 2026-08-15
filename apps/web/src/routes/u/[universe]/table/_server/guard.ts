/**
 * Every route under this subtree needs the same check `u/[universe]/+layout.server.ts`
 * already runs for a page view, but a raw `+server.ts` request handler does not inherit a
 * layout's `load` - only `+page.server.ts` does. That is the same reasoning
 * `$lib/server/admin.ts`'s `requireAdmin` doc comment gives for /admin, applied here to
 * every JSON endpoint under /table (context, search, actions, notes, stream, end).
 */
import { error } from '@sveltejs/kit';
import { universeAccessBySlug, type UniverseAccess } from '@canonry/db';
import { messages, type Locale } from '$lib/i18n';
import { db } from '$lib/server/db';

export interface TableAccess extends UniverseAccess {
	userId: string;
}

interface GuardEvent {
	params: { universe?: string };
	locals: { user: { id: string } | null; locale: Locale };
}

/** 404, never 401 - same reasoning as requireAdmin: a slug that does not exist and one
 * this account cannot see must be indistinguishable to the caller. */
export async function requireTableAccess(event: GuardEvent): Promise<TableAccess> {
	const universeSlug = event.params.universe;
	const notFound = messages(event.locals.locale).table.server.notFound;
	if (!event.locals.user || !universeSlug) error(404, notFound);

	const access = await universeAccessBySlug(db(), universeSlug, event.locals.user.id);
	if (!access) error(404, notFound);

	return { ...access, userId: event.locals.user.id };
}
