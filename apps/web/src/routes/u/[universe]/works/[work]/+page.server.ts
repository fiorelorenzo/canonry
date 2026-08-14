/**
 * `/u/[universe]/works/[work]`: the empty state before any node exists yet, or once one
 * does, a prompt to open the tree on the left. Creating the first node here always adds
 * it at the root (`parentId: null`); a node's own page (`[node]/+page.server.ts`) is
 * where a child gets added under something that already exists.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { createWorkNode, universeAccessBySlug, workBySlug } from '@canonry/db';
import type { WorkNodeKind } from '@canonry/db/schema';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const WORK_NODE_KINDS: WorkNodeKind[] = ['act', 'chapter', 'scene', 'encounter'];

function isWorkNodeKind(value: FormDataEntryValue | null): value is WorkNodeKind {
	return typeof value === 'string' && (WORK_NODE_KINDS as string[]).includes(value);
}

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	createNode: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') error(403, 'Viewers cannot edit a work');

		const work = await workBySlug(conn, access.universe.id, params.work);
		if (!work) error(404, `No work named "${params.work}" in ${access.universe.name}`);

		const form = await request.formData();
		const title = form.get('title');
		const kind = form.get('kind');
		if (typeof title !== 'string' || title.trim().length === 0) {
			return fail(400, { message: 'A node needs a title' });
		}
		if (!isWorkNodeKind(kind)) {
			return fail(400, { message: 'Pick a node kind' });
		}

		const node = await createWorkNode(conn, {
			workId: work.id,
			parentId: null,
			kind,
			title: title.trim()
		});

		redirect(303, `/u/${params.universe}/works/${params.work}/${node.id}`);
	}
};
