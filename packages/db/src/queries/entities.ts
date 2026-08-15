/**
 * SPEC.md §17 / issue #122: `entity.language` is detected at write time, overridable by the
 * GM, and null when it is unknown or genuinely mixed - and a GM's explicit choice, including
 * that null "not sure / mixed" answer, is sticky forever. `entity.languageSource` is what
 * makes that possible (migration 0020): a 'detected' row is free to change on every save,
 * including down to null when an edit makes the body shorter or genuinely mixed, while a
 * 'human' row is never touched by detection again, because re-guessing a value the GM
 * already set is a fight with the software rather than a helpful default.
 */
import { eq } from 'drizzle-orm';
import { detectLanguage, toLocale, type Locale } from '@canonry/lang';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import { revision } from '../schema/revision.js';
import type { LanguageSource } from '../schema/enums.js';

export interface EntityLanguageState {
	language: Locale | null;
	languageSource: LanguageSource;
}

/** What a caller reads off the `entity` row: `language` is a plain `text` column at the
 * schema level (drizzle has no way to know it only ever holds a `Locale`), so this is
 * `toLocale`-narrowed here rather than trusted at every call site. */
export interface StoredEntityLanguage {
	language: string | null;
	languageSource: LanguageSource;
}

/**
 * The pure decision, kept separate from any I/O so it is trivial to unit-test: a 'human'
 * row passes through untouched (narrowed, never re-guessed), a 'detected' row is replaced
 * by whatever the heuristic says right now (including null, which is an honest downgrade,
 * not a bug).
 */
export function nextEntityLanguage(
	current: StoredEntityLanguage,
	body: string
): EntityLanguageState {
	if (current.languageSource === 'human') {
		return { language: toLocale(current.language), languageSource: 'human' };
	}
	return { language: detectLanguage(body), languageSource: 'detected' };
}

/**
 * The accept-time counterpart to `nextEntityLanguage`, for guardrail 1's own writer
 * (`acceptProposal`, `packages/db/src/queries/proposals.ts`): an import's per-document
 * detection (`patch.language`, a signal read over the whole source document rather than a
 * short merged entity summary) is more reliable than re-running the heuristic over the
 * patch's own body, so it wins when present. Still never touches a 'human' row, and still
 * falls back to `detectLanguage` on the resulting body when the patch carries nothing.
 */
export function languageFromAcceptedPatch(
	current: StoredEntityLanguage,
	patchLanguage: string | undefined,
	body: string
): EntityLanguageState {
	if (current.languageSource === 'human') {
		return { language: toLocale(current.language), languageSource: 'human' };
	}
	return { language: toLocale(patchLanguage) ?? detectLanguage(body), languageSource: 'detected' };
}

export interface SaveEntityBodyInput {
	universeId: string;
	entityId: string;
	entityName: string;
	entityAliases: string[];
	parentRevisionId?: string;
	authorUserId: string;
	body: string;
	/** The entity's language state before this save, so detection can refuse to run over a
	 * human's choice. Callers already have this from the row they loaded to get here. */
	current: StoredEntityLanguage;
}

export interface SaveEntityBodyResult extends EntityLanguageState {
	revisionId: string;
}

/**
 * The one write path for a human edit to an entry's body: a `revision` row and the
 * entity's own body move together (issue #86, guardrail 2), and `entity.language` is
 * recomputed in the same transaction so nothing ever reads a committed entity whose
 * language disagrees with the body that produced it.
 */
export async function saveEntityBody(
	db: Db,
	input: SaveEntityBodyInput
): Promise<SaveEntityBodyResult> {
	const next = nextEntityLanguage(input.current, input.body);
	return db.transaction(async (tx) => {
		const [rev] = await tx
			.insert(revision)
			.values({
				universeId: input.universeId,
				entityId: input.entityId,
				parentRevisionId: input.parentRevisionId,
				authorKind: 'human',
				authorUserId: input.authorUserId,
				name: input.entityName,
				aliases: input.entityAliases,
				body: input.body
			})
			.returning({ id: revision.id });
		if (!rev) throw new Error('revision insert returned no row');
		await tx
			.update(entity)
			.set({
				body: input.body,
				language: next.language,
				languageSource: next.languageSource,
				updatedAt: new Date()
			})
			.where(eq(entity.id, input.entityId));
		return { revisionId: rev.id, ...next };
	});
}

/**
 * The GM's explicit choice from the entry's own language control, including "not sure /
 * mixed" (`language: null`) - always recorded as 'human', so it is never revisited by a
 * later save's detection pass.
 */
export async function setEntityLanguage(
	db: Db,
	input: { entityId: string; language: Locale | null }
): Promise<EntityLanguageState> {
	const next: EntityLanguageState = { language: input.language, languageSource: 'human' };
	await db
		.update(entity)
		.set({ language: next.language, languageSource: next.languageSource })
		.where(eq(entity.id, input.entityId));
	return next;
}

/**
 * "Auto-detect" on the control: reverts a human override back to automatic and, rather than
 * leaving a stale value sitting under the new 'detected' provenance until the entry's next
 * save, immediately re-runs the heuristic against the body as it stands right now.
 */
export async function resetEntityLanguageToDetected(
	db: Db,
	input: { entityId: string }
): Promise<EntityLanguageState> {
	const [current] = await db
		.select({ body: entity.body })
		.from(entity)
		.where(eq(entity.id, input.entityId));
	if (!current) throw new Error(`entity ${input.entityId} does not exist`);
	const next: EntityLanguageState = {
		language: detectLanguage(current.body),
		languageSource: 'detected'
	};
	await db
		.update(entity)
		.set({ language: next.language, languageSource: next.languageSource })
		.where(eq(entity.id, input.entityId));
	return next;
}
