/**
 * `/u/[universe]`: the universe home, showing recent entries per the contract this
 * route owns. Reuses `current` from the layout's own load (`await parent()`) rather
 * than re-querying it, and runs its own, fuller recent-entries query for the main
 * content area, separate in shape from the sidebar's short list (more rows, plus an
 * excerpt).
 */
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

const HOME_RECENT_LIMIT = 10;
const EXCERPT_LENGTH = 160;

function excerpt(body: string): string {
	const firstParagraph = (body.split('\n\n')[0] ?? '').trim();
	return firstParagraph.length > EXCERPT_LENGTH
		? `${firstParagraph.slice(0, EXCERPT_LENGTH)}…`
		: firstParagraph;
}

export const load: PageServerLoad = async ({ parent }) => {
	const { current } = await parent();
	const database = db();

	const rows = await database.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, current.id),
		orderBy: (entity, { desc }) => desc(entity.updatedAt),
		limit: HOME_RECENT_LIMIT,
		columns: { id: true, name: true, slug: true, type: true, body: true, updatedAt: true }
	});

	return {
		recentEntries: rows.map((row) => ({
			id: row.id,
			name: row.name,
			slug: row.slug,
			type: row.type,
			updatedAt: row.updatedAt,
			excerpt: excerpt(row.body)
		}))
	};
};
