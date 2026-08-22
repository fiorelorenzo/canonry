/**
 * The one seam between `@canonry/db`'s revelation-filtered reads and #83's `/p/**` routes.
 * `+page.server.ts` files stay thin wrappers over the two functions below, which is what
 * lets #85's leak test call exactly what a page's `load` calls - same function, same
 * return shape - rather than re-deriving it against a duplicated query.
 *
 * `stripSecretsForPlayers` (decision E6) runs here, once, on the way out of
 * `publicEntityBySlug`'s raw `entity.body`: this is the only place in the request path a
 * secret or GM-note fence is ever removed from an entry's prose for a player. It comes from
 * `@canonry/lang`, which since #306 owns the single definition of what those fences hide, so
 * the quoted evidence `publicEntityBySlug` withholds one layer down and the prose stripped
 * here can never disagree about where a secret starts.
 */
import {
	isPubliclyVisible,
	publicEntityBySlug,
	publicMediaAssetById,
	publicMentionTargets,
	publicSessionDiary,
	universeForExport,
	type Db,
	type DiaryRevelation,
	type PublicFullEntity,
	type PublicGapEntity
} from '@canonry/db';
import type { EntityVisibility } from '@canonry/db/schema';
import { detectLanguage, stripSecretsForPlayers, type Locale } from '@canonry/lang';
import { matchImageToken } from '$lib/markdown';

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

/** #530's index page, decision "W2 = A the campaign diary" (round eighteen): the sessions
 * the party has actually met, newest first, each carrying its own player-visible prose.
 * `publicSessionDiary` already applies guardrail 6 to *who* qualifies and to *which*
 * revelations under a qualifying session are safe to name; the one thing left for this
 * seam - the same seam `loadPublicEntity` below already owns for a single entry - is the
 * two things that only ever happen at the point a body leaves the database: stripping
 * `:::secret`/`:::gmnote` fences (a session's body is canon prose exactly like an entry's,
 * so it gets the identical filter, not a second one) and rewriting an in-body image
 * reference to its public URL. */
export interface PlayerDiarySession {
	id: string;
	slug: string;
	name: string;
	body: string;
	language: Locale | null;
	revealedAt: Date;
	images: PublicFullEntity['images'];
	coverImageId: string | null;
	revelations: DiaryRevelation[];
}

export interface PlayerDiaryData {
	sessions: PlayerDiarySession[];
	mentionTargets: PublicMentionTarget[];
}

export async function loadPlayerDiary(
	db: Db,
	universeId: string,
	universeSlug: string,
	locale?: Locale
): Promise<PlayerDiaryData> {
	const [rawSessions, mentionTargets] = await Promise.all([
		publicSessionDiary(db, universeId, { locale }),
		publicMentionTargets(db, universeId)
	]);

	const sessions = await Promise.all(
		rawSessions.map(async (session) => {
			const strippedBody = stripSecretsForPlayers(session.body);
			const body = await resolvePublicBodyImages(db, universeId, universeSlug, strippedBody);
			return {
				id: session.id,
				slug: session.slug,
				name: session.name,
				body,
				language: detectLanguage(body),
				revealedAt: session.revealedAt,
				images: session.images,
				coverImageId: session.coverImageId,
				revelations: session.revelations
			};
		})
	);

	return { sessions, mentionTargets };
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
interface BodyImageToken {
	start: number;
	end: number;
	assetId: string;
	widthPercent: number | null;
}

/** Issue #385: rewritten to share `matchImageToken` with `markdown.ts`'s own render
 * rule and `imageUrlsIn` (the delete route's in-body check) instead of a second,
 * looser regex - the old one captured up to the closing `)`, which happily swallowed
 * R9's `=NN%` width suffix (#384) into the "asset id" and sent a malformed uuid
 * straight into `publicMediaAssetById`. One grammar, so a body a GM can save is a
 * body this route can always parse. */
function bodyImageTokens(body: string): BodyImageToken[] {
	const tokens: BodyImageToken[] = [];
	for (let i = 0; i < body.length; i++) {
		if (body.charCodeAt(i) !== 0x21 /* ! */) continue;
		const matched = matchImageToken(body, i);
		if (!matched) continue;
		const assetId = matched.url.split('/').pop();
		if (assetId)
			tokens.push({ start: i, end: matched.end, assetId, widthPercent: matched.widthPercent });
	}
	return tokens;
}

async function resolvePublicBodyImages(
	db: Db,
	universeId: string,
	universeSlug: string,
	body: string
): Promise<string> {
	const tokens = bodyImageTokens(body);
	if (tokens.length === 0) return body;

	const visible = new Map<string, boolean>();
	for (const assetId of new Set(tokens.map((token) => token.assetId))) {
		visible.set(assetId, (await publicMediaAssetById(db, universeId, assetId)) !== undefined);
	}

	let result = '';
	let cursor = 0;
	for (const token of tokens) {
		result += body.slice(cursor, token.start);
		if (visible.get(token.assetId)) {
			const suffix = token.widthPercent ? ` =${token.widthPercent}%` : '';
			result += `![](/p/${universeSlug}/media/${token.assetId}${suffix})`;
		}
		cursor = token.end;
	}
	result += body.slice(cursor);
	return result;
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
