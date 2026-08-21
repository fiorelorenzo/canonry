/**
 * Issue #455, decision U11: the Ask page becomes a conversation, and both the fresh one a
 * GM is asking right now and one reopened from `ask/kept` or from the dock's "open in Ask"
 * render through the same shape. `ConversationTurn` is that shape - normalized away from
 * the two places a turn's data can come from (a live `AskSource`/`AskProposalEvent`
 * stream, or a `KeptAnswerRecord` loaded from the database and mapped server-side in
 * `[conversationId]/+page.server.ts`) so `AskConversation.svelte` never has to branch on
 * where a turn came from.
 */
import type { AskHistoryTurn, AskProposalEvent, AskProposalFailure, AskSource } from './stream';

/** A citation, normalized. `entity`/`attribution`/`licence` are the parts a live turn's
 * `AskSource` and a loaded turn's `KeptAnswerSourceRecord` disagree on the shape of;
 * everything else already lines up. `entity: null` on an `own_canon` source is only ever
 * possible for a loaded turn - live retrieval never returns an entity that does not
 * currently exist - and means the entry has since been deleted; the citation stays, with
 * its snapshotted statement, rather than silently shortening the source list. */
export type TurnSource =
	| {
			kind: 'own_canon';
			entity: { id: string; name: string; slug: string } | null;
			statement: string;
	  }
	| {
			kind: 'indexed';
			pageTitle: string;
			url: string;
			statement: string;
			attribution: string | null;
			licence: string | null;
	  };

export interface ConversationTurn {
	id: string;
	question: string;
	/** True only while a fresh turn (asked on this page, this session) is still
	 * streaming. Always false for a turn loaded from the database - it already finished,
	 * or it would not be a row. */
	asking: boolean;
	answer: string;
	sources: TurnSource[];
	/** Whether the `sources` event has arrived - or, for a loaded turn, always true, since
	 * the database only ever holds the finished shape. Distinguishes "no sources yet" from
	 * "retrieval found nothing", the reason `stream.ts`'s own callers already track it. */
	sourcesSeen: boolean;
	followUps: string[];
	proposals: AskProposalEvent[];
	proposalFailures: AskProposalFailure[];
	askError: string | null;
	/** Whether a model wrote this turn's answer - `false` means writing was off for the
	 * universe and the answer is the GM's own canon quoted back (guardrail 4). `null` only
	 * while a fresh turn is still streaming, before its `done` event arrives. */
	generated: boolean | null;
	keepError: string | null;
}

/** Maps one event of a live SSE stream's `sources` payload onto the normalized shape
 * above. The DB-loaded half of this mapping (`KeptAnswerSourceRecord` -> `TurnSource`)
 * lives in `[conversationId]/+page.server.ts`, which is the one place allowed to import
 * `@canonry/db`'s value exports. */
export function liveSourceToTurnSource(source: AskSource): TurnSource {
	if (source.kind === 'own_canon') {
		return {
			kind: 'own_canon',
			entity: { id: source.entityId, name: source.entityName, slug: source.entitySlug },
			statement: source.statement
		};
	}
	return {
		kind: 'indexed',
		pageTitle: source.pageTitle,
		url: source.url,
		statement: source.text,
		attribution: source.attribution,
		licence: source.licence
	};
}

/** issue #380: oldest first, the last six entries (three prior turns, question and
 * answer) - the same arithmetic `QuickAsk.svelte`'s own `buildHistory` uses. Kept as a
 * separate, small implementation there and here rather than shared, because the two
 * callers close over two different turn shapes (`QuickAskTurn`, `ConversationTurn`) and a
 * shared function would cost more in indirection than the six lines it would save. */
export function buildAskHistory(precedingTurns: readonly ConversationTurn[]): AskHistoryTurn[] {
	const entries: AskHistoryTurn[] = [];
	for (const turn of precedingTurns) {
		entries.push({ role: 'gm', text: turn.question });
		if (turn.answer.length > 0) entries.push({ role: 'loremaster', text: turn.answer });
	}
	return entries.slice(-6);
}
