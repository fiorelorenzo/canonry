/**
 * Issue #285 (decision O3): "open in Ask" is G5's expand in place, and what makes it an
 * expansion rather than a second question is that the answer already streamed travels with
 * it. This is that carrier: the panel puts a snapshot here, navigates, and the Ask route
 * takes it on mount instead of asking again. One live model call, not two, and the same
 * sentences the GM was already reading.
 *
 * Deliberately one-shot and in memory. `take()` empties it, exactly as the route already
 * consumes `?q=` and strips it with `replaceState`, so a later visit to Ask never reopens
 * an answer somebody walked away from. Nothing here is persistence: keep is the only write
 * (O3), and everything typed and abandoned stays abandoned when the tab closes.
 */
import type { AskDetailLevel, AskProposalEvent, AskProposalFailure, AskSource } from './stream';

export interface AskHandoff {
	question: string;
	detailLevel: AskDetailLevel;
	answer: string;
	sources: AskSource[];
	followUps: string[];
	proposals: AskProposalEvent[];
	proposalFailures: AskProposalFailure[];
	/** As the `done` event reported it: `false` means writing is off for this universe and
	 * the answer is the GM's own canon quoted back, which the route says out loud. */
	generated: boolean | null;
	/** Guardrail 5: the company that wrote this text, as the server named it. Carried
	 * rather than re-derived, because the route would otherwise have to ask the server who
	 * answered a question it never sent. */
	provider: string | null;
	/** The record's id when this answer was already kept from the panel, so the route shows
	 * it as kept rather than offering to write a second row for the same answer. */
	keptId: string | null;
}

/** The rune-module pattern `palette-state.svelte.ts` documents: an object mutated in
 * place, so an importer's reads stay reactive across the module boundary. */
const state = $state<{ pending: AskHandoff | null }>({ pending: null });

export const askHandoff = {
	put(handoff: AskHandoff): void {
		state.pending = handoff;
	},
	/** Returns the pending handoff and clears it, so a second reader gets nothing. */
	take(): AskHandoff | null {
		const pending = state.pending;
		state.pending = null;
		return pending;
	}
};
