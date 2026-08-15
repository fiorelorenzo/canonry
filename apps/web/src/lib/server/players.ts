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
	type PublicFullEntity,
	type PublicGapEntity,
	type RevealedEntityListItem
} from '@canonry/db';
import { detectLanguage, type Locale } from '@canonry/lang';
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

/**
 * #127: the `lang` attribute a revealed entry's prose carries, so a screen reader
 * pronounces it in the right language. Detected fresh from the *player-visible* body on
 * every request, deliberately never read off `entity.language` (packages/db/src/schema
 * /entity.ts): that column may have been written from the raw source, secret and GM-note
 * fences included, and reusing it here would let a hidden block's language leak through
 * the one attribute this route exposes about content the filter was supposed to hide.
 * `detectLanguage` is the same conservative heuristic that column itself is written with
 * (@canonry/lang, SPEC.md §17) - short or genuinely mixed text answers null here exactly
 * like it does at save time, and null means "no attribute", inheriting the page's own
 * chrome language rather than guessing. A `gap` entity never reaches this at all: it has
 * no body to detect from, and guessing one from nothing would itself be a leak of whether
 * undiscovered content exists in some particular language.
 */
export type PublicEntityView = (PublicFullEntity & { language: Locale | null }) | PublicGapEntity;

export interface PublicEntityPageData {
	entity: PublicEntityView;
	mentionTargets: PublicMentionTarget[];
}

/** #83's detail page and #85's leak test both call this. `entity.body` on the returned
 * value, when `entity.status === 'full'`, has already been through
 * `stripSecretsForPlayers` - a secret or GM-note block is not merely styled invisible, its
 * text is not in this object at all, which is what a `JSON.stringify` of the return value
 * (exactly what SvelteKit serialises as page data) never contains. `entity.language`
 * alongside it is detected from that same stripped string, for the reason in this file's
 * own doc comment on `PublicEntityView` above. */
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
	const body = stripSecretsForPlayers(found.body);
	return {
		entity: { ...found, body, language: detectLanguage(body) },
		mentionTargets
	};
}
