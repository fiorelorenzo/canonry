/**
 * The wire shape and the client half of the mention preview (#364, Q3 of round twelve).
 *
 * Where the data comes from, and why it is a fetch on hover rather than richer render-time
 * targets. `MentionTarget` (`$lib/markdown.ts`) is `{ name, slug, aliases }`, and it carries
 * *every entity in the universe* on every render call, because a body full of
 * `[[Other Entity]]` has to resolve against all of them. Widening it to carry a body opening
 * would therefore serialise an excerpt per entity into page data on every entry view, not one
 * per mention actually on the page: on the players' surface `publicMentionTargets` includes
 * revealable entities with no confirmed revelation, whose prose is exactly what guardrail 6
 * withholds, so that payload would ship undiscovered bodies to a reader who is not allowed
 * one. That is not a cost tradeoff, it is a leak, and it settles the decision.
 *
 * So: one small GET per mention, on the first hover or focus of that mention, cached for the
 * life of the prose component. On an entry with forty mentions the page load is unchanged
 * (zero extra bytes, zero extra queries), and the reader pays one request per mention they
 * actually point at, at most forty and in practice two or three. Both endpoints answer from
 * the same functions the corresponding page already calls, which is what keeps the preview
 * from becoming a second opinion about who may read what.
 */
import type { EntityType } from '@canonry/db/schema';
import type { MentionSurface } from './markdown';

export interface MentionPreviewData {
	name: string;
	type: EntityType;
	/** `'gap'` is E7's real state: a revealable entity the table has heard of but never
	 * discovered. Players' surface only - revelation is a players' concept, so the GM's own
	 * endpoint never sends it. An entry that exists with nothing written in it is `'full'`
	 * with an empty `excerpt` instead, on either surface: "not discovered yet" and "nobody
	 * has written this yet" are different sentences and the card says the right one. */
	status: 'full' | 'gap';
	/** Already through `mentionPreviewExcerpt`, so already through `stripSecretsForPlayers`.
	 * Empty when the entry has no prose. */
	excerpt: string;
	/** S6, round fourteen (#411): the entry's cover, already through the same gate its own
	 * page reads it through - the GM route sends `entity.coverAssetId` untouched (nothing to
	 * filter, its own doc comment says why), the players' route sends `coverImageId`, which
	 * `publicEntityBySlug` only fills for an asset that is attached, not `gm_only`, on an
	 * entry that is itself not `gm_only` and has been revealed (R7, #382) - the same chain
	 * `/p/<slug>`'s own band reads. Absent, never `null`, so an older client that has never
	 * heard of a cover still parses this payload, and `MentionPreview.svelte` draws nothing
	 * beside the text for the entry-with-no-cover case, exactly the same nothing. */
	coverId?: string;
}

/** The GM surface and the players' surface have separate endpoints on purpose, mirroring the
 * two route trees a mention's own href already picks between (#159): one is session and
 * membership gated, the other is open to anyone with the link, and a single endpoint that
 * branched on a query parameter would be one `if` away from serving the wrong one. */
export function mentionPreviewPath(
	surface: MentionSurface,
	universeSlug: string,
	entitySlug: string
): string {
	const universe = encodeURIComponent(universeSlug);
	const entity = encodeURIComponent(entitySlug);
	return surface === 'public'
		? `/p/${universe}/preview/${entity}`
		: `/w/${universe}/preview/${entity}`;
}

/** The entity slug out of a rendered mention's own href (`/p/<universe>/<slug>` or
 * `/w/<universe>/e/<slug>`), which is where it already sits. Deliberately not a new
 * `data-` attribute on the anchor: `renderMarkdown`'s output stays byte for byte what it
 * was, so the editor's preview pane (#365) renders through an unchanged path and no
 * markup on `/p/**` changes shape because this feature exists. */
export function mentionSlugFromHref(href: string): string | null {
	const segments = href.split(/[?#]/, 1)[0]!.split('/');
	const last = segments[segments.length - 1];
	if (!last) return null;
	try {
		return decodeURIComponent(last);
	} catch {
		return null;
	}
}

function isPreviewData(value: unknown): value is MentionPreviewData {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.name === 'string' &&
		typeof candidate.type === 'string' &&
		typeof candidate.excerpt === 'string' &&
		(candidate.status === 'full' || candidate.status === 'gap') &&
		(candidate.coverId === undefined || typeof candidate.coverId === 'string')
	);
}

export type MentionPreviewLoader = (
	surface: MentionSurface,
	universeSlug: string,
	entitySlug: string
) => Promise<MentionPreviewData | null>;

/**
 * A loader with its own cache, one per prose component rather than one per module: an entry
 * the GM has just edited must not preview its old opening the next time a mention of it is
 * hovered somewhere else in the app, and a component-scoped cache expires on navigation
 * while still collapsing a reader's repeated hovers over the same name into one request.
 *
 * `null` means "no preview", and it is deliberately the only failure this reports. A 404 on
 * the players' surface is what a `gm_only` entity, a deleted entity and an entity that never
 * existed all produce, indistinguishably (the endpoint's own doing), and the card simply
 * never opens - the same nothing a name that was never an entry gets.
 */
export function createMentionPreviewLoader(fetcher: typeof fetch = fetch): MentionPreviewLoader {
	const cache = new Map<string, Promise<MentionPreviewData | null>>();
	return (surface, universeSlug, entitySlug) => {
		const key = `${surface}\u0000${universeSlug}\u0000${entitySlug}`;
		const hit = cache.get(key);
		if (hit) return hit;
		const pending = (async () => {
			try {
				const response = await fetcher(mentionPreviewPath(surface, universeSlug, entitySlug), {
					headers: { accept: 'application/json' }
				});
				if (!response.ok) return null;
				const payload: unknown = await response.json();
				return isPreviewData(payload) ? payload : null;
			} catch {
				return null;
			}
		})();
		cache.set(key, pending);
		return pending;
	};
}
