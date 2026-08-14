/**
 * `/u/[universe]/works`: issue #20's index, decision B5 = A. Lists every work in the
 * universe and lets a GM start a new one; opening a work moves on to its own tree at
 * `/works/[work]`.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { createWork, listWorksForUniverse, universeAccessBySlug } from '@canonry/db';
import type { WorkType } from '@canonry/db/schema';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const WORK_TYPES: WorkType[] = ['oneshot', 'module', 'campaign', 'story', 'novel'];

function isWorkType(value: FormDataEntryValue | null): value is WorkType {
	return typeof value === 'string' && (WORK_TYPES as string[]).includes(value);
}

export const load: PageServerLoad = async ({ parent }) => {
	const { current } = await parent();
	const works = await listWorksForUniverse(db(), current.id);
	return {
		works: works.map((work) => ({
			id: work.id,
			type: work.type,
			status: work.status,
			name: work.name,
			slug: work.slug,
			summary: work.summary
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `No universe named "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `No universe named "${params.universe}"`);
		if (access.role === 'viewer') error(403, 'Viewers cannot create a work');

		const form = await request.formData();
		const name = form.get('name');
		const type = form.get('type');
		const summary = form.get('summary');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, { message: 'A work needs a name' });
		}
		if (!isWorkType(type)) {
			return fail(400, { message: 'Pick a work type' });
		}

		const work = await createWork(conn, {
			universeId: access.universe.id,
			type,
			name: name.trim(),
			summary: typeof summary === 'string' ? summary.trim() : undefined
		});

		redirect(303, `/u/${params.universe}/works/${work.slug}`);
	}
};
