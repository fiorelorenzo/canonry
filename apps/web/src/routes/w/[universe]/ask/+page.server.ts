/**
 * Issue #531, W3 = B (DECISIONS.md "Round eighteen"): reverses U11. The dock is where a
 * GM asks now (`QuickAsk.svelte`); this page is the searchable record of what was asked
 * and what came back - a search field over `kept_answer.question`/`.answer` (a free
 * substring match, `listKeptConversations`'s own `query` param), one row per answer
 * grouped by conversation past one turn, and a delete that names what it removes.
 *
 * `/ask/kept` used to be a second list of this same data (issue #437/#455); it now
 * redirects here (`kept/+page.server.ts`) rather than rendering anything of its own.
 * `/ask/[conversationId]` reuses the same `listKeptConversations`/`AskConversationGroup`
 * shape, scoped to one conversation - see that route's own `+page.server.ts`.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import {
	deleteKeptConversation,
	getKeptConversation,
	listKeptConversations,
	universeAccessBySlug
} from '@canonry/db';
import { db } from '$lib/server/db';
import { messages } from '$lib/i18n';
import { toAskConversationView } from '$lib/ask/history';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const query = url.searchParams.get('q')?.trim() ?? '';
	const conversations = await listKeptConversations(conn, {
		universeId: access.universe.id,
		keptBy: locals.user.id,
		query: query.length > 0 ? query : undefined
	});

	// The delete-confirm prompt "says what goes" against the conversation's own true
	// turn count, not however many rows a live search leaves visible - a second, small
	// lookup, unfiltered by `query`, only when a confirm is actually showing.
	const confirmingId = url.searchParams.get('confirm');
	let confirmingTurnCount: number | null = null;
	if (confirmingId) {
		const full = await getKeptConversation(conn, {
			conversationId: confirmingId,
			universeId: access.universe.id,
			keptBy: locals.user.id
		});
		confirmingTurnCount = full?.turns.length ?? null;
	}

	return {
		query,
		matchedCount: conversations.reduce((total, c) => total + c.turns.length, 0),
		conversations: conversations.map(toAskConversationView),
		confirmingId,
		confirmingTurnCount
	};
};

export const actions: Actions = {
	deleteConversation: async ({ request, params, locals, url }) => {
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

		// Back to the clean list - a reload never re-posts the delete, and a live search
		// survives the round trip since a deleted result should not also lose the query
		// that found it.
		const query = url.searchParams.get('q');
		redirect(303, `/w/${params.universe}/ask${query ? `?q=${encodeURIComponent(query)}` : ''}`);
	}
};
