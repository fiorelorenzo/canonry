/**
 * Issue #290, decision O3: the history the word "history" is now allowed to describe,
 * because a row is here only because somebody pressed keep. Reads this account's kept
 * answers in this universe and deletes one, and does nothing else: there is no accept, no
 * edit and no promote, which is guardrail 1 holding at the surface as well as in the schema.
 *
 * Deletion is a two-step through `?confirm=<id>` rather than a JS dialog, so it works with
 * scripting off: the first click is a link that renders the confirm pair for one row, the
 * second is the form post below. Deleting is permanent and the standing sentence on the page
 * says so, because there is nothing to undo it with.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { deleteKeptAnswer, listKeptAnswers, universeAccessBySlug } from '@canonry/db';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const answers = await listKeptAnswers(conn, {
		universeId: access.universe.id,
		keptBy: locals.user.id
	});

	return {
		// Dates cross to the client as strings anyway; formatted here so the list has one
		// rendering of a timestamp rather than one per locale in a component.
		answers: answers.map((answer) => ({
			...answer,
			keptAt: answer.keptAt.toISOString()
		})),
		confirmingId: url.searchParams.get('confirm')
	};
};

export const actions: Actions = {
	delete: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `no universe called "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `no universe called "${params.universe}"`);
		const t = messages(locals.locale).universe.ask.kept;

		const form = await request.formData();
		const id = form.get('id');
		if (typeof id !== 'string' || id.length === 0) return fail(400, { message: t.deleteFailed });

		const removed = await deleteKeptAnswer(conn, {
			id,
			universeId: access.universe.id,
			keptBy: locals.user.id
		});
		if (!removed) return fail(404, { message: t.deleteNotFound });

		// Back to the clean list, so a reload never re-posts the delete and the `?confirm=`
		// param never outlives the row it pointed at.
		redirect(303, `/w/${params.universe}/ask/kept`);
	}
};
