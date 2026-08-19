/**
 * SPEC.md §11.1, issue TBD (filed by the agent that added /admin/models' text-model
 * section - see that route's own doc comment). Raw data access for `model_config`, the
 * table @canonry/ai's `resolveModel` reads for every text call (`cheap`/`premium`/
 * `multimodal`/`embedding`/`image` purposes) - no caching, no provider validation, no
 * business logic, the same split queries/media.ts keeps for `image_model_config`.
 * Provider validation against @canonry/ai's KNOWN_PROVIDERS happens in the admin page
 * that calls this, not here: this package must never depend on @canonry/ai.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { ModelPurpose } from '../schema/enums.js';
import { modelConfig } from '../schema/model.js';
import { mergeOwnedParams } from './params.js';

export type ModelConfigRow = typeof modelConfig.$inferSelect;

/** Every purpose's currently active row, for the admin panel - at most one per purpose,
 * enforced by model_config's partial unique index. Deliberately excludes inactive rows:
 * unlike image_model_config (whose upsert updates its one row per feature in place),
 * upsertTextModel below keeps every deactivated row as history, so listing everything
 * would show the whole trail instead of "what's active now". */
export async function listActiveTextModels(db: Db): Promise<ModelConfigRow[]> {
	return db
		.select()
		.from(modelConfig)
		.where(eq(modelConfig.active, true))
		.orderBy(asc(modelConfig.purpose));
}

export interface UpsertTextModelInput {
	purpose: ModelPurpose;
	provider: string;
	modelId: string;
	/** Every `params` key the caller's form renders and therefore may set or clear
	 * (`mergeOwnedParams`, issue #235). `upsertTextModel` inserts a fresh row rather
	 * than updating in place (see the function doc comment below), so this is what
	 * carries every key of the row being superseded into the new one - the admin
	 * text-model form renders no pricing field at all today, so its own call site
	 * passes an empty array here, and every params key a purpose already had survives
	 * a provider/model switch untouched. */
	paramKeys: readonly string[];
	params: Record<string, unknown>;
}

/**
 * Admin edit: switches the active model for a purpose without a deploy (SPEC.md §11.1).
 * Deactivates the current active row for the purpose, if any, and inserts a fresh active
 * row, rather than updating the existing row's provider/modelId in place the way
 * upsertImageModel (queries/media.ts) does - model_config's partial unique index
 * (`where active = true`) already allows any number of *inactive* rows per purpose, and
 * the admin panel's "when it was last changed" column reads better as a real history of
 * who set what and when than as one row silently overwritten. Same transactional
 * shape either way: lock the current active row first (`for('update')`) so two
 * concurrent admin edits cannot both try to insert a new active row and collide on the
 * unique index. The new row's `params` is merged from the deactivated row's, via
 * `input.paramKeys` (issue #235) - without that merge, every switch would start the new
 * row's params from nothing, deactivated row or not.
 */
export async function upsertTextModel(
	db: Db,
	input: UpsertTextModelInput
): Promise<ModelConfigRow> {
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(modelConfig)
			.where(and(eq(modelConfig.purpose, input.purpose), eq(modelConfig.active, true)))
			.for('update')
			.limit(1);

		if (existing[0]) {
			await tx
				.update(modelConfig)
				.set({ active: false, updatedAt: new Date() })
				.where(eq(modelConfig.id, existing[0].id));
		}

		const [inserted] = await tx
			.insert(modelConfig)
			.values({
				purpose: input.purpose,
				provider: input.provider,
				modelId: input.modelId,
				active: true,
				params: mergeOwnedParams(existing[0]?.params, input.paramKeys, input.params)
			})
			.returning();
		if (!inserted) {
			throw new Error(`upsertTextModel: insert returned no row for purpose "${input.purpose}"`);
		}
		return inserted;
	});
}
