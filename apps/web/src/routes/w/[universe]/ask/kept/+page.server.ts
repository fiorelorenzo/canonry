/**
 * Issue #290, decision O3, repealed by issue #437 (T10) and reshaped again by issue #455
 * (U11): every turn is kept automatically, so a row exists here because a question was
 * asked, not because somebody pressed keep, and this page is the conversation index now
 * rather than a second place a conversation renders in full - `/w/[universe]/ask/
 * [conversationId]` is where a turn's question, answer and sources actually live. What
 * this route still owns is the read and the delete - grouped by conversation
 * (`listKeptConversations`), and deleting one discards a whole conversation
 * (`deleteKeptConversation`) rather than a single cherry-picked turn.
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
		// Issue #455: a card here needs the first question, a turn count and a timestamp -
		// not every turn's own answer and sources, which the conversation route renders now
		// and which SvelteKit would otherwise still serialize to the client whether this
		// page's own template reads it or not.
		conversations: conversations.map((conversation) => ({
			conversationId: conversation.conversationId,
			keptAt: conversation.keptAt.toISOString(),
			firstQuestion: conversation.turns[0]!.question,
			turnCount: conversation.turns.length
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
