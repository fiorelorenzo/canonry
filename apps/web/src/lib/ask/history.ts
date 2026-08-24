/**
 * Issue #531, W3 = B (DECISIONS.md "Round eighteen"): the record `/w/[universe]/ask` and
 * `/w/[universe]/ask/[conversationId]` render now - every turn comes from `kept_answer`
 * (nothing is ever live on these routes any more, so there is only one turn shape to map,
 * unlike the old `ConversationTurn`/`TurnSource` union `lib/ask/conversation.ts` needed to
 * reconcile a live SSE turn with a loaded one). Universe-safe: only `@canonry/db`'s types
 * are imported here, never its value exports - `+page.server.ts` in each of the two routes
 * above is where the database is actually read.
 */
import type { KeptAnswerRecord, KeptAnswerSourceRecord, KeptConversation } from '@canonry/db';

export type AskSourceView =
	| { kind: 'own_canon'; entity: { name: string; slug: string } | null; statement: string }
	| {
			kind: 'indexed';
			pageTitle: string;
			url: string;
			statement: string;
			attribution: string | null;
			licence: string | null;
	  };

export interface AskRowView {
	id: string;
	question: string;
	answer: string;
	/** The row's own collapsed preview: the real first line of `answer`, not a
	 * character-count truncation - a multi-paragraph answer's first line stands in for
	 * it, and a one-paragraph answer is truncated visually by the row's own `truncate`
	 * class rather than cut here. */
	preview: string;
	keptAt: string;
	/** False when generation was off for the universe and the answer is the GM's own
	 * canon quoted back (guardrail 4) - mirrors `turn.generated === false` everywhere
	 * else Ask renders this warning. */
	generated: boolean;
	/** Issue #699: what the turn that produced this answer could not finish, or `null` when
	 * there is nothing to say - either because the turn finished or because the row predates
	 * the columns and "we do not know" is the honest answer. Rendered from the same
	 * `universe.ask.truncated.*` keys the dock renders (#696), so the live turn and the record
	 * cannot drift into two vocabularies for one fact.
	 *
	 * A finished turn collapses to `null` here rather than staying `{ truncated: false,
	 * lostProposals: 0 }`: the record keeps that distinction because it is worth being able to
	 * query, and the surface does not, because there is no line to paint for it. */
	loss: { truncated: boolean; lostProposals: number } | null;
	sources: AskSourceView[];
}

export interface AskConversationView {
	conversationId: string;
	keptAt: string;
	turns: AskRowView[];
}

function firstLine(answer: string): string {
	const line = answer.split('\n')[0]?.trim() ?? '';
	return line.length > 0 ? line : answer.trim();
}

function toAskSourceView(source: KeptAnswerSourceRecord): AskSourceView {
	if (source.kind === 'own_canon') {
		return {
			kind: 'own_canon',
			entity: source.entity ? { name: source.entity.name, slug: source.entity.slug } : null,
			statement: source.statement
		};
	}
	// The check constraint on `kept_answer_source` guarantees these two are non-null for
	// an `indexed` row - see that table's own comment in `packages/db/src/schema/ask.ts`.
	return {
		kind: 'indexed',
		pageTitle: source.pageTitle!,
		url: source.url!,
		statement: source.statement,
		attribution: source.dataSource?.attribution ?? null,
		licence: source.dataSource?.licence ?? null
	};
}

export function toAskRowView(turn: KeptAnswerRecord): AskRowView {
	return {
		id: turn.id,
		question: turn.question,
		answer: turn.answer,
		preview: firstLine(turn.answer),
		keptAt: turn.keptAt.toISOString(),
		generated: turn.provider !== null,
		// Nothing to show for a turn that finished, and nothing to show for a row that cannot
		// say - a caveat invented for either would be the over-claiming half of guardrail 7.
		loss: turn.loss && (turn.loss.truncated || turn.loss.lostProposals > 0) ? turn.loss : null,
		sources: turn.sources.map(toAskSourceView)
	};
}

export function toAskConversationView(conversation: KeptConversation): AskConversationView {
	return {
		conversationId: conversation.conversationId,
		keptAt: conversation.keptAt.toISOString(),
		turns: conversation.turns.map(toAskRowView)
	};
}
