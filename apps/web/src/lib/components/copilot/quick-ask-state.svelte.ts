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
 * The rune-module pattern: the export is an object mutated in place, so every importer's
 * reads stay reactive across the module boundary.
 */
import type { AskProposalEvent, AskProposalFailure, AskSource } from '$lib/ask/stream';

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
	provider: string | null;
	keeping: boolean;
	keptId: string | null;
	keepError: string | null;
}

export const quickAskState = $state({ open: false, turns: [] as QuickAskTurn[] });
