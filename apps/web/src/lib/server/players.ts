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
	isPubliclyVisible,
	listPublicEntities,
	publicEntityBySlug,
	publicMediaAssetById,
	publicMentionTargets,
	universeForExport,
	type Db,
	type PublicFullEntity,
	type PublicGapEntity,
	type RevealedEntityListItem
} from '@canonry/db';
import type { EntityVisibility } from '@canonry/db/schema';
import { detectLanguage, type Locale } from '@canonry/lang';
import { stripSecretsForPlayers } from '$lib/markdown-secrets';

export interface PublicUniverse {
	id: string;
	name: string;
	slug: string;
}

/** #83's `/p/<slug>` route: the one link a GM shares outside the product, so it cannot
 * mean different things to different readers. Delegates to `universeForExport`, whose
 * doc comment has the reasoning - `universe.slug` is globally unique (decision J1, issue
 * #153), so this is unambiguous with no owner filter needed. */
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

/** #220: the GM route's own mention-target query (`/w/[universe]/e/[slug]/+page.server.ts`)
 * already fetches every entity in the universe to resolve `[[Name]]` mentions against
 * (#105/#15), so it costs nothing to carry `visibility` along too. `EntryProseWithSecrets
 * .svelte`'s player preview needs exactly what `publicMentionTargets` above would return
 * for the same universe - this filters the one already-fetched list down to that, with
 * `isPubliclyVisible` (the predicate `publicMentionTargets`'s own WHERE clause is built
 * from) deciding, not a second copy of the `gm_only` rule. Runs here, server-side, in the
 * same `load` that already ran the one query: no second round trip, and this module (under
 * `$lib/server/`) never ships to the client, so `@canonry/db`'s runtime - the `postgres`
 * driver included - never has to either. */
export interface GmMentionTarget extends PublicMentionTarget {
	visibility: EntityVisibility;
}

export function publicMentionTargetsFrom(targets: GmMentionTarget[]): PublicMentionTarget[] {
	return targets.filter((target) => isPubliclyVisible(target.visibility));
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

/**
 * #254: an entry body may carry a GM-authored image reference, contract #1's
 * `![alt](/w/<universeSlug>/e/<entrySlug>/media/<assetId>)` - the GM surface's own URL,
 * which sits behind universe membership and a signed-out player's browser can never
 * load. Rewrites every such reference to the public route, `/p/<universeSlug>/media
 * /<assetId>`, but only for an asset `publicMediaAssetById` actually clears - the same
 * double gate a direct request to that route applies. Anything that does not clear it is
 * removed from the body outright, alt text included: an unpublished picture referenced
 * from a published body degrades to nothing, never a broken `<img>` and never a leaked
 * filename hinting at what a player has not been shown (guardrail 6).
 */
const BODY_IMAGE_RE = /!\[[^\]]*\]\(\/w\/[^/)]+\/e\/[^/)]+\/media\/([^/)]+\))/g;

async function resolvePublicBodyImages(
	db: Db,
	universeId: string,
	universeSlug: string,
	body: string
): Promise<string> {
	const assetIds = new Set([...body.matchAll(BODY_IMAGE_RE)].map((m) => m[1].slice(0, -1)));
	if (assetIds.size === 0) return body;

	const visible = new Map<string, boolean>();
	for (const assetId of assetIds) {
		visible.set(assetId, (await publicMediaAssetById(db, universeId, assetId)) !== undefined);
	}

	return body.replace(BODY_IMAGE_RE, (whole, closedAssetId: string) => {
		const assetId = closedAssetId.slice(0, -1);
		if (!visible.get(assetId)) return '';
		return `![](/p/${universeSlug}/media/${assetId})`;
	});
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
	universeSlug: string,
	entitySlug: string,
	locale?: Locale
): Promise<PublicEntityPageData | undefined> {
	const found = await publicEntityBySlug(db, universeId, entitySlug, locale);
	if (!found) return undefined;

	if (found.status === 'gap') {
		return { entity: found, mentionTargets: [] };
	}

	const mentionTargets = await publicMentionTargets(db, universeId);
	const strippedBody = stripSecretsForPlayers(found.body);
	const body = await resolvePublicBodyImages(db, universeId, universeSlug, strippedBody);
	return {
		entity: { ...found, body, language: detectLanguage(body) },
		mentionTargets
	};
}
