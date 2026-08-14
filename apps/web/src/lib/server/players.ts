/**
 * The one seam between `@canonry/db`'s revelation-filtered reads and #83's `/p/**` routes.
 * `+page.server.ts` files stay thin wrappers over the two functions below, which is what
 * lets #85's leak test call exactly what a page's `load` calls - same function, same
 * return shape - rather than re-deriving it against a duplicated query.
 *
 * `stripSecretsForPlayers` (decision E6) runs here, once, on the way out of
 * `publicEntityBySlug`'s raw `entity.body`: this is the only place in the request path a
 * secret or GM-note fence is ever removed for a player, so there is exactly one filter to
 * get right, not one in the route and a second one somewhere else that could drift from it.
 */
import {
	listPublicEntities,
	publicEntityBySlug,
	publicMentionTargets,
	universeForExport,
	type Db,
	type PublicEntity,
	type RevealedEntityListItem
} from '@canonry/db';
import { stripSecretsForPlayers } from '$lib/markdown-secrets';

export interface PublicUniverse {
	id: string;
	name: string;
	slug: string;
}

export async function loadPublicUniverse(
	db: Db,
	universeSlug: string
): Promise<PublicUniverse | undefined> {
	return universeForExport(db, universeSlug);
}

/** #83's index page: every revealable entity, gap or full, `gm_only` never listed. */
export async function loadPublicIndex(
	db: Db,
	universeId: string
): Promise<RevealedEntityListItem[]> {
	return listPublicEntities(db, universeId);
}

export interface PublicMentionTarget {
	name: string;
	slug: string;
	aliases: string[];
}

export interface PublicEntityPageData {
	entity: PublicEntity;
	mentionTargets: PublicMentionTarget[];
}

/** #83's detail page and #85's leak test both call this. `entity.body` on the returned
 * value, when `entity.status === 'full'`, has already been through
 * `stripSecretsForPlayers` - a secret or GM-note block is not merely styled invisible, its
 * text is not in this object at all, which is what a `JSON.stringify` of the return value
 * (exactly what SvelteKit serialises as page data) never contains. */
export async function loadPublicEntity(
	db: Db,
	universeId: string,
	entitySlug: string
): Promise<PublicEntityPageData | undefined> {
	const found = await publicEntityBySlug(db, universeId, entitySlug);
	if (!found) return undefined;

	if (found.status === 'gap') {
		return { entity: found, mentionTargets: [] };
	}

	const mentionTargets = await publicMentionTargets(db, universeId);
	return {
		entity: { ...found, body: stripSecretsForPlayers(found.body) },
		mentionTargets
	};
}
