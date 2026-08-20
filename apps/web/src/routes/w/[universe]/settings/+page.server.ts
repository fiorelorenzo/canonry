/**
 * `/w/[universe]/settings`: per-universe settings. Five things live here this wave -
 * issue #107's "Stop writing" switch (decision C10 = B, per universe; wording from H1),
 * the propagation cap (decision C3 amendment, "Round nine": a nullable integer, null
 * meaning no limit, defaulting to 25 - see `packages/db/src/schema/universe.ts`'s
 * column comment for the arithmetic), issue #19's precedence panel (decision A2 = A's
 * "superseded, struck through" row, made real) for a derived universe, and issue #378's
 * two sections (decision R3, DECISIONS.md "Round thirteen"): the universe's shared
 * image style and its Loremaster voice, neither of which had an interface anywhere in
 * the product before this. Account-wide settings (appearance, export) stay at
 * `/settings/*`, linked from here rather than duplicated.
 *
 * Loads the full universe row itself rather than trusting the layout's `current`
 * (`UniverseSummary`, the sidebar switcher's shape): that type deliberately does not
 * carry `ai_enabled`, `propagation_cap`, `image_style_id` or `loremaster_description`,
 * and this page needs all four.
 *
 * Issue #379, decision R4: `setupItems` is `universeSetupItems()` run against this
 * same row, so the list `+page.svelte` renders at the top of the page reads the exact
 * checklist the shell row counts - see that function's own doc comment for what
 * joins the list and why `ai_enabled`/`propagation_cap` never will.
 */
import { error, fail } from '@sveltejs/kit';
import {
	createSupersede,
	eq,
	ImageStylePresetNotFoundError,
	listDataSourcesForUniverse,
	listImageStylePresets,
	listRelationTypesForUniverse,
	listSupersedesForUniverse,
	removeSupersede,
	selectUniverseImageStylePreset,
	SupersedeAlreadyExistsError,
	universeAccessBySlug,
	upsertUniverseImageStyle
} from '@canonry/db';
import { imageStyle, universe } from '@canonry/db/schema';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import { universeSetupItems } from '$lib/server/universe-setup';
import type { Actions, PageServerLoad } from './$types';

// Issue #378, decision R3: the same 500-character cap the settings textarea enforces
// client-side via `maxlength` - restated here because a form post never trusts what the
// client claims it validated. Kept as one constant rather than a magic number in the
// action below. Not exported: a `+page.server.ts` module only permits SvelteKit's own
// named exports (`load`, `actions`, ...) at runtime - vite's dev server 500s on
// anything else - and the svelte file could not import it either way, since a server
// module never reaches the client bundle; its `maxlength` attribute restates 500
// directly instead, with a comment pointing back here.
const LOREMASTER_DESCRIPTION_MAX_LENGTH = 500;

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);
	const world = access.universe;

	const [supersedes, baseDataSources, relationTypes, imageStylePresets, ownCustomStyle] =
		await Promise.all([
			listSupersedesForUniverse(conn, world.id),
			world.baseUniverseId ? listDataSourcesForUniverse(conn, world.baseUniverseId) : [],
			listRelationTypesForUniverse(conn, world.id),
			// Issue #407, decision S2: the shipped catalogue the picker's grid renders.
			listImageStylePresets(conn, locals.locale),
			// Issue #378/#407: this universe's own custom row, found by universe_id -
			// never by world.imageStyleId, which might currently point at a preset
			// instead. This is only for prefilling the custom card's form; pickStyle's
			// cascade (packages/media/src/style.ts) reads image_style_id at generation
			// time and does not care which kind of row it points at.
			conn
				.select({ name: imageStyle.name, promptModifier: imageStyle.promptModifier })
				.from(imageStyle)
				.where(eq(imageStyle.universeId, world.id))
				.limit(1)
				.then(([row]) => row)
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
		ownRelationTypeCount: relationTypes.filter((type) => type.universeId !== null).length,
		imageStylePresets,
		currentImageStyleId: world.imageStyleId,
		imageStyleName: ownCustomStyle?.name ?? '',
		imageStyleModifier: ownCustomStyle?.promptModifier ?? '',
		loremasterDescription: world.loremasterDescription,
		// Issue #379, decision R4: the same checklist the shell row counts, so the list
		// at the top of this page can never disagree with it about what is unset.
		setupItems: universeSetupItems({
			imageStyleId: world.imageStyleId,
			loremasterDescription: world.loremasterDescription
		})
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

	// Issue #407, decision S2: points the universe at a shipped preset without ever
	// touching the preset row itself - the "Custom style" card's own submit
	// (setImageStyle below) is the only action that ever writes to image_style.
	selectImageStylePreset: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const tStyle = messages(locals.locale).universe.settings.imageStyle;
		const form = await request.formData();
		const presetId = form.get('presetId');
		if (typeof presetId !== 'string' || presetId.length === 0) {
			return fail(400, { imageStyleError: tStyle.pickError });
		}

		try {
			await selectUniverseImageStylePreset(conn, access.universe.id, presetId);
		} catch (err) {
			if (err instanceof ImageStylePresetNotFoundError) {
				return fail(400, { imageStyleError: tStyle.pickError });
			}
			throw err;
		}
		return { selectedPresetId: presetId };
	},

	// Issue #378, decision R3: one `image_style` row per universe, updated in place -
	// `upsertUniverseImageStyle` finds this universe's own row by `universe_id` (never
	// by `image_style_id`, which might currently point at a preset instead - #407) and
	// updates it, or inserts the first one and points the column at it. `pickStyle`'s
	// cascade (packages/media/src/style.ts) does not change: this only ever writes the
	// universe half of it.
	setImageStyle: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const tStyle = messages(locals.locale).universe.settings.imageStyle;
		const form = await request.formData();
		const name = form.get('name');
		const promptModifier = form.get('promptModifier');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, { imageStyleError: tStyle.nameRequiredError });
		}
		if (typeof promptModifier !== 'string' || promptModifier.trim().length === 0) {
			return fail(400, { imageStyleError: tStyle.promptModifierRequiredError });
		}

		const style = await upsertUniverseImageStyle(conn, {
			universeId: access.universe.id,
			name: name.trim(),
			promptModifier: promptModifier.trim()
		});
		return { imageStyleName: style.name, imageStyleModifier: style.promptModifier };
	},

	// Issue #378, decision R3: a textarea over `universe.loremaster_description`, capped
	// at LOREMASTER_DESCRIPTION_MAX_LENGTH characters, the empty default preserved when a
	// GM clears it rather than turned back into a sentinel. `runAsk` and `completeEntry`
	// (packages/copilot) read this column directly - nothing here caches or denormalises
	// it.
	setLoremasterVoice: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const tVoice = messages(locals.locale).universe.settings.loremasterVoice;
		const form = await request.formData();
		const raw = form.get('description');
		const description = (typeof raw === 'string' ? raw : '').trim();
		if (description.length > LOREMASTER_DESCRIPTION_MAX_LENGTH) {
			return fail(400, { loremasterVoiceError: tVoice.tooLongError });
		}

		await conn
			.update(universe)
			.set({ loremasterDescription: description })
			.where(eq(universe.id, access.universe.id));
		return { loremasterDescription: description };
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
