/**
 * `/settings/export/[universe]`: the download itself. GET only, on purpose - this is a
 * file fetch, not a page, so it has no `+page.svelte` sibling for SvelteKit to have to
 * disambiguate against. Issue #86: gated the same way `u/[universe]` is - a 404 both
 * for an unknown slug and for one this account cannot see, so a probe learns nothing
 * either way.
 */
import { error } from '@sveltejs/kit';
import { universeAccessBySlug, universeForExport } from '@canonry/db';
import { db } from '$lib/server/db';
import { exportZipFilename, streamUniverseExportZip } from '$lib/server/export';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);

	const database = db();
	const access = await universeAccessBySlug(database, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const universe = await universeForExport(database, params.universe);
	if (!universe) error(404, `no universe called "${params.universe}"`);

	return new Response(streamUniverseExportZip(database, universe), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${exportZipFilename(universe.slug)}"`
		}
	});
};
