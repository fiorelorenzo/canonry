/**
 * The GM half of the mention preview (#364): the card a `[[Mention]]` opens on hover or on
 * focus inside `/w/**` prose. Gated exactly like every other route under this universe, by
 * session plus membership, and 404ing with the same message whether the universe is somebody
 * else's or the slug is nobody's.
 *
 * No visibility filter here, deliberately, and that is the difference between this file and
 * its `/p/**` twin: a GM with access reads `gm_only` entries on the page already, so hiding
 * one from a preview would only make the preview lie about the wiki it sits in. What this
 * does share with the public endpoint is the excerpt: `mentionPreviewExcerpt` runs
 * `stripSecretsForPlayers` on both surfaces, so a fenced sentence never reaches a floating
 * card even here. See that function's own comment for why the GM side strips too.
 */
import { error, json } from '@sveltejs/kit';
import { universeAccessBySlug } from '@canonry/db';
import { db } from '$lib/server/db';
import { mentionPreviewExcerpt } from '$lib/markdown';
import type { MentionPreviewData } from '$lib/mentionPreview';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const row = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, access.universe.id), eq(entity.slug, params.slug)),
		columns: { name: true, type: true, body: true }
	});
	if (!row) error(404, `no entry named "${params.slug}"`);

	return json({
		name: row.name,
		type: row.type,
		// Never `'gap'`: a revelation is something players do or do not have, and on this
		// surface there is no such thing. An entry with nothing written in it comes back with
		// an empty excerpt and the card says so.
		status: 'full',
		excerpt: mentionPreviewExcerpt(row.body)
	} satisfies MentionPreviewData);
};
