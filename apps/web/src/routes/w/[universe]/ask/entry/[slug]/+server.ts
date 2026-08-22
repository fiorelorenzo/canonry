/**
 * G5's side panel needs "the real entry, not a stripped preview of it" (issue #60's
 * locked-in bar) - the whole body, untruncated, never `mentionPreviewExcerpt`'s 200
 * characters. A small JSON read, gated the same way every route under this universe
 * is, so a source click can open the panel without a full page navigation away from the
 * answer it sits beside.
 *
 * Issue #531, W3 = B (DECISIONS.md "Round eighteen"): G5 is unamended by the reversal -
 * "G5's source panel stays what a source click opens" - so this endpoint keeps serving
 * both the record's own pages (`/ask`, `/ask/[conversationId]`) and, unchanged, the
 * dock never used it (`QuickAsk.svelte`'s own source chips have always linked straight
 * to the entry).
 *
 * #545: the panel prints `body` as plain text (`AskEntryPanel.svelte`'s
 * `whitespace-pre-wrap`), never through the markdown renderer, so `[[Name]]` and
 * `:::secret`/`:::gmnote` fence markers used to reach it raw - the same family of defect
 * as the source chip's quoted sentence, one door over. The GM opening this panel is the
 * same GM who owns the entry, so a secret's *content* stays (this is not guardrail 6);
 * what has to go is markup nobody typed to be read as prose. `splitSecretBlocks`
 * (`@canonry/lang`) drops only the `:::secret`/`:::gmnote`/`:::` marker lines, keeping
 * every word of the content on both sides of a fence, and `stripMentionSyntax` does the
 * same for `[[brackets]]`.
 */
import { error, json } from '@sveltejs/kit';
import { universeAccessBySlug } from '@canonry/db';
import { splitSecretBlocks } from '@canonry/lang';
import { db } from '$lib/server/db';
import { stripMentionSyntax } from '$lib/markdown';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const row = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, access.universe.id), eq(entity.slug, params.slug)),
		columns: { name: true, type: true, body: true, slug: true }
	});
	if (!row) error(404, `no entry named "${params.slug}"`);

	const body = stripMentionSyntax(
		splitSecretBlocks(row.body)
			.map((segment) => segment.text)
			.join('\n\n')
	);
	return json({ ...row, body });
};
