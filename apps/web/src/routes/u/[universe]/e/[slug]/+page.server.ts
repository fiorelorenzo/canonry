import { error } from '@sveltejs/kit';
import {
	historyFor,
	mediaAssetsForEntity,
	priceOf,
	relationsFor,
	universeAccessBySlug,
	type Db
} from '@canonry/db';
import { ImageModelNotConfiguredError, resolveImageModel, resolveStyle } from '@canonry/media';
import { db } from '$lib/server/db';
import { stripMentionSyntax } from '$lib/markdown';
import type { PageServerLoad } from './$types';

/** Null when the feature has no active image_model_config row yet - the dialog then says
 * so instead of crashing the whole entry page over a missing admin setup step (#64). */
async function modelSummary(conn: Db, feature: 'portrait' | 'variants') {
	try {
		const model = await resolveImageModel(conn, feature);
		return { provider: model.provider, modelId: model.modelId };
	} catch (err) {
		if (err instanceof ImageModelNotConfiguredError) return null;
		throw err;
	}
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);

	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);
	const world = access.universe;

	const current = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, world.id), eq(entity.slug, params.slug))
	});
	if (!current) error(404, `No entry named "${params.slug}" in ${world.name}`);

	// Mention resolution needs every entity's name and aliases, not just this one - a body
	// full of `[[Other Entity]]` has to resolve against the whole universe (#105/#15).
	const universeEntities = await conn.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, world.id),
		columns: { name: true, slug: true, aliases: true }
	});

	const entityFacts = await conn.query.fact.findMany({
		where: (fact, { eq }) => eq(fact.entityId, current.id),
		orderBy: (fact, { asc }) => asc(fact.spanStart)
	});

	// No `relations()` are declared between `fact` and `revision`, so the relational query
	// API can't join them; fetch the handful of source revisions the facts point at and
	// slice the excerpt in JS instead of asking Postgres for a `substring()`.
	const revisionIds = [...new Set(entityFacts.map((f) => f.sourceRevisionId))];
	const sourceRevisions = revisionIds.length
		? await conn.query.revision.findMany({
				where: (revision, { inArray }) => inArray(revision.id, revisionIds),
				columns: { id: true, body: true }
			})
		: [];
	const bodyByRevisionId = new Map(sourceRevisions.map((r) => [r.id, r.body]));

	const facts = entityFacts.map((f) => ({
		id: f.id,
		statement: f.statement,
		spanStart: f.spanStart,
		spanEnd: f.spanEnd,
		authorKind: f.authorKind,
		// A quoted excerpt is read as prose, not rendered as markdown, so `[[Name]]` reduces
		// to `Name` here; the stored span itself (used for the in-body highlight) is untouched.
		sourceExcerpt: stripMentionSyntax(
			(bodyByRevisionId.get(f.sourceRevisionId) ?? '').slice(f.spanStart, f.spanEnd)
		)
	}));

	const [
		relations,
		history,
		mediaAssets,
		style,
		portraitPrice,
		variantsPrice,
		portraitModel,
		variantsModel
	] = await Promise.all([
		relationsFor(conn, current.id),
		historyFor(conn, current.id),
		mediaAssetsForEntity(conn, current.id),
		resolveStyle(conn, current.id),
		priceOf(conn, 'image.portrait'),
		priceOf(conn, 'image.variants'),
		modelSummary(conn, 'portrait'),
		modelSummary(conn, 'variants')
	]);

	return {
		universe: {
			slug: world.slug,
			name: world.name,
			id: world.id,
			aiEnabled: world.aiEnabled
		},
		entity: {
			id: current.id,
			type: current.type,
			name: current.name,
			slug: current.slug,
			aliases: current.aliases,
			body: current.body,
			imagePromptModifier: current.imagePromptModifier,
			updatedAt: current.updatedAt
		},
		mentionTargets: universeEntities,
		relations,
		history,
		facts,
		media: {
			assets: mediaAssets.map((asset) => ({
				id: asset.id,
				mimeType: asset.mimeType,
				generated: asset.generated,
				publishedToPlayers: asset.publishedToPlayers,
				credits: asset.credits,
				createdAt: asset.createdAt
			})),
			style,
			canWrite: access.role !== 'viewer',
			generate: {
				portrait: { price: portraitPrice.credits, model: portraitModel },
				variants: { price: variantsPrice.credits, model: variantsModel }
			}
		}
	};
};
