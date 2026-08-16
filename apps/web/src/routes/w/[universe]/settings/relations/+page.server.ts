/**
 * `/w/[universe]/settings/relations`: issue #192, decision K1 (DECISIONS.md "Round six").
 * The relation catalogue a GM can actually see and act on - the shipped ten plus this
 * universe's own types, with a real usage count, and rename/widen/merge for the
 * universe's own. Linked from `/w/[universe]/settings` rather than a nav item of its own
 * (A2 caps the sidebar at seven, and Settings is already one of them).
 *
 * Every write below is plain GM-initiated CRUD, not a proposal: guardrail 1 covers a
 * model's output landing unreviewed, and nothing here is a model's output. The queries
 * in `packages/db/src/queries/relation-types.ts` enforce the shipped-catalogue-is-
 * read-only rule structurally (every mutation filters on `universe_id = universeId`, so
 * a shipped row can never match), so this file's job is just role-gating and turning a
 * thrown error into a `fail()` a dialog can show.
 *
 * `translateRelationType` (#198) is the same kind of write as the three above it, one
 * `LOCALES` loop wider: one submit from `TranslateRelationTypeDialog` carries every
 * shipped locale's field pair for one type, and this action writes or clears each
 * locale in turn - a blank pair clears that locale back to fallback, a filled pair
 * saves it, one filled and one blank is rejected as an error before anything is
 * written. Nothing here drafts or accepts a copilot proposal; see
 * `packages/db/src/queries/relation-types.ts`'s module doc for why that half of #198 is
 * not built.
 */
import { error, fail } from '@sveltejs/kit';
import {
	clearRelationTypeLabel,
	mergeRelationTypes,
	renameRelationType,
	setRelationTypeLabel,
	widenRelationType,
	listRelationTypesForUniverse,
	RelationTypeLabelConflictError,
	RelationTypeNotOwnedError,
	universeAccessBySlug,
	type Db,
	type UniverseAccess
} from '@canonry/db';
import type { EntityType } from '@canonry/db/schema';
import { LOCALES, messages, type Locale } from '$lib/i18n';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

async function requireManager(
	conn: Db,
	universe: string,
	userId: string,
	locale: Locale
): Promise<UniverseAccess> {
	const access = await universeAccessBySlug(conn, universe, userId);
	if (!access) error(404, `No universe named "${universe}"`);
	if (access.role === 'viewer') {
		error(403, messages(locale).universe.settings.relations.viewerForbiddenError);
	}
	return access;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);

	const types = await listRelationTypesForUniverse(conn, access.universe.id);

	return {
		universeSlug: access.universe.slug,
		universeName: access.universe.name,
		canManage: access.role !== 'viewer',
		types
	};
};

export const actions: Actions = {
	renameRelationType: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await requireManager(conn, params.universe, locals.user.id, locals.locale);
		const t = messages(locals.locale).universe.settings.relations;

		const form = await request.formData();
		const typeId = form.get('typeId');
		const label = form.get('label');
		const inverseLabel = form.get('inverseLabel');
		if (typeof typeId !== 'string' || typeId.length === 0) {
			return fail(400, { action: 'rename' as const, typeId: '', error: t.rename.notOwnedError });
		}
		const trimmedLabel = typeof label === 'string' ? label.trim() : '';
		const trimmedInverse = typeof inverseLabel === 'string' ? inverseLabel.trim() : '';
		if (trimmedLabel.length === 0) {
			return fail(400, { action: 'rename' as const, typeId, error: t.rename.labelRequiredError });
		}
		if (trimmedInverse.length === 0) {
			return fail(400, {
				action: 'rename' as const,
				typeId,
				error: t.rename.inverseLabelRequiredError
			});
		}

		try {
			await renameRelationType(conn, access.universe.id, typeId, {
				label: trimmedLabel,
				inverseLabel: trimmedInverse
			});
		} catch (err) {
			if (err instanceof RelationTypeNotOwnedError) {
				return fail(403, { action: 'rename' as const, typeId, error: t.rename.notOwnedError });
			}
			if (err instanceof RelationTypeLabelConflictError) {
				return fail(400, { action: 'rename' as const, typeId, error: t.rename.conflictError });
			}
			throw err;
		}
		return { action: 'rename' as const, typeId };
	},

	widenRelationType: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await requireManager(conn, params.universe, locals.user.id, locals.locale);
		const t = messages(locals.locale).universe.settings.relations;

		const form = await request.formData();
		const typeId = form.get('typeId');
		const addFrom = form.getAll('addFrom').filter((v): v is string => typeof v === 'string');
		const addTo = form.getAll('addTo').filter((v): v is string => typeof v === 'string');
		if (typeof typeId !== 'string' || typeId.length === 0) {
			return fail(400, { action: 'widen' as const, typeId: '', error: t.widen.notOwnedError });
		}
		if (addFrom.length === 0 && addTo.length === 0) {
			return fail(400, { action: 'widen' as const, typeId, error: t.widen.noChangeError });
		}

		try {
			await widenRelationType(conn, access.universe.id, typeId, {
				addFrom: addFrom as EntityType[],
				addTo: addTo as EntityType[]
			});
		} catch (err) {
			if (err instanceof RelationTypeNotOwnedError) {
				return fail(403, { action: 'widen' as const, typeId, error: t.widen.notOwnedError });
			}
			throw err;
		}
		return { action: 'widen' as const, typeId };
	},

	mergeRelationTypes: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await requireManager(conn, params.universe, locals.user.id, locals.locale);
		const t = messages(locals.locale).universe.settings.relations;

		const form = await request.formData();
		const fromTypeId = form.get('fromTypeId');
		const intoTypeId = form.get('intoTypeId');
		if (typeof fromTypeId !== 'string' || fromTypeId.length === 0) {
			return fail(400, { action: 'merge' as const, error: t.merge.notOwnedError });
		}
		if (typeof intoTypeId !== 'string' || intoTypeId.length === 0) {
			return fail(400, { action: 'merge' as const, error: t.merge.sameTypeError });
		}
		if (fromTypeId === intoTypeId) {
			return fail(400, { action: 'merge' as const, error: t.merge.sameTypeError });
		}

		try {
			const result = await mergeRelationTypes(conn, access.universe.id, {
				fromTypeId,
				intoTypeId
			});
			return {
				action: 'merge' as const,
				movedCount: result.movedCount,
				dedupedCount: result.dedupedCount,
				intoLabel: result.intoType.label,
				intoKey: result.intoType.key
			};
		} catch (err) {
			if (err instanceof RelationTypeNotOwnedError) {
				return fail(403, { action: 'merge' as const, error: t.merge.notOwnedError });
			}
			throw err;
		}
	},

	translateRelationType: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await requireManager(conn, params.universe, locals.user.id, locals.locale);
		const t = messages(locals.locale).universe.settings.relations;

		const form = await request.formData();
		const typeId = form.get('typeId');
		if (typeof typeId !== 'string' || typeId.length === 0) {
			return fail(400, {
				action: 'translate' as const,
				typeId: '',
				error: t.translate.notOwnedError
			});
		}

		for (const loc of LOCALES) {
			const label = form.get(`label_${loc}`);
			const inverseLabel = form.get(`inverseLabel_${loc}`);
			const trimmedLabel = typeof label === 'string' ? label.trim() : '';
			const trimmedInverse = typeof inverseLabel === 'string' ? inverseLabel.trim() : '';

			try {
				if (trimmedLabel.length === 0 && trimmedInverse.length === 0) {
					await clearRelationTypeLabel(conn, access.universe.id, typeId, loc);
					continue;
				}
				if (trimmedLabel.length === 0 || trimmedInverse.length === 0) {
					return fail(400, {
						action: 'translate' as const,
						typeId,
						error: t.translate.incompletePairError
					});
				}
				await setRelationTypeLabel(conn, access.universe.id, typeId, {
					locale: loc,
					label: trimmedLabel,
					inverseLabel: trimmedInverse,
					authorKind: 'human'
				});
			} catch (err) {
				if (err instanceof RelationTypeNotOwnedError) {
					return fail(403, {
						action: 'translate' as const,
						typeId,
						error: t.translate.notOwnedError
					});
				}
				throw err;
			}
		}

		return { action: 'translate' as const, typeId };
	}
};
