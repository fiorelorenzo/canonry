// SPEC.md §9, issues #64-#67 and #71. Raw data access for image models, style and media
// assets - no caching, no provider calls, no business logic. @canonry/media (the package
// that actually generates and caches images) is the one caller that turns these rows into
// a resolved model, a built prompt or a stored file; this module only reads and writes
// Postgres.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { ImageFeature } from '../schema/enums.js';
import { entity } from '../schema/entity.js';
import { imageModelConfig, imageStyle, imageStyleLabel, mediaAsset } from '../schema/media.js';
import { mergeOwnedParams } from './params.js';
import { universe } from '../schema/universe.js';

export type ImageModelRow = typeof imageModelConfig.$inferSelect;
export type MediaAssetRow = typeof mediaAsset.$inferSelect;

/** The active row for one feature, or undefined if nobody has configured it yet. Never
 * caches - @canonry/media's resolveImageModel wraps this with the short TTL cache that
 * makes an admin switch cheap to read on every request (mirrors @canonry/ai's
 * resolveModel/model_config split). */
export async function activeImageModelRow(
	db: Db,
	feature: ImageFeature
): Promise<ImageModelRow | undefined> {
	const rows = await db
		.select()
		.from(imageModelConfig)
		.where(and(eq(imageModelConfig.feature, feature), eq(imageModelConfig.active, true)))
		.limit(1);
	return rows[0];
}

/** Every image_model_config row, one per feature normally, for the admin panel. */
export async function listImageModels(db: Db): Promise<ImageModelRow[]> {
	return db.select().from(imageModelConfig).orderBy(asc(imageModelConfig.feature));
}

export interface UpsertImageModelInput {
	feature: ImageFeature;
	provider: string;
	modelId: string;
	/** Every `params` key the caller's form renders and therefore may set or clear
	 * (`mergeOwnedParams`, issue #235). Any other key already on the row -
	 * `imagesPerRequest`, seeded by migration 0011 and rendered by no form - survives
	 * this call untouched, whatever it is. */
	paramKeys: readonly string[];
	params: Record<string, unknown>;
}

/** Admin edit (#64): switches the active model for a feature without a deploy. Updates
 * the existing active row in place when there is one - same shape as @canonry/ai's
 * model_config test double for "admin switches the active model in place (same row,
 * unique index untouched)" - and inserts a fresh active row the first time a feature is
 * configured, since the catalogue for image models is not pre-grown one row per feature
 * the way operation_price is. `params` is merged into whatever the row already held via
 * `input.paramKeys`, never a wholesale replacement (issue #235) - a save through the
 * form the caller owns keys for cannot silently delete a key nothing on that form ever
 * renders. */
export async function upsertImageModel(
	db: Db,
	input: UpsertImageModelInput
): Promise<ImageModelRow> {
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(imageModelConfig)
			.where(and(eq(imageModelConfig.feature, input.feature), eq(imageModelConfig.active, true)))
			.for('update')
			.limit(1);

		if (existing[0]) {
			const [updated] = await tx
				.update(imageModelConfig)
				.set({
					provider: input.provider,
					modelId: input.modelId,
					params: mergeOwnedParams(existing[0].params, input.paramKeys, input.params),
					updatedAt: new Date()
				})
				.where(eq(imageModelConfig.id, existing[0].id))
				.returning();
			if (!updated) {
				throw new Error(`upsertImageModel: update returned no row for "${input.feature}"`);
			}
			return updated;
		}

		const [inserted] = await tx
			.insert(imageModelConfig)
			.values({
				feature: input.feature,
				provider: input.provider,
				modelId: input.modelId,
				active: true,
				params: mergeOwnedParams({}, input.paramKeys, input.params)
			})
			.returning();
		if (!inserted) {
			throw new Error(`upsertImageModel: insert returned no row for "${input.feature}"`);
		}
		return inserted;
	});
}

/** Everything a prompt build needs to resolve style (#65): the entry's own override plus
 * the universe's shared style modifier, in one round trip rather than two sequential
 * lookups. Undefined means the entity does not exist. */
export interface EntryStyleContext {
	entityId: string;
	universeId: string;
	entityOverride: string | null;
	universeStyleModifier: string | null;
}

export async function entryStyleContext(
	db: Db,
	entityId: string
): Promise<EntryStyleContext | undefined> {
	const rows = await db
		.select({
			entityId: entity.id,
			universeId: entity.universeId,
			entityOverride: entity.imagePromptModifier,
			universeStyleModifier: imageStyle.promptModifier
		})
		.from(entity)
		.innerJoin(universe, eq(universe.id, entity.universeId))
		.leftJoin(imageStyle, eq(imageStyle.id, universe.imageStyleId))
		.where(eq(entity.id, entityId))
		.limit(1);
	return rows[0];
}

export type ImageStyleRow = typeof imageStyle.$inferSelect;

export interface ImageStylePreset {
	id: string;
	slug: string;
	name: string;
	description: string;
	promptModifier: string;
	examplePath: string;
	sortOrder: number;
}

/** Issue #407, decision S2: the shipped catalogue the settings picker renders - the
 * six presets (`universe_id IS NULL`), ordered by `sort_order`. `locale`'s translation
 * (`image_style_label`) wins when one exists, the row's own English text otherwise -
 * same coalesce idiom queries/activity.ts uses for `relation_type_label`. */
export async function listImageStylePresets(db: Db, locale: string): Promise<ImageStylePreset[]> {
	const rows = await db
		.select({
			id: imageStyle.id,
			slug: imageStyle.slug,
			name: sql<string>`coalesce(${imageStyleLabel.name}, ${imageStyle.name})`,
			description: sql<string>`coalesce(${imageStyleLabel.description}, ${imageStyle.description})`,
			promptModifier: imageStyle.promptModifier,
			examplePath: imageStyle.examplePath,
			sortOrder: imageStyle.sortOrder
		})
		.from(imageStyle)
		.leftJoin(
			imageStyleLabel,
			and(eq(imageStyleLabel.imageStyleId, imageStyle.id), eq(imageStyleLabel.locale, locale))
		)
		.where(isNull(imageStyle.universeId))
		.orderBy(asc(imageStyle.sortOrder));
	return rows.map((row) => ({
		id: row.id,
		slug: row.slug ?? '',
		name: row.name,
		description: row.description ?? '',
		promptModifier: row.promptModifier,
		examplePath: row.examplePath ?? '',
		sortOrder: row.sortOrder
	}));
}

/** #407: `presetId` named a row that either does not exist or is not actually a shipped
 * preset (`universe_id` not null) - same "one message either way" posture
 * MediaAssetNotOwnedError documents (packages/media/src/generate.ts): which of the two
 * it is is not this caller's business, only that the target is refused. */
export class ImageStylePresetNotFoundError extends Error {
	constructor(presetId: string) {
		super(`no shipped image style preset with id "${presetId}"`);
		this.name = 'ImageStylePresetNotFoundError';
	}
}

/** #407: points `universe.image_style_id` at a shipped preset - never copies its prompt
 * modifier into a per-universe row, so improving a preset improves every world that
 * already chose it (the invariant pickStyle's cascade, packages/media/src/style.ts,
 * depends on). Refuses a target whose `universe_id` is not null, so a GM can never point
 * their universe at another universe's private custom row by guessing its id - a preset
 * is the only kind of row this may ever point at. */
export async function selectUniverseImageStylePreset(
	db: Db,
	universeId: string,
	presetId: string
): Promise<void> {
	await db.transaction(async (tx) => {
		const [preset] = await tx
			.select({ id: imageStyle.id })
			.from(imageStyle)
			.where(and(eq(imageStyle.id, presetId), isNull(imageStyle.universeId)))
			.limit(1);
		if (!preset) throw new ImageStylePresetNotFoundError(presetId);

		const [world] = await tx
			.select({ id: universe.id })
			.from(universe)
			.where(eq(universe.id, universeId))
			.for('update');
		if (!world) {
			throw new Error(`selectUniverseImageStylePreset: no universe row for id "${universeId}"`);
		}

		await tx.update(universe).set({ imageStyleId: presetId }).where(eq(universe.id, universeId));
	});
}

export interface UpsertUniverseImageStyleInput {
	universeId: string;
	name: string;
	promptModifier: string;
}

/** Universe settings' "image style" section (issue #378, decision R3): one `image_style`
 * row per universe, updated in place rather than accumulated - `pickStyle`'s cascade
 * (packages/media/src/style.ts, entry override then universe then none) only ever
 * follows `universe.image_style_id`, so a second, orphaned row would just be dead data
 * nothing reads. Found by `universe_id` (issue #407), never by `universe.image_style_id` -
 * a universe currently pointed at a shipped preset still owns at most one custom row of
 * its own, and this is the only place that may ever write to it. Reading
 * `image_style_id` instead would have updated whichever row the universe happened to be
 * pointed at, preset included - exactly the "a universe can edit a preset" bug S2's own
 * invariant forbids. Saving always re-points the universe at the found-or-created row,
 * which is what "Save" on the custom card means: switch back to my own style. */
export async function upsertUniverseImageStyle(
	db: Db,
	input: UpsertUniverseImageStyleInput
): Promise<ImageStyleRow> {
	return db.transaction(async (tx) => {
		const [world] = await tx
			.select({ id: universe.id })
			.from(universe)
			.where(eq(universe.id, input.universeId))
			.for('update');
		if (!world) {
			throw new Error(`upsertUniverseImageStyle: no universe row for id "${input.universeId}"`);
		}

		const [existing] = await tx
			.select({ id: imageStyle.id })
			.from(imageStyle)
			.where(eq(imageStyle.universeId, input.universeId))
			.limit(1);

		if (existing) {
			const [updated] = await tx
				.update(imageStyle)
				.set({ name: input.name, promptModifier: input.promptModifier })
				.where(eq(imageStyle.id, existing.id))
				.returning();
			if (!updated) {
				throw new Error(`upsertUniverseImageStyle: update returned no row for "${existing.id}"`);
			}
			await tx
				.update(universe)
				.set({ imageStyleId: updated.id })
				.where(eq(universe.id, input.universeId));
			return updated;
		}

		const [inserted] = await tx
			.insert(imageStyle)
			.values({
				universeId: input.universeId,
				name: input.name,
				promptModifier: input.promptModifier
			})
			.returning();
		if (!inserted) {
			throw new Error(
				`upsertUniverseImageStyle: insert returned no row for universe "${input.universeId}"`
			);
		}
		await tx
			.update(universe)
			.set({ imageStyleId: inserted.id })
			.where(eq(universe.id, input.universeId));
		return inserted;
	});
}

/** Attached images for an entry's gallery (#66), oldest first. Unattached rows (a
 * generated variant nobody picked yet) never show here - that is exactly what "attached"
 * means. */
export async function mediaAssetsForEntity(db: Db, entityId: string): Promise<MediaAssetRow[]> {
	return db
		.select()
		.from(mediaAsset)
		.where(eq(mediaAsset.entityId, entityId))
		.orderBy(asc(mediaAsset.createdAt));
}

export interface CreateMediaAssetInput {
	universeId: string;
	entityId?: string | null;
	kind: MediaAssetRow['kind'];
	path: string;
	mimeType: string;
	bytes: number;
	prompt?: string | null;
	provider?: string | null;
	modelId?: string | null;
	generated?: boolean;
	similarityKey?: string | null;
	credits?: number;
}

/** Inserts one stored file's row. `gmOnly` is never accepted as an input here on purpose
 * (#382, guardrail 6) - the column keeps its schema default of false, and this is the
 * only place a media_asset row is created, so there is nowhere for a caller to smuggle
 * it in true from day one. */
export async function createMediaAsset(
	db: Db,
	input: CreateMediaAssetInput
): Promise<MediaAssetRow> {
	const [inserted] = await db
		.insert(mediaAsset)
		.values({
			universeId: input.universeId,
			entityId: input.entityId ?? null,
			kind: input.kind,
			path: input.path,
			mimeType: input.mimeType,
			bytes: input.bytes,
			prompt: input.prompt ?? null,
			provider: input.provider ?? null,
			modelId: input.modelId ?? null,
			generated: input.generated ?? false,
			similarityKey: input.similarityKey ?? null,
			credits: input.credits ?? 0
		})
		.returning();
	if (!inserted) throw new Error('createMediaAsset: insert returned no row');
	return inserted;
}

/** "Insert" in the F1 = C dialog: attaches one already-generated, unattached asset to the
 * entry the GM picked it for. Only ever touches `entity_id` - never `gm_only` (#382).
 * Requires the asset to currently be unattached, so accepting the same variant twice or
 * re-attaching an already-attached image is a no-op that throws rather than silently
 * moving a picture between entries. This is the accept guardrail 6 asks for: an image
 * with no entry can never reach players, so attaching it is the human review, not a
 * second publish click. */
export async function attachMediaAsset(
	db: Db,
	id: string,
	entityId: string
): Promise<MediaAssetRow> {
	const [updated] = await db
		.update(mediaAsset)
		.set({ entityId })
		.where(and(eq(mediaAsset.id, id), isNull(mediaAsset.entityId)))
		.returning();
	if (!updated) throw new Error(`attachMediaAsset: no unattached media_asset row "${id}"`);
	return updated;
}

export async function mediaAssetById(db: Db, id: string): Promise<MediaAssetRow | undefined> {
	const rows = await db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).limit(1);
	return rows[0];
}

/** Batch lookup for a similarity cache hit (#67): one Qdrant point's payload names the
 * media_asset ids it produced, this resolves all of them in one query. */
export async function mediaAssetsByIds(db: Db, ids: readonly string[]): Promise<MediaAssetRow[]> {
	if (ids.length === 0) return [];
	return db
		.select()
		.from(mediaAsset)
		.where(inArray(mediaAsset.id, [...ids]));
}

/** Guardrail 6 and issue #382: the one function anywhere that writes `gm_only`. It
 * exists precisely so that write stays in exactly one place - a GM's own explicit click
 * in the Images tab marking the one exception to "attaching is the accept", never a side
 * effect of `attachMediaAsset`, `acceptProposal`, or revealing an entity, none of which
 * touch this column. Flips both directions on purpose: a GM who needs to hold a picture
 * back mid-campaign needs to release it again too, and clearing `gm_only` is that same
 * deliberate act in reverse, not a special case. */
export async function setMediaAssetGmOnly(
	db: Db,
	id: string,
	gmOnly: boolean
): Promise<MediaAssetRow> {
	const [updated] = await db
		.update(mediaAsset)
		.set({ gmOnly })
		.where(eq(mediaAsset.id, id))
		.returning();
	if (!updated) throw new Error(`setMediaAssetGmOnly: no media_asset row "${id}"`);
	return updated;
}

/**
 * Issue #385, decision R10: the row half of a real delete - `mediaStorage().delete`
 * handles the file. The caller (the DELETE route) is responsible for every guard
 * before this runs: ownership, whether the asset is the entry's cover, whether the
 * entry's body still points at it. This module only reads and writes Postgres, same
 * as every other function here - it does not re-check what the route already checked.
 */
export async function deleteMediaAsset(db: Db, id: string): Promise<MediaAssetRow> {
	const [deleted] = await db.delete(mediaAsset).where(eq(mediaAsset.id, id)).returning();
	if (!deleted) throw new Error(`deleteMediaAsset: no media_asset row "${id}"`);
	return deleted;
}
