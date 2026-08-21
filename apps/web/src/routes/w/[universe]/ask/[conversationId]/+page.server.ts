/**
 * Issue #455, decision U11: a conversation, loaded by id and rendered as one - the route
 * the dock's "open in Ask" now navigates straight to, that `ask/kept`'s index links each
 * of its cards into, and that a reload or a shared link reopens exactly as it was left,
 * because #446 already kept every turn with a conversation id (`kept_answer.conversation
 * _id`). 404s on a wrong id and on somebody else's conversation identically, the same
 * "a probe cannot tell them apart" shape `getKeptConversation` itself documents.
 *
 * The one place allowed to import `@canonry/db`'s value exports for this feature: the
 * mapping from a `KeptAnswerRecord`'s resolved sources onto `ConversationTurn`/
 * `TurnSource` (`$lib/ask/conversation.ts`, universe-safe, no db import of its own)
 * happens here, so the client component never has to know the database's own shape.
 */
import { error } from '@sveltejs/kit';
import {
	getKeptConversation,
	universeAccessBySlug,
	type KeptAnswerRecord,
	type KeptAnswerSourceRecord
} from '@canonry/db';
import { db } from '$lib/server/db';
import type { ConversationTurn, TurnSource } from '$lib/ask/conversation';
import type { PageServerLoad } from './$types';

function turnSourceFromRecord(record: KeptAnswerSourceRecord): TurnSource {
	if (record.kind === 'own_canon') {
		return {
			kind: 'own_canon',
			entity: record.entity
				? { id: record.entity.id, name: record.entity.name, slug: record.entity.slug }
				: null,
			statement: record.statement
		};
	}
	return {
		kind: 'indexed',
		// The check constraint on `kept_answer_source` guarantees these two are non-null
		// for an `indexed` row - see that table's own comment in `packages/db/src/schema
		// /ask.ts`.
		pageTitle: record.pageTitle!,
		url: record.url!,
		statement: record.statement,
		attribution: record.dataSource?.attribution ?? null,
		licence: record.dataSource?.licence ?? null
	};
}

function turnFromRecord(record: KeptAnswerRecord): ConversationTurn {
	return {
		id: record.id,
		question: record.question,
		asking: false,
		answer: record.answer,
		sources: record.sources.map(turnSourceFromRecord),
		sourcesSeen: true,
		followUps: [],
		// Neither is persisted: a drafted proposal only ever renders live, during the
		// session that streamed it (`AskConversation.svelte`'s own comment on
		// `ConversationTurn`).
		proposals: [],
		proposalFailures: [],
		askError: null,
		// `provider`/`modelId` are both null exactly when `runAsk`'s reading-only branch
		// answered - the same signal `generated: false` is elsewhere on this feature.
		generated: record.provider !== null,
		keepError: null
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
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

	return {
		conversationId: conversation.conversationId,
		turns: conversation.turns.map(turnFromRecord)
	};
};
