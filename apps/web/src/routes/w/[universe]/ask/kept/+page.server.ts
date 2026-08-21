/**
 * Issue #290, decision O3, repealed by issue #437, decision T10 (round fifteen): every
 * turn is kept automatically now, so a row exists here because a question was asked, not
 * because somebody pressed keep. What this route still owns is the read and the delete -
 * grouped by conversation (`listKeptConversations`), because a reader of a conversation
 * wants the conversation rather than a pile of loose answers it happened to produce, and
 * deleting one now discards a whole conversation (`deleteKeptConversation`) rather than a
 * single cherry-picked turn, which is the granularity #437 actually asks for.
 *
 * Deletion is still a two-step through `?confirm=<conversationId>` rather than a JS
 * dialog, so it works with scripting off: the first click is a link that renders the
 * confirm pair for one conversation, the second is the form post below. Deleting is
 * permanent and the standing sentence on the page says so, because there is nothing to
 * undo it with.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { deleteKeptConversation, listKeptConversations, universeAccessBySlug } from '@canonry/db';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const conversations = await listKeptConversations(conn, {
		universeId: access.universe.id,
		keptBy: locals.user.id
	});

	return {
		// Dates cross to the client as strings anyway; formatted here so the list has one
		// rendering of a timestamp rather than one per locale in a component.
		conversations: conversations.map((conversation) => ({
			conversationId: conversation.conversationId,
			keptAt: conversation.keptAt.toISOString(),
			turns: conversation.turns.map((turn) => ({ ...turn, keptAt: turn.keptAt.toISOString() }))
		})),
		confirmingId: url.searchParams.get('confirm')
	};
};

export const actions: Actions = {
	deleteConversation: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `no universe called "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `no universe called "${params.universe}"`);
		const t = messages(locals.locale).universe.ask.kept;

		const form = await request.formData();
		const conversationId = form.get('conversationId');
		if (typeof conversationId !== 'string' || conversationId.length === 0) {
			return fail(400, { message: t.deleteFailed });
		}

		const removed = await deleteKeptConversation(conn, {
			conversationId,
			universeId: access.universe.id,
			keptBy: locals.user.id
		});
		if (!removed) return fail(404, { message: t.deleteNotFound });

		// Back to the clean list, so a reload never re-posts the delete and the `?confirm=`
		// param never outlives the conversation it pointed at.
		redirect(303, `/w/${params.universe}/ask/kept`);
	}
};
