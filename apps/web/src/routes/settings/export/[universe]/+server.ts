/**
 * `/settings/export/[universe]`: the download itself. GET only, on purpose - this is a
 * file fetch, not a page, so it has no `+page.svelte` sibling for SvelteKit to have to
 * disambiguate against. `universeForExport` 404s an unknown slug the same way the rest
 * of the app treats an unknown universe.
 */
import { error } from '@sveltejs/kit';
import { universeForExport } from '@canonry/db';
import { db } from '$lib/server/db';
import { exportZipFilename, streamUniverseExportZip } from '$lib/server/export';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const universe = await universeForExport(db(), params.universe);
	if (!universe) error(404, `no universe called "${params.universe}"`);

	return new Response(streamUniverseExportZip(db(), universe), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${exportZipFilename(universe.slug)}"`
		}
	});
};
