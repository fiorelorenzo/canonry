// Issue #451, decision U2, on #407's own model (queries/media.ts). Raw data access for
// narration presets and a universe's own custom voice - no prompt-building here, that is
// `loremasterVoiceInstruction` (packages/copilot/src/speech.ts), which takes the resolved
// clause this module hands its callers.
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { narrationStyle, narrationStyleLabel } from '../schema/narration.js';
import { universe } from '../schema/universe.js';

export type NarrationStyleRow = typeof narrationStyle.$inferSelect;

export interface NarrationStylePreset {
	id: string;
	slug: string;
	name: string;
	description: string;
	promptClause: string;
	exampleSentence: string;
	sortOrder: number;
}

/** The shipped catalogue the settings picker renders - every preset (`universe_id IS
 * NULL`), ordered by `sort_order`. `locale`'s translation (`narration_style_label`) wins
 * when one exists, the row's own English text otherwise - same coalesce idiom
 * `listImageStylePresets` uses, now applied to `example_sentence` too (issue #796) so the
 * picker card reads in the universe's own language instead of always in English. */
export async function listNarrationStylePresets(
	db: Db,
	locale: string
): Promise<NarrationStylePreset[]> {
	const rows = await db
		.select({
			id: narrationStyle.id,
			slug: narrationStyle.slug,
			name: sql<string>`coalesce(${narrationStyleLabel.name}, ${narrationStyle.name})`,
			description: sql<string>`coalesce(${narrationStyleLabel.description}, ${narrationStyle.description})`,
			promptClause: narrationStyle.promptClause,
			exampleSentence: sql<
				string | null
			>`coalesce(${narrationStyleLabel.exampleSentence}, ${narrationStyle.exampleSentence})`,
			sortOrder: narrationStyle.sortOrder
		})
		.from(narrationStyle)
		.leftJoin(
			narrationStyleLabel,
			and(
				eq(narrationStyleLabel.narrationStyleId, narrationStyle.id),
				eq(narrationStyleLabel.locale, locale)
			)
		)
		.where(isNull(narrationStyle.universeId))
		.orderBy(asc(narrationStyle.sortOrder));
	return rows.map((row) => ({
		id: row.id,
		slug: row.slug ?? '',
		name: row.name,
		description: row.description ?? '',
		promptClause: row.promptClause,
		exampleSentence: row.exampleSentence ?? '',
		sortOrder: row.sortOrder
	}));
}

/** `presetId` named a row that either does not exist or is not actually a shipped preset
 * (`universe_id` not null) - same "one message either way" posture
 * `ImageStylePresetNotFoundError` documents. */
export class NarrationStylePresetNotFoundError extends Error {
	constructor(presetId: string) {
		super(`no shipped narration style preset with id "${presetId}"`);
		this.name = 'NarrationStylePresetNotFoundError';
	}
}

/** Points `universe.narration_style_id` at a shipped preset - never copies its prompt
 * clause into a per-universe row, so improving a preset improves every world that already
 * chose it. Refuses a target whose `universe_id` is not null, so a GM can never point their
 * universe at another universe's private custom row by guessing its id - a preset is the
 * only kind of row this may ever point at. Spends nothing. */
export async function selectUniverseNarrationStylePreset(
	db: Db,
	universeId: string,
	presetId: string
): Promise<void> {
	await db.transaction(async (tx) => {
		const [preset] = await tx
			.select({ id: narrationStyle.id })
			.from(narrationStyle)
			.where(and(eq(narrationStyle.id, presetId), isNull(narrationStyle.universeId)))
			.limit(1);
		if (!preset) throw new NarrationStylePresetNotFoundError(presetId);

		const [world] = await tx
			.select({ id: universe.id })
			.from(universe)
			.where(eq(universe.id, universeId))
			.for('update');
		if (!world) {
			throw new Error(`selectUniverseNarrationStylePreset: no universe row for id "${universeId}"`);
		}

		await tx
			.update(universe)
			.set({ narrationStyleId: presetId })
			.where(eq(universe.id, universeId));
	});
}

export interface UpsertUniverseNarrationStyleInput {
	universeId: string;
	name: string;
	promptClause: string;
}

/** Universe settings' "Loremaster's voice" section: one `narration_style` row per
 * universe, updated in place - found by `universe_id` (never by `narration_style_id`,
 * which might currently point at a preset instead), the same reasoning
 * `upsertUniverseImageStyle` documents for its own custom row. Saving always re-points the
 * universe at the found-or-created row, which is what "Save" on the custom card means:
 * switch back to my own voice. */
export async function upsertUniverseNarrationStyle(
	db: Db,
	input: UpsertUniverseNarrationStyleInput
): Promise<NarrationStyleRow> {
	return db.transaction(async (tx) => {
		const [world] = await tx
			.select({ id: universe.id })
			.from(universe)
			.where(eq(universe.id, input.universeId))
			.for('update');
		if (!world) {
			throw new Error(`upsertUniverseNarrationStyle: no universe row for id "${input.universeId}"`);
		}

		const [existing] = await tx
			.select({ id: narrationStyle.id })
			.from(narrationStyle)
			.where(eq(narrationStyle.universeId, input.universeId))
			.limit(1);

		if (existing) {
			const [updated] = await tx
				.update(narrationStyle)
				.set({ name: input.name, promptClause: input.promptClause })
				.where(eq(narrationStyle.id, existing.id))
				.returning();
			if (!updated) {
				throw new Error(
					`upsertUniverseNarrationStyle: update returned no row for "${existing.id}"`
				);
			}
			await tx
				.update(universe)
				.set({ narrationStyleId: updated.id })
				.where(eq(universe.id, input.universeId));
			return updated;
		}

		const [inserted] = await tx
			.insert(narrationStyle)
			.values({
				universeId: input.universeId,
				name: input.name,
				promptClause: input.promptClause
			})
			.returning();
		if (!inserted) {
			throw new Error(
				`upsertUniverseNarrationStyle: insert returned no row for universe "${input.universeId}"`
			);
		}
		await tx
			.update(universe)
			.set({ narrationStyleId: inserted.id })
			.where(eq(universe.id, input.universeId));
		return inserted;
	});
}

/** The clause `loremasterVoiceInstruction` (packages/copilot/src/speech.ts) appends to a
 * system prompt: the universe's chosen row's `prompt_clause` (preset or custom), or '' when
 * nothing is chosen yet - the same "empty means nothing" contract the old
 * `loremaster_description` column carried. `complete.ts` reads this directly; `ask.ts`
 * folds the same join into its own universe select instead, since it already reads several
 * other columns off the same row in one round trip. */
export async function loremasterVoiceClauseForUniverse(
	db: Db,
	universeId: string
): Promise<string> {
	const [row] = await db
		.select({ clause: narrationStyle.promptClause })
		.from(universe)
		.leftJoin(narrationStyle, eq(narrationStyle.id, universe.narrationStyleId))
		.where(eq(universe.id, universeId))
		.limit(1);
	return row?.clause ?? '';
}
