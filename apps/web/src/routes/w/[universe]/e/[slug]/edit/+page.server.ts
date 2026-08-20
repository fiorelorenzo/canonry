import { error, fail, redirect } from '@sveltejs/kit';
import {
	type Db,
	historyFor,
	mediaAssetsForEntity,
	priceOf,
	resetEntityLanguageToDetected,
	saveEntityBody,
	setEntityLanguage,
	universeAccessBySlug
} from '@canonry/db';
import { ImageModelNotConfiguredError, resolveImageModel } from '@canonry/media';
import { isLocale, messages, toLocale } from '$lib/i18n';
import { db } from '$lib/server/db';
import { scheduleCanonSaveJob } from '$lib/server/jobs';
import { normalizeMentions } from '$lib/markdown';
import { publicMentionTargetsFrom } from '$lib/server/players';
import type { Actions, PageServerLoad } from './$types';

/**
 * Issue #86: the layout's `load` already gates page views for this whole subtree
 * (`w/[universe]/+layout.server.ts`), but SvelteKit runs a POST action before any
 * layout load, so this route needs its own membership check too - the same reasoning
 * `requireAdmin`'s doc comment gives for /admin. `locals.user` is guaranteed non-null
 * by that same layout for a page view, but a raw POST to this action's URL is not a
 * page view, so it is re-checked here rather than assumed.
 */
async function loadUniverseAndEntity(locals: App.Locals, universeSlug: string, entitySlug: string) {
	if (!locals.user) error(404, messages(locals.locale).entry.errors.universeNotFound(universeSlug));

	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, messages(locals.locale).entry.errors.universeNotFound(universeSlug));
	const world = access.universe;

	const current = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, world.id), eq(entity.slug, entitySlug))
	});
	if (!current)
		error(404, messages(locals.locale).entry.errors.entryNotFound(entitySlug, world.name));

	return { conn, world, current, role: access.role, userId: locals.user.id };
}

/** `visibility` rides along with the name and the aliases for the same reason the read
 * page carries it (#220): `publicMentionTargetsFrom` filters this one already-fetched
 * list down to what `/p/**` would resolve, so the editor's preview can render the
 * player's view of the body without a second query and without a second copy of the
 * `gm_only` rule. */
async function mentionTargetsFor(conn: Db, universeId: string) {
	return conn.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, universeId),
		columns: { name: true, slug: true, aliases: true, visibility: true }
	});
}

/** Null when nobody has configured an active `image_model_config` row for `scene` yet, so
 * the dialog can say so rather than offering a button that throws (the same shape the
 * entry page's own `modelSummary` uses for `portrait` and `variants`). */
async function sceneModel(conn: Db) {
	try {
		const model = await resolveImageModel(conn, 'scene');
		return { provider: model.provider, modelId: model.modelId };
	} catch (err) {
		if (err instanceof ImageModelNotConfiguredError) return null;
		throw err;
	}
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { conn, world, current, role } = await loadUniverseAndEntity(
		locals,
		params.universe,
		params.slug
	);
	const universeEntities = await mentionTargetsFor(conn, world.id);
	// The image-insert picker (#253) only ever offers images, never the same table's
	// audio rows - `mediaAssetsForEntity` doesn't filter by kind because its one other
	// caller (the Images tab) never attaches audio to an entity in the first place, but
	// this filters explicitly rather than leaning on that being true forever.
	const [imageAssets, scenePrice, sceneModelSummary] = await Promise.all([
		mediaAssetsForEntity(conn, current.id).then((assets) =>
			assets.filter((asset) => asset.kind === 'image')
		),
		// #258: the in-body dialog used to show no price on the grounds that the Images tab
		// already showed one, which stopped being true the moment the body asked for `scene`
		// instead of borrowing `portrait`. The Images tab prices portraits and variants and
		// says nothing about a scene, so this is the only surface that can.
		priceOf(conn, 'image.scene'),
		sceneModel(conn)
	]);

	return {
		universe: { slug: world.slug, name: world.name, aiEnabled: world.aiEnabled },
		entity: {
			id: current.id,
			type: current.type,
			name: current.name,
			slug: current.slug,
			aliases: current.aliases,
			body: current.body,
			// #347: the entry's own language (SPEC.md §17) is read here rather than on the read
			// page, because this is where the body that detection runs over gets written.
			language: toLocale(current.language),
			languageSource: current.languageSource
		},
		// The same answer `media.canWrite` gives on the read page, from the same role: a
		// viewer can open this page (the layout lets them in) and cannot write from it, so
		// the language control is disabled rather than absent, and its action 403s anyway.
		canWrite: role !== 'viewer',
		mentionTargets: universeEntities,
		publicMentionTargets: publicMentionTargetsFrom(universeEntities),
		media: {
			assets: imageAssets.map((asset) => ({
				id: asset.id,
				mimeType: asset.mimeType,
				generated: asset.generated,
				gmOnly: asset.gmOnly,
				credits: asset.credits,
				createdAt: asset.createdAt
			})),
			scene: { price: scenePrice.credits, model: sceneModelSummary }
		}
	};
};

export const actions: Actions = {
	/** Named rather than `default` since #347 gave this route a second action, and
	 * SvelteKit refuses a file that has both. The editor's own form posts to `?/save`. */
	save: async ({ request, params, locals }) => {
		const { conn, world, current, role, userId } = await loadUniverseAndEntity(
			locals,
			params.universe,
			params.slug
		);
		// A viewer can see this page (the layout already let them in) but may not write
		// to it - a 403, not a 404, since existence is not what is being hidden here.
		if (role === 'viewer') error(403, messages(locals.locale).entry.errors.viewerCannotEdit);

		const form = await request.formData();
		const rawBody = form.get('body');
		if (typeof rawBody !== 'string') {
			return fail(400, { message: messages(locals.locale).entry.errors.missingBody });
		}

		// Browsers normalise a form field's newlines to CRLF on submission (the HTML spec's
		// own "constructing the form data set" step), so `\r\n` here is form plumbing, not
		// something the GM typed - collapse it back to the plain `\n` every other body in
		// this database already uses. Never trust the client's own mention resolution
		// either: normalise against the entities that exist right now, loaded fresh in this
		// request (#105 acceptance).
		const universeEntities = await mentionTargetsFor(conn, world.id);
		const body = normalizeMentions(rawBody.replace(/\r\n/g, '\n'), universeEntities);

		const history = await historyFor(conn, current.id);
		const parentRevisionId = history[0]?.id;

		// One write path for the revision + the entity's own body (and now its language,
		// SPEC.md §17): `saveEntityBody` keeps them in the same transaction, so history is
		// never out of step with what the entry currently shows (guardrail 2), and a reader
		// of the committed row never sees `language` disagree with the body that produced
		// it. Issue #86: attributed to the real signed-in account, not the universe's
		// recorded owner - a member editing someone else's universe now shows up as
		// themselves in history, not as the owner they are not.
		const saved = await saveEntityBody(conn, {
			universeId: world.id,
			entityId: current.id,
			entityName: current.name,
			entityAliases: current.aliases,
			parentRevisionId,
			authorUserId: userId,
			body,
			current: { language: current.language, languageSource: current.languageSource }
		});

		// SPEC.md §5.1/§5.2: propagation and audit run "on save, debounced, in the
		// background" - scheduled here, after the transaction above has committed, so the
		// background job only ever reads a body Postgres has already durably written.
		// Fire and forget: the redirect below does not wait on it (`$lib/server/jobs`'s own
		// header comment is the design note for why there is nothing to await here).
		scheduleCanonSaveJob({
			universeId: world.id,
			entityId: current.id,
			entityName: current.name,
			userId,
			oldBody: current.body,
			newBody: body,
			// The language the GM is reading in right now, captured here because the worker that
			// picks this job up cannot negotiate a locale from a request that has ended.
			locale: locals.locale,
			triggerRevisionId: saved.revisionId
		});

		redirect(303, `/w/${params.universe}/e/${params.slug}`);
	},

	/** Issue #122, SPEC.md §17: the entry's own language control. `auto` reverts to
	 * detection and re-runs it immediately against the body as it stands now, rather than
	 * leaving a stale guess sitting under the new 'detected' provenance until the next
	 * save; `unsure` is the explicit "not sure / mixed" answer, stored as `language: null`
	 * under `languageSource: 'human'` so it is never re-guessed.
	 *
	 * Moved here from the read page with the control itself (#347). It reads the same
	 * `loadUniverseAndEntity` gate the save above does, so a raw POST from a viewer is a
	 * 403 on this route exactly as it was on the other one: SvelteKit runs an action before
	 * any layout load, and membership is re-checked per action rather than assumed.
	 */
	setLanguage: async ({ request, params, locals }) => {
		const { conn, current, role } = await loadUniverseAndEntity(
			locals,
			params.universe,
			params.slug
		);
		if (role === 'viewer')
			error(403, messages(locals.locale).entry.errors.viewerCannotChangeLanguage);

		const form = await request.formData();
		const choice = form.get('language');
		if (typeof choice !== 'string')
			return fail(400, {
				languageError: messages(locals.locale).entry.errors.missingLanguageChoice
			});

		if (choice === 'auto') {
			return await resetEntityLanguageToDetected(conn, { entityId: current.id });
		}
		if (choice === 'unsure') {
			return await setEntityLanguage(conn, { entityId: current.id, language: null });
		}
		if (!isLocale(choice))
			return fail(400, {
				languageError: messages(locals.locale).entry.errors.unknownLanguage(choice)
			});
		return await setEntityLanguage(conn, { entityId: current.id, language: choice });
	}
};
