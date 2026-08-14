/**
 * Shared by every page under `/works/[work]`: the work itself and its whole tree,
 * flattened pre-order (`workNodeTree`). Decision B5 = A's left pane reads straight off
 * this - the tree is small enough (SPEC.md §4.3's four levels) that loading it whole on
 * every page under a work is simpler than paginating it, and it is what "which scenes are
 * open" (the sidebar highlight) needs regardless of which node the page itself shows.
 */
import { error } from '@sveltejs/kit';
import { workBySlug, workNodeTree } from '@canonry/db';
import { db } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent, params }) => {
	const { current } = await parent();
	const conn = db();

	const work = await workBySlug(conn, current.id, params.work);
	if (!work) error(404, `No work named "${params.work}" in ${current.name}`);

	const tree = await workNodeTree(conn, work.id);

	return {
		work: {
			id: work.id,
			type: work.type,
			status: work.status,
			name: work.name,
			slug: work.slug,
			summary: work.summary
		},
		tree
	};
};
