/**
 * The players' half of the mention preview (#364), and the dangerous half of the issue.
 *
 * A preview is a second way to read an entry, so this endpoint reads it through the exact
 * same functions `/p/[universe]/[slug]` does: `loadPublicUniverse` for the universe and
 * `loadPublicEntity` for the entry, which is where `publicEntityBySlug`'s unconditional
 * `visibility != 'gm_only'` and its confirmed-revelation join already live, and where
 * `stripSecretsForPlayers` already ran. There is no query in this file. That is the point:
 * a second query written to be "the cheap one for a tooltip" is precisely how the two
 * would drift, and the drift would be invisible, because nobody audits a hover.
 *
 * It costs more than a bespoke select would - `loadPublicEntity` also fetches the revealed
 * facts, relations and published images this card throws away - and that is the trade taken
 * on purpose. A preview fires once per mention a reader actually points at, so the extra
 * reads are a handful of indexed lookups on a first hover, and the alternative buys a few
 * milliseconds with a copy of the filter.
 *
 * Guardrail 6 in three places:
 *
 * - A `gm_only` entity, a deleted entity and a name that never existed all leave here as the
 *   same 404 with the same message, so the response carries no signal that the entry exists.
 *   On the page above them a `gm_only` mention never renders as a link at all, so the card
 *   has nothing to attach to either way; this is the layer under that one.
 * - A revealable entity with no confirmed revelation answers with E7's gap shape, name and
 *   type and nothing else, which is exactly what its own page shows.
 * - The excerpt is `mentionPreviewExcerpt`, so it is `stripSecretsForPlayers`'s output, run
 *   over a body that had already been through it. Belt and braces on the one thing #355 is
 *   open about: a quoted slice that still carries what a GM fenced off.
 */
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { mentionPreviewExcerpt } from '$lib/markdown';
import type { MentionPreviewData } from '$lib/mentionPreview';
import { loadPublicEntity, loadPublicUniverse } from '$lib/server/players';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const conn = db();
	const universe = await loadPublicUniverse(conn, params.universe);
	if (!universe) error(404, `No entry named "${params.slug}"`);

	const found = await loadPublicEntity(conn, universe.id, universe.slug, params.slug);
	if (!found) error(404, `No entry named "${params.slug}"`);

	const { entity } = found;
	if (entity.status === 'gap') {
		return json({
			name: entity.name,
			type: entity.type,
			status: 'gap',
			excerpt: ''
		} satisfies MentionPreviewData);
	}

	return json({
		name: entity.name,
		type: entity.type,
		status: 'full',
		excerpt: mentionPreviewExcerpt(entity.body)
	} satisfies MentionPreviewData);
};
