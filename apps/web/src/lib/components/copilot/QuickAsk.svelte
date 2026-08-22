<script lang="ts">
	/**
	 * Issue #285, decision O3 = A: a floating pill that expands in place. Ask had three
	 * doors and all three left the page; this is the fourth, and it is the only one that
	 * answers where the GM already is.
	 *
	 * Decisions R5 and R6, round thirteen (#381), reverse two of O3's own choices once it
	 * had actually been used:
	 *
	 * - **R5 repeals half of O3's "keep is the only write".** The open flag and the
	 *   conversation both moved into `quick-ask-state.svelte.ts` as an array of turns, so a
	 *   navigation changes neither - there is no longer an effect watching
	 *   `page.url.pathname`. The write itself is unchanged: `close()` is still the only
	 *   thing that throws the conversation away, and nothing here is ever persisted
	 *   (`sessionStorage`, a server record) outside of `keepAnswer` (guardrail 1). Because
	 *   navigating away from inside the panel - a source chip, an entry row in the
	 *   composer's own search - is exactly the case R5 is arguing for ("does not stop
	 *   being true because I clicked a source chip"), the docked composer below is no
	 *   longer given `onNavigate`: selecting a row navigates like any link and the panel
	 *   stays exactly as it was.
	 * - **R6 moves the launcher to the bottom centre and widens it**, with the shortcut
	 *   and a line naming what it can be asked, and adds three deterministic suggestion
	 *   chips (`quick-ask-suggestions.ts`) shown until the conversation has a turn.
	 *
	 * The amendments O3 itself still carries, and where each one lives in this file:
	 *
	 * - **The palette's own input, in a docked placement.** The composer is
	 *   `CommandPalette.svelte` with `placement="docked"`, not a second input: one
	 *   implementation in two positions, so #149's box and this one cannot drift. R6 pins
	 *   it to the bottom of the panel rather than the top, "the composer stays at the
	 *   bottom" - `CommandPalette.svelte` renders its own results above its own input in
	 *   this placement for exactly that reason.
	 * - **Hidden in table mode.** Enforced by AppShell, which does not mount this
	 *   component under `/w/[universe]/table` at all - E3 = C's two-tier dock already owns
	 *   that corner, and a launcher floating over it would be two docks in one screen. The
	 *   mod+shift+A binding lives here rather than in the palette for the same reason: on
	 *   the one surface the launcher hides, the chord is simply not bound, instead of
	 *   opening a panel nobody can see.
	 * - **A tab in the phone's bottom bar, not a circle over the content.** The launcher is
	 *   `hidden md:flex`; below `md` it is PhoneNav's third tab, which flips the same
	 *   `quickAskState`. The panel itself is full width above that bar.
	 * - **Every turn is kept, automatically.** T10 (#464) repealed "keep is the only
	 *   write": there is no keep control and no per-turn disclosure card left here, and
	 *   `ask/kept` is the record of everything asked rather than of what somebody chose.
	 * - **The theme's own colours, not the copilot's hue.** Paper, `--line`, `--ink` and
	 *   the umber accent for the launcher, the panel, the context chip and the input, in
	 *   both palettes (G1).
	 * - **The answer itself carries no mark (#414, S9, round fourteen).** It used to
	 *   render through `AiMarkedParagraph` with `proposed: true` - C1's dashed underline
	 *   plus the numbered margin marker reserved for AI wording nobody has accepted -
	 *   which was wrong here: an Ask answer is not proposed canon, it lives in no entry,
	 *   nothing about it can be accepted, and the number pointed at a sequence that did
	 *   not exist while the sources sat two lines below it. The Ask route never marked
	 *   its own copy of the same answer (`routes/w/[universe]/ask/+page.svelte`), which
	 *   is the precedent this follows. Attribution did not disappear, it moved: this
	 *   panel's own header and the standing disclosure above the turns already say a
	 *   copilot generated this, the job the marker used to do less directly.
	 *   **C1 is not repealed.** A proposal's own summary still wears the mark wherever it
	 *   is shown (`aiMarking.ts`, `EntryProseWithSecrets.svelte`, `/dev/ai-marking`),
	 *   because that text really can become canon. Do not touch `--color-diff-line` or
	 *   `AiMarkedParagraph` itself for this reason: round sixteen U10 (#454) put the mark
	 *   on that token after three rounds of the copilot's own hue being misused
	 *   elsewhere, and the complaint that opened #414 was about a surface that should
	 *   never have carried the mark at all, not about its colour.
	 * - **An icon closes the panel, not the word.** With its accessible name on
	 *   `aria-label`, so the control is still named for anything that is not looking at it.
	 *
	 * Guardrail 3: the sources ride along with each turn's answer as chips, each one opens
	 * the entry or the page it came from, and a turn that cited nothing says so
	 * (`sourcesEmpty`) instead of showing an empty row. Guardrail 5: the disclosure is the
	 * one standing line above the turns (T10), read before anything is asked, and it makes
	 * no claim about any particular answer - issue #354, because the per-turn sentence it
	 * replaced told a GM which provider "wrote the answer from your own canon" on answers
	 * that cited nothing. Nothing names a provider any more, on this surface or on the
	 * wire: issue #570 took the `done` event's `provider` and `modelId` out too, and the
	 * privacy page is where guardrail 5's own copy sends a GM who wants the name.
	 *
	 * Round eighteen, issue #531 (W3 = B), reverses U11: the Ask page stops being a
	 * second place to ask and becomes the searchable record of every kept turn, so it
	 * has no composer of its own left to sit C8's five levels beside. They move in
	 * here instead (`detailLevel` below, a `$state` rather than the fixed `normal`
	 * this file used to hardcode), and "open in Ask" now names the turn it opens, not
	 * only the conversation - see that function's own comment.
	 */
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import XIcon from '@lucide/svelte/icons/x';
	import CommandPalette from '$lib/components/palette/CommandPalette.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { InlineLink } from '$lib/components/ui/link';
	import { messages, type Locale } from '$lib/i18n';
	import { formatShortcut, matchesShortcut, SHORTCUTS } from '$lib/keys';
	import { ASK_DETAIL_LEVELS, keepAnswer, streamAsk, type AskDetailLevel } from '$lib/ask/stream';
	import type { UniverseSummary } from '$lib/components/shell/types';
	import {
		measureDockElement,
		shellLayoutState
	} from '$lib/components/shell/shell-layout-state.svelte';
	import { quickAskState, type QuickAskTurn } from './quick-ask-state.svelte';
	import { quickAskSuggestions } from './quick-ask-suggestions';

	let {
		universeSlug,
		universeName,
		universes,
		locale
	}: {
		universeSlug: string;
		universeName: string;
		universes: UniverseSummary[];
		locale: Locale;
	} = $props();

	const t = $derived(messages(locale).shell.quickAsk);
	const askT = $derived(messages(locale).universe.ask);

	// Non-null: `ask` is an entry in keys.ts's own SHORTCUTS table.
	const askShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'ask')!;

	/** Round eighteen (issue #531, W3 = B): mutable now that C8's five levels live in
	 * the composer's own band below, not fixed at `normal` the way this page used to
	 * force before "open in Ask" could hand the choice to the route instead. */
	let detailLevel = $state<AskDetailLevel>('normal');

	/** #380's contract: `streamAsk`'s request, extended with the previous turns and the
	 * page context. Declared locally rather than imported from `$lib/ask/stream` because
	 * this issue does not own that file - it grows this same shape under #380. Built as
	 * its own typed variable rather than an inline object literal below, so passing the
	 * two extra fields through `streamAsk`'s present signature is structural widening
	 * (TypeScript only checks excess properties on a literal assigned in place), not an
	 * error: once #380 lands, this call keeps compiling unchanged. */
	type AskHistoryEntry = { role: 'gm' | 'loremaster'; text: string };
	type AskRequestContext = { kind: 'entry' | 'world'; name: string; entityType?: string } | null;
	interface AskRequestArgs {
		universeSlug: string;
		question: string;
		detailLevel: AskDetailLevel;
		history?: AskHistoryEntry[];
		context?: AskRequestContext;
	}

	let pillEl = $state<HTMLButtonElement | null>(null);
	let scrollAreaEl = $state<HTMLDivElement | null>(null);
	let composerQuestion = $state('');

	/** Round eighteen: the launcher's own band, remembered, so opening the panel does not
	 * collapse the reserve `main` is holding.
	 *
	 * The panel no longer publishes a height (its own comment in the markup says why), and
	 * the launcher is unmounted while the panel is open, so `measureDockElement`'s teardown
	 * would zero `shellLayoutState.dockHeight` and every page would jump up by the
	 * launcher's height each time the panel opened and back down when it closed. The last
	 * measured launcher band is kept here and re-published for as long as the panel is
	 * open: the reserve stays exactly what it is with the panel shut, which is the only
	 * value that makes opening and closing it cost the page nothing. */
	let launcherReserve = $state(0);
	$effect(() => {
		if (quickAskState.open) shellLayoutState.dockHeight = launcherReserve;
	});

	/** Issue #455, decision U11: `openInAsk` navigates to the URL naming this turn's own
	 * conversation rather than handing an in-memory snapshot to the route (see that
	 * function's own comment for why). It has to know whether the specific turn it was
	 * asked to open is already a row before it navigates, or a fast click could land on a
	 * conversation one turn short of what the GM was just reading - this map is what lets
	 * it wait on that one write instead of the route racing it. Cleared in `reset()` along
	 * with everything else a closed panel forgets. Pure async bookkeeping, never read by
	 * the template, so it needs no reactivity of its own. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const keepPromises = new Map<string, Promise<void>>();

	/** The page's own entity, if this route has one: present on an entry route (and its
	 * `/edit` subroute, which carries the same `entity`), `null` everywhere else. The same
	 * narrowing the context line always used, unassertive because most routes carry no
	 * `entity` at all - see `AppShell.svelte`'s own doc comment on why `page.data` stays
	 * loosely typed. */
	const pageEntity = $derived.by((): { name: string; type: string } | null => {
		const entity: unknown = page.data.entity;
		if (
			entity &&
			typeof entity === 'object' &&
			'name' in entity &&
			typeof entity.name === 'string' &&
			'type' in entity &&
			typeof entity.type === 'string'
		) {
			return { name: entity.name, type: entity.type };
		}
		return null;
	});

	/** R5: "the context line follows the page" - reactive to `pageEntity`, so navigating
	 * while the panel stays open changes what this says without touching a single turn. */
	const contextName = $derived(pageEntity?.name ?? universeName);

	/** #380's contract: the entry's name and type, or the world's name - capped to that
	 * rather than the entry's body, "a prompt that grows without bound is a bill that
	 * grows without bound." */
	const askContext = $derived.by((): AskRequestContext =>
		pageEntity
			? { kind: 'entry', name: pageEntity.name, entityType: pageEntity.type }
			: { kind: 'world', name: universeName }
	);

	/** R6: three deterministic chips, picked from the route and the entity type, never
	 * from a model. Hidden once `quickAskState.turns` has anything in it. */
	const suggestions = $derived(
		quickAskSuggestions({ routeId: page.route.id, entity: pageEntity }, t.suggestions)
	);

	/** #380's contract, oldest first and capped at 6 entries (three prior turns, question
	 * and answer): "the last few turns... rather than the whole conversation". A turn that
	 * errored contributes only its question - there is no answer worth repeating back. */
	function buildHistory(precedingTurns: readonly QuickAskTurn[]): AskHistoryEntry[] {
		const entries: AskHistoryEntry[] = [];
		for (const turn of precedingTurns) {
			entries.push({ role: 'gm', text: turn.question });
			if (turn.answer.length > 0) entries.push({ role: 'loremaster', text: turn.answer });
		}
		return entries.slice(-6);
	}

	/** R5: closing is still the only thing that clears the panel's own local view - not
	 * the only write any more (T10 repeals that half of O3, #437): every turn already
	 * landed in `kept_answer` as it completed. What resetting still does is start the
	 * next conversation, which is why the id goes with it - a turn asked after this
	 * point must not group with the one that just closed. */
	function reset() {
		quickAskState.turns = [];
		quickAskState.conversationId = crypto.randomUUID();
		composerQuestion = '';
		detailLevel = 'normal';
		keepPromises.clear();
	}

	function open() {
		quickAskState.open = true;
	}

	/** Everything typed and abandoned stays abandoned (O3, unchanged by R5): closing
	 * throws the whole conversation away rather than parking it for the next opening. The
	 * launcher only exists again once the panel is gone, which is why the focus return
	 * waits for a flush: `bind:this` is null while the panel is what is mounted. */
	async function close() {
		quickAskState.open = false;
		reset();
		await tick();
		pillEl?.focus();
	}

	/** Issue #531, W3 = B: the global command palette's own typed-question row
	 * (`CommandPalette.svelte`, dialog placement) used to hand a question straight to
	 * the route at `/ask?q=...`, which answered it inline - the composer that used to
	 * live there is gone, so C8's "the palette launches the flow" now means launching
	 * this panel instead. The palette sets `quickAskState.pendingQuestion` and closes
	 * itself; this effect is the one place that reads it, so there is exactly one
	 * `ask()` call site regardless of which surface started it. */
	$effect(() => {
		const pending = quickAskState.pendingQuestion;
		if (pending === null) return;
		quickAskState.pendingQuestion = null;
		open();
		void ask(pending);
	});

	async function ask(nextQuestion: string) {
		const q = nextQuestion.trim();
		if (q.length === 0) return;
		// One turn in flight at a time: a second question mid-stream would race the first
		// turn's own fields.
		if (quickAskState.turns.some((turn) => turn.asking)) return;
		const precedingTurns = quickAskState.turns.slice();
		const askedDetailLevel = detailLevel;
		const turnId = crypto.randomUUID();
		quickAskState.turns.push({
			id: turnId,
			question: q,
			asking: true,
			answer: '',
			sources: [],
			sourcesSeen: false,
			followUps: [],
			proposals: [],
			proposalFailures: [],
			askError: null,
			generated: null,
			keeping: false,
			keptId: null,
			keepError: null
		});
		composerQuestion = '';
		/** Every mutation below goes through this rather than the object literal just
		 * pushed above: `$state` deep-proxies an object the moment it lands inside a
		 * reactive array, and that proxy is a different identity from the plain object
		 * that created it. Closing over the pre-push literal and writing to it directly
		 * would never reach the proxy the `{#each}` below actually reads, so the panel
		 * would show "streaming…" forever even once the request had finished - `find`
		 * always re-reads the live element. It also self-heals if the GM closes the panel
		 * mid-stream: `reset()` empties `turns`, the id stops matching anything, and a
		 * late event becomes a harmless no-op instead of writing into whatever now
		 * occupies the old index. */
		function liveTurn(): QuickAskTurn | undefined {
			return quickAskState.turns.find((candidate) => candidate.id === turnId);
		}
		const requestArgs: AskRequestArgs = {
			universeSlug,
			question: q,
			detailLevel: askedDetailLevel,
			history: buildHistory(precedingTurns),
			context: askContext
		};
		try {
			await streamAsk(requestArgs, {
				onSources: (list, follow) => {
					const turn = liveTurn();
					if (!turn) return;
					turn.sources = list;
					turn.sourcesSeen = true;
					turn.followUps = follow;
				},
				onToken: (delta) => {
					const turn = liveTurn();
					if (turn) turn.answer += delta;
				},
				onProposal: (proposal) => {
					const turn = liveTurn();
					if (turn) turn.proposals = [...turn.proposals, proposal];
				},
				onProposalFailure: (failure) => {
					const turn = liveTurn();
					if (turn) turn.proposalFailures = [...turn.proposalFailures, failure];
				},
				onDone: (done) => {
					const turn = liveTurn();
					if (!turn) return;
					turn.generated = done.generated;
				},
				onError: (message) => {
					const turn = liveTurn();
					if (turn) turn.askError = message;
				}
			});
		} catch {
			// A stream that never opened. An `error` event over a stream that did open
			// arrives through `onError` above, already in the reader's language.
			const turn = liveTurn();
			if (turn) turn.askError = askT.askFailed;
		} finally {
			const turn = liveTurn();
			if (turn) turn.asking = false;
		}
		// #437, T10: every turn is kept automatically as it completes, not only the one
		// somebody clicked keep on. Fire-and-forget on purpose - `ask()` has already
		// finished the moment the stream itself settles, and a slow or failed write must
		// never hold up the next question or take the turn's own text off the screen
		// (`keep()`'s own `catch` records `turn.keepError` and stops there). Guarded
		// (`keep()`'s own guard) against a turn with nothing to keep, exactly as the old
		// manual button was.
		const settled = liveTurn();
		if (settled) keepPromises.set(turnId, keep(settled, askedDetailLevel));
	}

	async function keep(turn: QuickAskTurn, askedDetailLevel: AskDetailLevel) {
		if (turn.keeping || turn.keptId !== null || turn.answer.length === 0) return;
		turn.keeping = true;
		turn.keepError = null;
		try {
			turn.keptId = await keepAnswer({
				universeSlug,
				question: turn.question,
				answer: turn.answer,
				detailLevel: askedDetailLevel,
				askedFromPath: page.url.pathname,
				sources: turn.sources,
				conversationId: quickAskState.conversationId
			});
		} catch {
			turn.keepError = askT.keep.failed;
		} finally {
			turn.keeping = false;
		}
	}

	/** Round eighteen, issue #531 (W3 = B), reverses U11: the Ask page is no longer a
	 * second place to ask, it is the searchable record of every kept turn, so opening a
	 * turn from here has to name the turn as well as the conversation - a GM who asked
	 * four questions in one sitting should not have to find the third one by eye.
	 * `?turn=<keptAnswerId>` is the id `keep()` already returned for this exact turn
	 * (`turn.keptId`); the notebook's own route expands and scrolls to that row and
	 * silently ignores the param if the id is missing or unknown, so a turn whose keep
	 * write failed still opens the conversation it belongs to, just with nothing
	 * pre-expanded. `keepPromises` is still what lets this wait on that one write
	 * rather than the route racing it (`kept_answer.conversation_id` and the route's
	 * own `load` already carry every other turn beside it, so no snapshot of `turn`
	 * itself needs to travel with the navigation). `close()` remains the one
	 * navigation R5 lets end the conversation (S10): the thing the panel held is now
	 * the page. */
	async function openInAsk(turn: QuickAskTurn) {
		await (keepPromises.get(turn.id) ?? Promise.resolve());
		const conversationPath = resolve(`/w/${universeSlug}/ask/${quickAskState.conversationId}`);
		const target = turn.keptId
			? `${conversationPath}?turn=${encodeURIComponent(turn.keptId)}`
			: conversationPath;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- `target` is `conversationPath` (a `resolve()` result) plus an optional query string
		await goto(target);
		await close();
	}

	/** #413, S8, round fourteen: reverses the call above `ask()` and #401 both made -
	 * filling the box and moving the caret there so the GM could send it themselves. A
	 * suggestion chip already names, in full, the exact question it asks: that is the
	 * explicit act G11 wants ("confirm every paid action"), not a second click on a
	 * button whose entire label is the question - this is not a regression against G11,
	 * it is what G11 actually asks for. Calls the same `ask()` the composer's own submit
	 * calls, so it is one paid call either way, and inherits `ask()`'s own in-flight
	 * guard: a chip cannot fire a second turn while one is still streaming, and it is
	 * gone from the screen the moment the first turn exists regardless. */
	function askSuggestion(suggestion: string): void {
		void ask(suggestion);
	}

	// Instant, never smooth: Q6 refuses motion while a turn is streaming, and a jump is
	// not an animation to begin with. Reads both `turns.length` (a new turn appearing) and
	// the last turn's `answer.length` (streaming in) inside real conditions rather than as
	// bare statements, the same dependency-registering idiom `PhoneNav.svelte`'s own
	// path-watching effect uses, so both stay tracked without reading as dead code.
	$effect(() => {
		const turnCount = quickAskState.turns.length;
		const lastTurn = quickAskState.turns.at(-1);
		if (turnCount === 0 || !scrollAreaEl) return;
		if ((lastTurn?.answer.length ?? 0) >= 0) scrollAreaEl.scrollTop = scrollAreaEl.scrollHeight;
	});

	function onWindowKeydown(event: KeyboardEvent) {
		if (matchesShortcut(event, askShortcut)) {
			event.preventDefault();
			if (quickAskState.open) void close();
			else open();
			return;
		}
		if (event.key === 'Escape' && quickAskState.open) {
			event.preventDefault();
			void close();
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if quickAskState.open}
	<!-- Phone: full width above E4's bottom tab bar. Desktop: bottom centre (R6), the same
	     footprint the launcher below has, so the panel reads as that same card expanding
	     rather than a second surface appearing beside it.
	     The desktop width is derived rather than picked (#346), unchanged by R6: it was
	     `md:w-88`, 352px, and an answer with source chips in a 352px column wrapped into a
	     ribbon: the chips are `max-w-56`/`max-w-64` each, so two of them never sat on one
	     line and a quoted sentence broke every three or four words. What the panel holds
	     is prose at the same `text-sm` the Ask route renders its own answer in, and the
	     reading room already has a number for how wide that reads: `--container-measure`,
	     34rem, declared in `routes/layout.css` for exactly that purpose. So the panel is
	     that measure plus its own `px-3` padding, 35.5rem, and the answer inside it gets
	     the same line length the route gives it rather than a width nobody can account
	     for. 568px measured, against 352px before. It stays a panel: O3 chose a pill that
	     expands in place and C2 says never a modal, so there is no overlay, no focus trap
	     and nothing behind it is inert - at the `md` breakpoint itself 568px plus its own
	     gutters leaves the page visible beside it. Height is deliberately unchanged: at
	     390x844 the phone panel already reaches 590px above a 64px bar, and the ribbon was
	     a width problem. -->
	<!-- #367 (Q6): O3 chose a pill that expands in place, and until now it did not expand,
	     it cut. The panel is the clearest case the decision names, so it arrives on
	     `duration-move` from the card the launcher was. No turn's answer animates and must
	     not: `ModelRunning` and a streaming answer are the reader already being made to
	     wait, and Q6 refuses anything that moves during that. Closing is instant, because a
	     panel that takes 200ms to get out of the way is the "delays an action behind its
	     own animation" case. -->
	<!-- Round eighteen: this panel publishes **no** height, deliberately, where it used to
	     publish its own into `shellLayoutState.dockHeight`. T11 asked the shell to reserve
	     the dock's band so nothing real sits underneath it, and #488 made that reserve come
	     out of `main`'s own box - both right for the launcher and wrong here, because this
	     panel grows to `max-h-[70vh]`, so opening it took most of the viewport out of the
	     scrollport and the page cut instead of being covered. A transient, dismissible
	     surface the reader just opened is the one case where covering is the expected
	     behaviour. `AppShell.svelte`'s own comment carries the full reasoning. -->
	<section
		class="fixed inset-x-2 bottom-16 z-30 flex max-h-[70vh] animate-in flex-col overflow-hidden rounded-xl border border-line-2 bg-panel shadow-elevated duration-move ease-arrive fade-in-0 slide-in-from-bottom-2 md:inset-x-auto md:right-auto md:bottom-6 md:left-1/2 md:w-[calc(var(--container-measure)+1.5rem)] md:-translate-x-1/2"
		aria-label={t.name}
	>
		<div class="flex items-center gap-2 border-b border-line px-3 py-2">
			<span aria-hidden="true" class="text-accent">✦</span>
			<b class="text-sm text-ink">{t.name}</b>
			<button
				type="button"
				onclick={() => void close()}
				aria-label={t.closeLabel}
				class="ml-auto rounded-md p-1 text-muted hover:bg-panel-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
			>
				<XIcon class="size-4" aria-hidden="true" />
			</button>
		</div>

		<p class="m-0 border-b border-line bg-panel-2 px-3 py-1.5 text-xs text-ink-2">
			{t.context(contextName)}
		</p>

		<!-- Issue #437, decision T10: guardrail 5's disclosure, said once here rather than
		     on a card after every turn - the first thing under the context line, so it is
		     read before anything is asked whether or not the panel has a turn in it yet.
		     Ends in the same policy link the Ask route's own keep control still carries
		     (`askT.keep.noteLinkBefore`/`noteLink`), reused rather than duplicated. -->
		<p class="m-0 border-b border-line px-3 py-1.5 text-label text-ink-2">
			{t.disclosure}{askT.keep.noteLinkBefore}<InlineLink href={resolve('/privacy')}
				>{askT.keep.noteLink}</InlineLink
			>.
		</p>

		<!-- R6: "turns render in order, the composer stays at the bottom" - everything
		     that scrolls lives here, and the composer below is pinned outside it. -->
		<div bind:this={scrollAreaEl} class="flex-1 overflow-y-auto">
			{#if quickAskState.turns.length === 0}
				<!-- R6: three deterministic suggestions, gone once there is a turn - "a
				     suggestion is for somebody who does not know what to type and not for
				     somebody mid-thought." #413 (S8, round fourteen) reverses R6's own
				     "chips fill, they never send": a chip already names the exact question
				     it asks, so clicking one sends it immediately through `askSuggestion`,
				     the same `ask()` the composer's own Enter and send control call. -->
				<ul class="m-0 flex list-none flex-wrap gap-1.5 p-3">
					{#each suggestions as suggestion (suggestion)}
						<li>
							<button
								type="button"
								onclick={() => askSuggestion(suggestion)}
								class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-left text-xs text-ink-2 hover:bg-accent-bg hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
							>
								{suggestion}
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- One provider for the whole list (FormattingToolbar.svelte's own pattern,
			     Q4): moving from one turn's icon button to the next does not re-wait the
			     tooltip's open delay each time. -->
			<Tooltip.Provider delayDuration={400}>
				{#each quickAskState.turns as turn (turn.id)}
					<div class="border-t border-line px-3 py-3 first:border-t-0">
						<!-- #436, T9: the question is the turn's own heading, not another line
						     of small text - the turn is one block with three parts (heading,
						     answer, sources) rather than five stacked paragraphs at three sizes
						     of the same grey. -->
						<div class="flex items-start justify-between gap-2">
							<h2 class="m-0 text-base font-semibold text-ink">{turn.question}</h2>
							{#if turn.answer.length > 0 && !turn.asking}
								<!-- #437, T10: the card goes; one icon button per turn opens it on
								     the Ask page, with a tooltip naming it (Q4) since no control
								     ships an unlabelled icon. -->
								<Tooltip.Root>
									<Tooltip.Trigger onclick={() => openInAsk(turn)}>
										{#snippet child({ props })}
											<Button
												{...props}
												type="button"
												variant="ghost"
												size="icon"
												class="size-7 shrink-0 text-ink-2 hover:text-ink"
												aria-label={t.openInAsk}
											>
												<ExternalLinkIcon aria-hidden="true" class="size-3.5" />
											</Button>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>{t.openInAsk}</Tooltip.Content>
								</Tooltip.Root>
							{/if}
						</div>

						{#if turn.askError}
							<p
								class="mt-2 rounded-md border border-danger-bg bg-danger-bg px-2.5 py-1.5 text-xs text-danger"
							>
								{turn.askError}
							</p>
						{/if}

						{#if turn.generated === false}
							<p
								class="mt-2 rounded-md border border-warn-bg bg-warn-bg px-2.5 py-1.5 text-xs text-warn"
							>
								{askT.noLiveModel}
							</p>
						{/if}

						{#if turn.answer.length > 0 || turn.asking}
							<!-- #414, S9: not C1's mark - an Ask answer is not proposed canon, so it
							     renders as plain prose exactly as
							     `routes/w/[universe]/ask/+page.svelte` already renders the same
							     answer, at the same measure this panel is 568px wide for (#346).
							     `aria-busy`: #434, T7. A screen reader is told this region is
							     still being written to rather than read `aria-live`, which would
							     announce every incoming word as its own interruption - once
							     `asking` clears, the settled paragraph is ordinary flow content a
							     reader reaches in document order. -->
							<div class="pt-2 text-sm text-ink" aria-busy={turn.asking}>
								<p class="m-0 leading-relaxed">
									{turn.answer}{#if turn.asking}<span
											aria-hidden="true"
											class="quick-ask-cursor ml-0.5 inline-block h-4 w-0.5 animate-pulse
											bg-accent align-middle"
										></span>{/if}
								</p>
							</div>
						{/if}

						{#if turn.proposals.length > 0 || turn.proposalFailures.length > 0}
							<div class="mt-2 flex flex-col gap-1.5">
								{#each turn.proposals as proposal (proposal.proposalId)}
									<!-- issue #256, guardrail 1 and 6: an answer that also drafted
									     something says so, and says which way round it went, wherever
									     it was asked from. -->
									<div class="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs">
										<span
											class="rounded-full border border-line-2 bg-panel px-1.5 py-0.5 text-label text-ink-2"
										>
											{proposal.kind === 'draft_entity'
												? askT.propose.badgeCreated
												: askT.propose.badgeEdited}
										</span>
										<b class="text-ink">{proposal.entityName}</b>
										{#if proposal.planId}
											<a
												href={resolve(`/w/${universeSlug}/proposals/${proposal.planId}`)}
												class="mt-1 block text-label text-ink-2 underline"
												>{askT.propose.reviewLink}</a
											>
										{/if}
									</div>
								{/each}
								{#each turn.proposalFailures as failure, i (i)}
									<p
										class="m-0 rounded-md border border-danger-bg bg-danger-bg px-2.5 py-1.5 text-xs text-danger"
									>
										{askT.propose.failed(failure.message)}
									</p>
								{/each}
							</div>
						{/if}

						{#if turn.sources.length > 0}
							<!-- #436, T9: the sources are a footer under a rule with a small label,
							     not a fourth paragraph the same size as everything above it.
							     Guardrail 3: which entry, which sentence, as something a hand can
							     open, and never a bare confidence score.
							     #535: the sentence is the citation, so it is what the row shows,
							     in the app's own quote treatment (`border-line-2`, italic, the way
							     `EvidencePopover.svelte` and `EntryProse.svelte` already render one).
							     A wrapping row of name-only pills was an entry-level pointer wearing
							     a citation's clothes: a reader could not check a single claim
							     without opening the page. -->
							<div class="mt-3 border-t border-line pt-2">
								<p class="m-0 text-label text-ink-2">{askT.sourcesNote}</p>
								<ul class="mt-1.5 mb-0 flex list-none flex-col gap-2">
									{#each turn.sources as source, i (source.kind === 'own_canon' ? source.entityId : `${source.dataSourceId}-${i}`)}
										<li class="min-w-0">
											<span class="block border-l-2 border-line-2 pl-2 text-xs text-ink-2 italic"
												>&ldquo;{source.statement}&rdquo;</span
											>
											{#if source.kind === 'own_canon'}
												<a
													href={resolve(`/w/${universeSlug}/e/${source.entitySlug}`)}
													class="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-xs text-ink hover:bg-accent-bg"
												>
													<span class="truncate">{source.entityName}</span>
													<span class="shrink-0 text-label text-muted">{askT.ownCanonLabel}</span>
												</a>
											{:else}
												<a
													href={source.url}
													target="_blank"
													rel="noreferrer"
													class="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs"
												>
													<span class="shrink-0 text-label text-ink-2">{askT.indexedBadge}</span>
													<span class="truncate text-ink">{source.pageTitle}</span>
													<span class="shrink-0 font-mono text-label text-muted">
														{source.attribution}{#if source.licence}
															· {source.licence}{/if}
													</span>
												</a>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{:else if turn.sourcesSeen}
							<!-- #346's other half, widened by #535's floor: a floor with nothing
							     behind it turns six wrong chips into silence, and silence beside an
							     answer reads as a list that failed to load rather than as a canon
							     this question did not touch. Since #535 this line also says what
							     the paragraph above it is, because that paragraph is now general
							     knowledge rather than a refusal (guardrail 7). -->
							<div class="mt-3 border-t border-line pt-2">
								<p class="m-0 text-label text-ink-2">{askT.sourcesEmpty}</p>
							</div>
						{/if}

						{#if turn.keepError}
							<!-- #437: the write must not block the answer and a failed keep must
							     not lose the turn on screen - this is the whole of what a failed
							     auto-keep gets, a quiet line rather than the card that used to
							     hold a retry button, because the turn itself is unaffected. -->
							<p class="mt-2 mb-0 text-label text-danger">{turn.keepError}</p>
						{/if}
					</div>
				{/each}
			</Tooltip.Provider>
		</div>

		<!-- R6: "the composer stays at the bottom". Pinned outside the scrollable turns
		     above rather than inside them, so it never scrolls out of reach. `onNavigate`
		     is deliberately not given (R5): selecting an entry row here is a navigation
		     exactly like clicking a source chip, and the panel now stays open behind it. -->
		<div class="border-t border-line">
			<!-- Round eighteen, issue #531 (W3 = B): C8's five levels move into the dock
			     now that the Ask page has no composer left to sit them beside (U11
			     reversed) - the same row `AskConversation.svelte` drew above its own
			     composer, condensed to this panel's width and reusing the same
			     `universe.ask` catalogue so the wording never drifts between the two. -->
			<div
				class="flex flex-wrap items-center gap-1.5 px-3 pt-2"
				role="group"
				aria-labelledby="quick-ask-detail-level-label"
			>
				<span id="quick-ask-detail-level-label" class="text-label text-ink-2">
					{askT.detailLevelLabel}
				</span>
				{#each ASK_DETAIL_LEVELS as levelId (levelId)}
					<button
						type="button"
						aria-pressed={detailLevel === levelId}
						onclick={() => (detailLevel = levelId)}
						class={detailLevel === levelId
							? 'rounded-full border border-accent bg-accent-bg px-2 py-0.5 text-label text-accent-ink'
							: 'rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-label text-ink-2 hover:bg-panel'}
					>
						{askT.levels[levelId]}
					</button>
				{/each}
			</div>
			<CommandPalette
				mode="universe"
				{universeSlug}
				{universes}
				{locale}
				placement="docked"
				bind:query={composerQuestion}
				onAsk={ask}
			/>
		</div>
	</section>
{:else}
	<!-- The launcher: desktop only. Below `md` the third tab in PhoneNav's bottom bar is
	     this same control (O3's amendment), rather than a circle drawn over the content.
	     R6: bottom centre rather than the bottom-right corner E3 = C gave table mode's own
	     dock, and the same derived width the panel below opens to, wider than the old pill
	     and with a line naming what it can be asked - "the front door of the feature the
	     product is named after". -->
	<button
		bind:this={pillEl}
		type="button"
		onclick={open}
		aria-expanded={false}
		aria-label={t.openLabel}
		class="fixed bottom-6 left-1/2 z-30 hidden w-[calc(var(--container-measure)+1.5rem)] -translate-x-1/2 flex-col items-stretch gap-0.5 rounded-xl border border-line-2 bg-panel px-4 py-2.5 text-left shadow-elevated hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none md:flex"
		use:measureDockElement={(h) => {
			// A zero here is either the `md` breakpoint hiding this launcher or its own
			// teardown as the panel opens; neither is a reason to forget what the band was,
			// which is what `launcherReserve` is for. `dockHeight` still takes the zero, so
			// the reserve does collapse where the launcher genuinely is not rendered (a
			// phone, where PhoneNav's bar is the reserve instead).
			if (h > 0) launcherReserve = h;
			shellLayoutState.dockHeight = h;
		}}
	>
		<span class="flex items-center gap-2">
			<span aria-hidden="true" class="size-1.5 rounded-full bg-accent"></span>
			<span class="text-sm font-semibold text-ink">{t.name}</span>
			<span class="ml-auto font-mono text-label text-muted">{formatShortcut(askShortcut)}</span>
		</span>
		<span class="text-xs text-ink-2">{t.launcherHint}</span>
	</button>
{/if}

<style>
	/* #434, T7, Q6: a loop with no end state to make instant, the same case `layout.css`'s
	 * own reduced-motion rule already stops outright for `.animate-spin`/`.animate-ping`/
	 * `.animate-bounce` - `animate-pulse` sits outside that shared list today because
	 * nothing used it as a "the reader is being made to wait" signal before this cursor,
	 * so nothing needed it stopped. `ModelRunning.svelte`'s own spinner is the precedent
	 * for scoping a stop rule to the one component that needs it rather than widening the
	 * shared list for every future `animate-pulse` caller, some of which may not represent
	 * a wait at all. The bar becomes static, which is correct: something still has to say
	 * the answer is unfinished once it stops pulsing. */
	@media (prefers-reduced-motion: reduce) {
		.quick-ask-cursor {
			animation: none;
		}
	}
</style>
