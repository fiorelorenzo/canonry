/**
 * `/w/[universe]/settings`: per-universe settings. Five things live here this wave -
 * issue #107's "Stop writing" switch (decision C10 = B, per universe; wording from H1),
 * the propagation cap (decision C3 amendment, "Round nine", null default since issue
 * #451's decision U3 - see `packages/db/src/schema/universe.ts`'s column comment for
 * why), issue #19's precedence panel (decision A2 = A's "superseded, struck through"
 * row, made real) for a derived universe, and issue #378's two sections (decision R3,
 * DECISIONS.md "Round thirteen"): the universe's shared image style and its Loremaster
 * voice, neither of which had an interface anywhere in the product before this. The
 * voice grew its own preset picker under issue #451, decision U2, on the image style
 * picker's own shape (S2) - see `+page.svelte`'s `#group-loremaster` section. Account-
 * wide settings (appearance, export) stay at `/settings/*`, linked from here rather than
 * duplicated.
 *
 * Loads the full universe row itself rather than trusting the layout's `current`
 * (`UniverseSummary`, the sidebar switcher's shape): that type deliberately does not
 * carry `ai_enabled`, `propagation_cap`, `image_style_id` or `narration_style_id`,
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
	listNarrationStylePresets,
	listRelationTypesForUniverse,
	listSupersedesForUniverse,
	NarrationStylePresetNotFoundError,
	removeSupersede,
	selectUniverseImageStylePreset,
	selectUniverseNarrationStylePreset,
	SupersedeAlreadyExistsError,
	universeAccessBySlug,
	upsertUniverseImageStyle,
	upsertUniverseNarrationStyle
} from '@canonry/db';
import { imageStyle, narrationStyle, universe } from '@canonry/db/schema';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import { universeSetupItems } from '$lib/server/universe-setup';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);
	const world = access.universe;

	const [
		supersedes,
		baseDataSources,
		relationTypes,
		imageStylePresets,
		ownCustomStyle,
		narrationStylePresets,
		ownCustomNarrationStyle
	] = await Promise.all([
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
			.then(([row]) => row),
		// Issue #451, decision U2: the shipped narration catalogue, same shape as
		// `imageStylePresets` above.
		listNarrationStylePresets(conn, locals.locale),
		// This universe's own custom voice, found by universe_id for the same reason
		// `ownCustomStyle` is above - prefills the custom card only, never read by
		// `loremasterVoiceClauseForUniverse` at prompt-build time.
		conn
			.select({ name: narrationStyle.name, promptClause: narrationStyle.promptClause })
			.from(narrationStyle)
			.where(eq(narrationStyle.universeId, world.id))
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
		narrationStylePresets,
		currentNarrationStyleId: world.narrationStyleId,
		narrationStyleName: ownCustomNarrationStyle?.name ?? '',
		narrationStylePromptClause: ownCustomNarrationStyle?.promptClause ?? '',
		// Issue #379, decision R4: the same checklist the shell row counts, so the list
		// at the top of this page can never disagree with it about what is unset.
		setupItems: universeSetupItems({
			imageStyleId: world.imageStyleId,
			narrationStyleId: world.narrationStyleId
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

	// Issue #451, decision U2: points the universe at a shipped narration preset without
	// ever touching the preset row itself - the "Custom voice" card's own submit
	// (setNarrationStyle below) is the only action that ever writes to narration_style.
	// Choosing a voice spends nothing.
	selectNarrationStylePreset: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const tNarration = messages(locals.locale).universe.settings.narration;
		const form = await request.formData();
		const presetId = form.get('presetId');
		if (typeof presetId !== 'string' || presetId.length === 0) {
			return fail(400, { narrationStyleError: tNarration.pickError });
		}

		try {
			await selectUniverseNarrationStylePreset(conn, access.universe.id, presetId);
		} catch (err) {
			if (err instanceof NarrationStylePresetNotFoundError) {
				return fail(400, { narrationStyleError: tNarration.pickError });
			}
			throw err;
		}
		return { selectedNarrationPresetId: presetId };
	},

	// Issue #451, decision U2: one `narration_style` row per universe, updated in place -
	// `upsertUniverseNarrationStyle` finds this universe's own row by `universe_id`
	// (never by `narration_style_id`, which might currently point at a preset instead)
	// and updates it, or inserts the first one and points the column at it. Replaces the
	// old `setLoremasterVoice` action - `universe.loremaster_description` is gone, moved
	// into this same table by migration 0050.
	setNarrationStyle: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') {
			error(403, messages(locals.locale).universe.settings.viewerForbiddenError);
		}

		const tNarration = messages(locals.locale).universe.settings.narration;
		const form = await request.formData();
		const name = form.get('name');
		const promptClause = form.get('promptClause');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, { narrationStyleError: tNarration.nameRequiredError });
		}
		if (typeof promptClause !== 'string' || promptClause.trim().length === 0) {
			return fail(400, { narrationStyleError: tNarration.promptClauseRequiredError });
		}

		const style = await upsertUniverseNarrationStyle(conn, {
			universeId: access.universe.id,
			name: name.trim(),
			promptClause: promptClause.trim()
		});
		return { narrationStyleName: style.name, narrationStylePromptClause: style.promptClause };
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
