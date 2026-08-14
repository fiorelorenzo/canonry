/**
 * `/u/[universe]/settings`: per-universe settings. Two things live here this wave -
 * issue #107's "Stop writing" switch (decision C10 = B, per universe; wording from H1)
 * and issue #19's precedence panel (decision A2 = A's "superseded, struck through" row,
 * made real) for a derived universe. Account-wide settings (appearance, export) stay at
 * `/settings/*`, linked from here rather than duplicated.
 *
 * Loads the full universe row itself rather than trusting the layout's `current`
 * (`UniverseSummary`, the sidebar switcher's shape): that type deliberately does not
 * carry `ai_enabled` or the raw `base_universe_id`, and this page needs both.
 */
import { error, fail } from '@sveltejs/kit';
import {
	createSupersede,
	eq,
	listDataSourcesForUniverse,
	listSupersedesForUniverse,
	removeSupersede,
	SupersedeAlreadyExistsError,
	universeAccessBySlug
} from '@canonry/db';
import { universe } from '@canonry/db/schema';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);
	const world = access.universe;

	const [supersedes, baseDataSources] = await Promise.all([
		listSupersedesForUniverse(conn, world.id),
		world.baseUniverseId ? listDataSourcesForUniverse(conn, world.baseUniverseId) : []
	]);

	const universeEntities = world.baseUniverseId
		? await conn.query.entity.findMany({
				where: (entity, { eq }) => eq(entity.universeId, world.id),
				columns: { id: true, name: true, slug: true }
			})
		: [];

	return {
		aiEnabled: world.aiEnabled,
		isDerived: world.baseUniverseId !== null,
		supersedes,
		baseDataSources: baseDataSources.map((source) => ({ id: source.id, name: source.name })),
		universeEntities
	};
};

export const actions: Actions = {
	setAiEnabled: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') error(403, 'Viewers cannot change this setting');

		const form = await request.formData();
		const enabled = form.get('enabled') === 'true';
		await conn
			.update(universe)
			.set({ aiEnabled: enabled })
			.where(eq(universe.id, access.universe.id));
		return { aiEnabled: enabled };
	},

	addSupersede: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') error(403, 'Viewers cannot change this setting');
		if (!access.universe.baseUniverseId) {
			return fail(400, { message: 'Only a derived universe can supersede a source page' });
		}

		const form = await request.formData();
		const entityId = form.get('entityId');
		const dataSourceId = form.get('dataSourceId');
		const sourceUrl = form.get('sourceUrl');
		const note = form.get('note');
		if (typeof entityId !== 'string' || entityId.length === 0) {
			return fail(400, { message: 'Pick which entry supersedes the page' });
		}
		if (typeof dataSourceId !== 'string' || dataSourceId.length === 0) {
			return fail(400, { message: 'Pick which source the page belongs to' });
		}
		if (typeof sourceUrl !== 'string' || sourceUrl.trim().length === 0) {
			return fail(400, { message: 'The source page needs a url' });
		}

		try {
			await createSupersede(conn, {
				universeId: access.universe.id,
				entityId,
				dataSourceId,
				sourceUrl: sourceUrl.trim(),
				note: typeof note === 'string' ? note.trim() : undefined
			});
		} catch (err) {
			if (err instanceof SupersedeAlreadyExistsError) {
				return fail(400, { message: 'This page is already superseded.' });
			}
			throw err;
		}
		return { added: true };
	},

	removeSupersede: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') error(403, 'Viewers cannot change this setting');

		const form = await request.formData();
		const id = form.get('id');
		if (typeof id !== 'string' || id.length === 0) {
			return fail(400, { message: 'Missing supersede id' });
		}
		await removeSupersede(conn, access.universe.id, id);
		return { removed: true };
	}
};
