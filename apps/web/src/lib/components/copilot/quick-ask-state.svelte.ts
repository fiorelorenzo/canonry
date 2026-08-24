/**
 * Issue #285 (decision O3), amended by decision R5 (round thirteen, #381): the floating
 * panel's open flag and its conversation live outside the component, for the same reason
 * `palette-state.svelte.ts` keeps the palette's own state outside it - the phone's bottom
 * bar is the launcher below `md` (E4 = A, I10 = B), and it opens the panel without
 * AppShell threading a callback down through PhoneNav.
 *
 * R5 repeals half of O3. Before it, a navigation closed the panel: `close()` called
 * `reset()`, and an effect on `page.url.pathname` called `close()` again on every route
 * change, on the reasoning that a panel left open would be "talking about somewhere
 * else". R5's own words: it is not talking about somewhere else, "it is talking about
 * what I asked, which does not stop being true because I clicked a source chip." So the
 * conversation moves here, beside the flag it already shared a module with, and a
 * navigation now changes neither. What does not change is the write: `QuickAsk.svelte`'s
 * `close()` is still the only thing that clears `turns`, and nothing here is ever put in
 * `sessionStorage` or sent anywhere except through `keepAnswer` (guardrail 1) - the same
 * "closing throws it away" contract O3 always had, just no longer triggered by a
 * navigation.
 *
 * Issue #437, decision T10 repeals the other half of O3: every turn is kept
 * automatically now, not only the one somebody clicked keep on, so `close()`'s own reset
 * throws away nothing that is not already a row in `kept_answer` - `turns` here is a
 * local, disposable view of the conversation, not its only copy. `conversationId` is what
 * ties those rows back into the conversation they were actually asked in: fresh whenever
 * `turns` goes back to empty (`reset()`, in `QuickAsk.svelte`, on the same schedule it
 * always cleared `turns` on), so every turn asked between one open panel and the next
 * shares it, and a turn asked after a close does not.
 *
 * The rune-module pattern: the export is an object mutated in place, so every importer's
 * reads stay reactive across the module boundary.
 */
import type { AskDone, AskProposalEvent, AskProposalFailure, AskSource } from '$lib/ask/stream';

/** One question and its answer, in flight or settled - the same bag of fields a single
 * top-level `QuickAsk.svelte` question used to keep, one instance per turn instead of one
 * for the whole panel. */
export interface QuickAskTurn {
	id: string;
	question: string;
	asking: boolean;
	answer: string;
	sources: AskSource[];
	/** #346: whether the `sources` event has arrived yet, which is the only thing that
	 * tells an empty list apart from a list not sent yet. */
	sourcesSeen: boolean;
	followUps: string[];
	proposals: AskProposalEvent[];
	proposalFailures: AskProposalFailure[];
	askError: string | null;
	generated: boolean | null;
	/** issue #678: what the turn could not finish, from the `done` event - `null` both
	 * before that event arrives and on a turn that finished, which is why nothing reads it
	 * to decide whether the turn is still in flight (`asking` is that flag). */
	loss: AskDone['loss'];
	keeping: boolean;
	keptId: string | null;
	keepError: string | null;
}

export const quickAskState = $state({
	open: false,
	turns: [] as QuickAskTurn[],
	conversationId: crypto.randomUUID(),
	/** Issue #531, W3 = B: the global command palette's own typed-question row sets
	 * this and opens the panel rather than linking to `/ask?q=...`, which stopped
	 * answering questions once that page's own composer was deleted - the palette
	 * launches the flow (C8), and the flow is this panel's now. `QuickAsk.svelte`'s own
	 * effect is the only reader, and clears it back to `null` the moment it acts on it. */
	pendingQuestion: null as string | null
});
