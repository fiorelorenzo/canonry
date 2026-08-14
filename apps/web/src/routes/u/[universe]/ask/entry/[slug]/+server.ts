/**
 * G5's side panel needs "the real entry, not a stripped preview of it" (issue #60's
 * locked-in bar). A small JSON read, gated the same way every route under this universe
 * is, so a source click can open the panel without a full page navigation away from the
 * answer it sits beside.
 */
import { error, json } from '@sveltejs/kit';
import { universeAccessBySlug } from '@canonry/db';
import { db } from '$lib/server/db';
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

	return json(row);
};
