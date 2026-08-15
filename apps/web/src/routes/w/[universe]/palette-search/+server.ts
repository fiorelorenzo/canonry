/**
 * Issue #149 (A3 = C): the palette's entity lookup, "the same lookup the entry browser
 * uses" (`w/[universe]/+page.server.ts`'s own `?q=` handling) reached over a plain GET
 * so the palette can search as the GM types without a full page navigation. Name and
 * alias matching only - `searchEntitiesByNameOrAlias`'s instant lane, never the fast
 * (vector) lane `table/search/+server.ts` falls back to. Semantic search is explicitly
 * out of scope for this issue; reaching for that endpoint instead would pull it back in.
 *
 * A raw GET skips the layout's own `load`, so membership is re-checked here exactly like
 * every other endpoint under this universe (`ask/+server.ts`'s own comment on the
 * pattern) - the palette must never let a GM search a universe they cannot see.
 */
import { error, json } from '@sveltejs/kit';
import { searchEntitiesByNameOrAlias, universeAccessBySlug } from '@canonry/db';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const q = url.searchParams.get('q')?.trim() ?? '';
	const hits = q ? await searchEntitiesByNameOrAlias(conn, access.universe.id, q) : [];

	return json({ hits });
};
