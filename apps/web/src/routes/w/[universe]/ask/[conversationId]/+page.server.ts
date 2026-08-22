/**
 * Issue #531, W3 = B (DECISIONS.md "Round eighteen"): one conversation's own record - the
 * same rows `/w/[universe]/ask` renders, filtered to this conversation, deep linkable.
 * The dock's "open in Ask" (`QuickAsk.svelte`) navigates straight here rather than
 * to the bare `/ask` route, carrying `?turn=<keptAnswerId>` so the turn it was opened
 * from starts expanded and scrolled to (`AskAnswerRow.svelte`'s own `highlighted` prop) -
 * resolved server-side here rather than only client-side, so a no-JS visitor still lands
 * on an already-open row rather than a collapsed one they cannot script open.
 *
 * 404s on a wrong id and on somebody else's conversation identically, the same "a probe
 * cannot tell them apart" shape `getKeptConversation` itself documents.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { deleteKeptConversation, getKeptConversation, universeAccessBySlug } from '@canonry/db';
import { db } from '$lib/server/db';
import { messages } from '$lib/i18n';
import { toAskConversationView } from '$lib/ask/history';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const conversation = await getKeptConversation(conn, {
		conversationId: params.conversationId,
		universeId: access.universe.id,
		keptBy: locals.user.id
	});
	if (!conversation) error(404, `no conversation called "${params.conversationId}"`);

	const confirmingId = url.searchParams.get('confirm');

	return {
		conversation: toAskConversationView(conversation),
		highlightTurnId: url.searchParams.get('turn'),
		confirmingId,
		confirmingTurnCount:
			confirmingId === conversation.conversationId ? conversation.turns.length : null
	};
};

export const actions: Actions = {
	deleteConversation: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `no universe called "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `no universe called "${params.universe}"`);
		const t = messages(locals.locale).universe.ask.history;

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

		// The conversation this page was showing is gone - back to the record as a whole.
		redirect(303, `/w/${params.universe}/ask`);
	}
};
