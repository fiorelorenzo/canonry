/**
 * `/w/[universe]/settings`: per-universe settings. Three things live here this wave -
 * issue #107's "Stop writing" switch (decision C10 = B, per universe; wording from H1),
 * the propagation cap (decision C3 amendment, "Round nine": a nullable integer, null
 * meaning no limit, defaulting to 25 - see `packages/db/src/schema/universe.ts`'s
 * column comment for the arithmetic), and issue #19's precedence panel (decision A2 =
 * A's "superseded, struck through" row, made real) for a derived universe.
 * Account-wide settings (appearance, export) stay at `/settings/*`, linked from here
 * rather than duplicated.
 *
 * Loads the full universe row itself rather than trusting the layout's `current`
 * (`UniverseSummary`, the sidebar switcher's shape): that type deliberately does not
 * carry `ai_enabled`, `propagation_cap` or the raw `base_universe_id`, and this page
 * needs all three.
 */
import { error, fail } from '@sveltejs/kit';
import {
	createSupersede,
	eq,
	listDataSourcesForUniverse,
	listRelationTypesForUniverse,
	listSupersedesForUniverse,
	removeSupersede,
	SupersedeAlreadyExistsError,
	universeAccessBySlug
} from '@canonry/db';
import { universe } from '@canonry/db/schema';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);
	const world = access.universe;

	const [supersedes, baseDataSources, relationTypes] = await Promise.all([
		listSupersedesForUniverse(conn, world.id),
		world.baseUniverseId ? listDataSourcesForUniverse(conn, world.baseUniverseId) : [],
		listRelationTypesForUniverse(conn, world.id)
	]);

	const universeEntities = world.baseUniverseId
		? await conn.query.entity.findMany({
				where: (entity, { eq }) => eq(entity.universeId, world.id),
				columns: { id: true, name: true, slug: true }
			})
		: [];

	return {
		aiEnabled: world.aiEnabled,
		propagationCap: world.propagationCap,
		isDerived: world.baseUniverseId !== null,
		supersedes,
		baseDataSources: baseDataSources.map((source) => ({ id: source.id, name: source.name })),
		universeEntities,
		ownRelationTypeCount: relationTypes.filter((type) => type.universeId !== null).length
	};
};

export const actions: Actions = {
	setAiEnabled: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const form = await request.formData();
		const enabled = form.get('enabled') === 'true';
		await conn
			.update(universe)
			.set({ aiEnabled: enabled })
			.where(eq(universe.id, access.universe.id));
		return { aiEnabled: enabled };
	},

	setPropagationCap: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const tCap = messages(locals.locale).universe.settings.propagationCap;
		const form = await request.formData();
		// A disabled `<input>` is never submitted, so checking "no limit" client-side is
		// enough to make `cap` absent here too - there is no state where both arrive and
		// one has to be picked over the other.
		const noLimit = form.get('noLimit') === 'true';
		let propagationCap: number | null = null;
		if (!noLimit) {
			const raw = form.get('cap');
			const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
			if (!Number.isInteger(parsed) || parsed < 1) {
				return fail(400, { message: tCap.invalidCapError });
			}
			propagationCap = parsed;
		}

		await conn.update(universe).set({ propagationCap }).where(eq(universe.id, access.universe.id));
		return { propagationCap };
	},

	addSupersede: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}
		const tp = messages(locals.locale).universe.settings.precedence;
		if (!access.universe.baseUniverseId) {
			return fail(400, { message: tp.onlyDerivedError });
		}

		const form = await request.formData();
		const entityId = form.get('entityId');
		const dataSourceId = form.get('dataSourceId');
		const sourceUrl = form.get('sourceUrl');
		const note = form.get('note');
		if (typeof entityId !== 'string' || entityId.length === 0) {
			return fail(400, { message: tp.pickEntryError });
		}
		if (typeof dataSourceId !== 'string' || dataSourceId.length === 0) {
			return fail(400, { message: tp.pickSourceError });
		}
		if (typeof sourceUrl !== 'string' || sourceUrl.trim().length === 0) {
			return fail(400, { message: tp.sourceUrlRequiredError });
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
				return fail(400, { message: tp.alreadySupersededError });
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
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const form = await request.formData();
		const id = form.get('id');
		if (typeof id !== 'string' || id.length === 0) {
			return fail(400, {
				message: messages(locals.locale).universe.settings.precedence.missingIdError
			});
		}
		await removeSupersede(conn, access.universe.id, id);
		return { removed: true };
	}
};
