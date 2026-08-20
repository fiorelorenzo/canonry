/**
 * Shared universe+entity+role resolution for every endpoint under this route (#66, #71).
 * `_`-prefixed so SvelteKit never treats it as a route of its own. Mirrors the pattern
 * the edit page's own `loadUniverseAndEntity` already established (issue #86): each
 * write surface re-checks membership itself, since a raw POST never runs the layout's
 * `load` first.
 */
import { error } from '@sveltejs/kit';
import { universeAccessBySlug, type Db } from '@canonry/db';
// The enum's TypeScript type lives with the schema rather than on the query barrel, since
// it is generated from the pgEnum itself.
import type { EntityType, UniverseMemberRole } from '@canonry/db/schema';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';

export interface MediaRequestContext {
	conn: Db;
	universe: { id: string; imageStyleId: string | null; aiEnabled: boolean };
	entity: {
		id: string;
		name: string;
		/** The enum, not a string: #366 reads a cover's shape off it, and a widened type
		 * here would make that lookup take a key the table has no entry for. */
		type: EntityType;
		body: string;
		imagePromptModifier: string | null;
	};
	role: UniverseMemberRole;
	userId: string;
}

export async function loadMediaContext(
	locals: App.Locals,
	universeSlug: string,
	entitySlug: string
): Promise<MediaRequestContext> {
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

	return {
		conn,
		universe: { id: world.id, imageStyleId: world.imageStyleId, aiEnabled: world.aiEnabled },
		entity: {
			id: current.id,
			name: current.name,
			type: current.type,
			body: current.body,
			imagePromptModifier: current.imagePromptModifier
		},
		role: access.role,
		userId: locals.user.id
	};
}

/** A viewer may look (the layout already let them in) but never spend or write (#71's
 * guardrail-adjacent principle applies to money too - only owner/editor may generate,
 * attach or edit a style override), matching the edit page's own 403-not-404 reasoning:
 * existence is not what is being hidden here. */
export function requireWriter(locals: App.Locals, role: UniverseMemberRole): void {
	if (role === 'viewer') error(403, messages(locals.locale).entry.errors.viewerCannotGenerateMedia);
}
