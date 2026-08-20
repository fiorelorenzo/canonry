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
	 * - **Keep is the only write.** Closing this loses the whole conversation, exactly as
	 *   closing the palette already does, which is what lets `ask/kept` be a history
	 *   rather than a transcript.
	 * - **The theme's own colours, not the copilot's hue.** Paper, `--line`, `--ink` and
	 *   the umber accent for the launcher, the panel, the context chip and the input, in
	 *   both palettes (G1). **This does not repeal C1**: every turn's answer renders
	 *   through `AiMarkedParagraph`, which is the dashed underline plus the numbered margin
	 *   marker C1 reserves for AI text nobody has accepted. Round eleven P2 (#344) finished
	 *   the job on the two chips drawn per turn below: the proposal chip and the indexed-
	 *   source chip are chrome around a link and a kind label, so they wear panel and line
	 *   here exactly as they now do on the Ask route, and the marked wording inside the
	 *   proposal chip is what says "not yet accepted". Do not paint the chrome in the
	 *   copilot's hue again without reading `docs/ux/DECISIONS.md` round ten and round
	 *   eleven first.
	 * - **An icon closes the panel, not the word.** With its accessible name on
	 *   `aria-label`, so the control is still named for anything that is not looking at it.
	 *
	 * Guardrail 3: the sources ride along with each turn's answer as chips, and each one
	 * opens the entry or the page it came from. Guardrail 5: the same disclosure sentence
	 * the Ask route shows beside keep (#290) shows per turn here, because this writes the
	 * same record; the provider it names arrives on that turn's `done` event and is
	 * resolved again server-side when the record is actually stored.
	 *
	 * Detail levels are not here on purpose. The panel asks at `normal`, and "open in Ask"
	 * carries a turn's answer onto the route where C8's five levels live, rather than a
	 * second row of five buttons in a narrow box.
	 */
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import XIcon from '@lucide/svelte/icons/x';
	import AiMarkedParagraph from '$lib/components/ai/AiMarkedParagraph.svelte';
	import CommandPalette from '$lib/components/palette/CommandPalette.svelte';
	import { Button } from '$lib/components/ui/button';
	import { messages, type Locale } from '$lib/i18n';
	import { formatShortcut, matchesShortcut, SHORTCUTS } from '$lib/keys';
	import { providerLabel } from '$lib/providers';
	import { askHandoff } from '$lib/ask/handoff.svelte';
	import { keepAnswer, streamAsk, type AskDetailLevel } from '$lib/ask/stream';
	import type { UniverseSummary } from '$lib/components/shell/types';
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

	const DETAIL_LEVEL: AskDetailLevel = 'normal';

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
	/** The docked composer's own input node, bound out of `CommandPalette`, so a chip can
	 * put the caret where the text just went. */
	let composerInputEl = $state<HTMLInputElement | null>(null);

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

	/** R5: closing is still the only write-nothing event - the whole conversation goes,
	 * along with whatever was left typed and not sent. */
	function reset() {
		quickAskState.turns = [];
		composerQuestion = '';
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

	async function ask(nextQuestion: string) {
		const q = nextQuestion.trim();
		if (q.length === 0) return;
		// One turn in flight at a time: a second question mid-stream would race the first
		// turn's own fields.
		if (quickAskState.turns.some((turn) => turn.asking)) return;
		const precedingTurns = quickAskState.turns.slice();
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
			provider: null,
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
			detailLevel: DETAIL_LEVEL,
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
					turn.provider = done.provider;
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
	}

	async function keep(turn: QuickAskTurn) {
		if (turn.keeping || turn.keptId !== null || turn.answer.length === 0) return;
		turn.keeping = true;
		turn.keepError = null;
		try {
			turn.keptId = await keepAnswer({
				universeSlug,
				question: turn.question,
				answer: turn.answer,
				detailLevel: DETAIL_LEVEL,
				askedFromPath: page.url.pathname,
				sources: turn.sources
			});
		} catch {
			turn.keepError = askT.keep.failed;
		} finally {
			turn.keeping = false;
		}
	}

	/** G5's expand in place: the answer moves onto the route rather than being asked a
	 * second time there. R5: unlike before this round, the navigation no longer closes the
	 * panel behind it - there is no effect left to do that - so the same turn stays visible
	 * in both places at once, which is the same "does not stop being true" argument R5
	 * makes for any other link inside the panel. */
	async function openInAsk(turn: QuickAskTurn) {
		askHandoff.put({
			question: turn.question,
			detailLevel: DETAIL_LEVEL,
			answer: turn.answer,
			sources: turn.sources,
			followUps: turn.followUps,
			proposals: turn.proposals,
			proposalFailures: turn.proposalFailures,
			generated: turn.generated,
			provider: turn.provider,
			keptId: turn.keptId
		});
		await goto(resolve(`/w/${universeSlug}/ask`));
	}

	/** A chip fills the composer and never sends it (G11: every paid action is confirmed),
	 * so the caret has to end up where the GM's next keystroke is going. Without the focus
	 * move, clicking a suggestion left the text in a box nobody was typing in and the
	 * Enter that would have sent it went nowhere. The DOM node arrives from
	 * `CommandPalette`'s docked input through `bind:inputEl`, so this waits for the flush
	 * rather than assuming it is already mounted. */
	async function fillSuggestion(suggestion: string) {
		composerQuestion = suggestion;
		await tick();
		composerInputEl?.focus();
		composerInputEl?.setSelectionRange(suggestion.length, suggestion.length);
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
	<section
		class="fixed inset-x-2 bottom-16 z-30 flex max-h-[70vh] animate-in flex-col overflow-hidden rounded-xl border border-line-2 bg-panel shadow-2xl duration-move ease-arrive fade-in-0 slide-in-from-bottom-2 md:inset-x-auto md:right-auto md:bottom-6 md:left-1/2 md:w-[calc(var(--container-measure)+1.5rem)] md:-translate-x-1/2"
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

		<!-- R6: "turns render in order, the composer stays at the bottom" - everything
		     that scrolls lives here, and the composer below is pinned outside it. -->
		<div bind:this={scrollAreaEl} class="flex-1 overflow-y-auto">
			{#if quickAskState.turns.length === 0}
				<!-- R6: three deterministic suggestions, gone once there is a turn - "a
				     suggestion is for somebody who does not know what to type and not for
				     somebody mid-thought." Chips fill the composer, they never send it. -->
				<ul class="m-0 flex list-none flex-wrap gap-1.5 p-3">
					{#each suggestions as suggestion (suggestion)}
						<li>
							<button
								type="button"
								onclick={() => fillSuggestion(suggestion)}
								class="rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-left text-xs text-ink-2 hover:bg-accent-bg hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
							>
								{suggestion}
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#each quickAskState.turns as turn (turn.id)}
				<div class="border-t border-line px-3 py-3 first:border-t-0">
					<p class="m-0 text-sm font-medium text-ink">{turn.question}</p>

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
						<!-- C1 = B, untouched by O3's colour amendment and by round eleven's:
						     unaccepted AI wording keeps the dashed underline and the numbered
						     margin marker, here as on every other surface that renders it. -->
						<div class="pt-2 text-sm">
							{#if turn.answer.length > 0}
								<AiMarkedParagraph segments={[{ text: turn.answer, proposed: true }]} />
							{/if}
							{#if turn.asking}
								<p class="ai-note mt-1 mb-0 pl-6 text-xs text-ai">{t.streaming}</p>
							{/if}
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
										class="rounded-full border border-line-2 bg-panel px-1.5 py-0.5 text-[10px] text-ink-2"
									>
										{proposal.kind === 'draft_entity'
											? askT.propose.badgeCreated
											: askT.propose.badgeEdited}
									</span>
									<b class="text-ink">{proposal.entityName}</b>
									{#if proposal.planId}
										<a
											href={resolve(`/w/${universeSlug}/proposals/${proposal.planId}`)}
											class="mt-1 block text-[11px] text-ink-2 underline"
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
						<!-- Guardrail 3: which entry, which sentence, as something a hand can
						     open. The chips are the panel's own compact form of the Ask route's
						     source cards; the indexed one keeps SPEC.md §7's attribution and
						     licence, shown on every answer a derived source appears in.
						     #346: the list says what it is before it says what is in it. No
						     score is shown, here or anywhere, which is guardrail 3's own second
						     half ("never a bare confidence score"). -->
						<p class="mt-3 mb-0 text-[11px] text-ink-2">{askT.sourcesNote}</p>
						<ul class="mt-1.5 mb-0 flex list-none flex-wrap gap-1.5">
							{#each turn.sources as source, i (source.kind === 'own_canon' ? source.entityId : `${source.dataSourceId}-${i}`)}
								<li>
									{#if source.kind === 'own_canon'}
										<a
											href={resolve(`/w/${universeSlug}/e/${source.entitySlug}`)}
											title={source.statement}
											class="inline-flex max-w-56 items-center gap-1 rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-xs text-ink hover:bg-accent-bg"
										>
											<span class="truncate">{source.entityName}</span>
											<span class="shrink-0 text-[10px] text-muted">{askT.ownCanonLabel}</span>
										</a>
									{:else}
										<a
											href={source.url}
											target="_blank"
											rel="noreferrer"
											title={source.text}
											class="inline-flex max-w-64 items-center gap-1 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs"
										>
											<span class="shrink-0 text-[10px] text-ink-2">{askT.indexedBadge}</span>
											<span class="truncate text-ink">{source.pageTitle}</span>
											<span class="shrink-0 font-mono text-[10px] text-muted">
												{source.attribution}{#if source.licence}
													· {source.licence}{/if}
											</span>
										</a>
									{/if}
								</li>
							{/each}
						</ul>
					{:else if turn.sourcesSeen}
						<!-- #346's other half. A floor on retrieval with nothing behind it turns
						     six wrong chips into silence, and silence beside an answer reads as
						     a list that failed to load rather than as a canon this question did
						     not touch. -->
						<p class="mt-3 mb-0 text-[11px] text-ink-2">{askT.sourcesEmpty}</p>
					{/if}

					{#if turn.answer.length > 0 && !turn.asking}
						<!-- Guardrail 5, and F3 = C: the disclosure sits with the control that
						     stores the record, not in a policy page the GM never opens. Same
						     sentence, same catalogue keys, as the Ask route's own keep control
						     (#290), repeated per turn since each turn is its own record to
						     keep. -->
						<div class="mt-3 rounded-lg border border-line-2 bg-panel-2 p-2.5">
							<p class="m-0 text-[11px] text-ink-2">
								{askT.keep.noteBefore}{turn.provider
									? askT.keep.noteProvider(providerLabel(turn.provider))
									: askT.keep.noteNoProvider}{askT.keep.noteAfter}
								{askT.keep.noteLinkBefore}<a
									href={resolve('/privacy')}
									class="text-accent hover:underline">{askT.keep.noteLink}</a
								>.
							</p>
							<div class="mt-2 flex items-center gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									class="border-line text-xs text-ink-2"
									onclick={() => openInAsk(turn)}
								>
									{t.openInAsk}
								</Button>
								{#if turn.keptId}
									<span class="text-xs text-ink-2">{askT.keep.kept}</span>
									<a
										href={resolve(`/w/${universeSlug}/ask/kept`)}
										class="text-xs text-accent hover:underline">{askT.keep.historyLink}</a
									>
								{:else}
									<Button
										type="button"
										size="sm"
										class="text-xs"
										disabled={turn.keeping}
										onclick={() => void keep(turn)}
									>
										{turn.keeping ? askT.keep.keeping : askT.keep.button}
									</Button>
								{/if}
							</div>
							{#if turn.keepError}
								<p class="mt-2 mb-0 text-xs text-danger">{turn.keepError}</p>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- R6: "the composer stays at the bottom". Pinned outside the scrollable turns
		     above rather than inside them, so it never scrolls out of reach. `onNavigate`
		     is deliberately not given (R5): selecting an entry row here is a navigation
		     exactly like clicking a source chip, and the panel now stays open behind it. -->
		<div class="border-t border-line">
			<CommandPalette
				mode="universe"
				{universeSlug}
				{universes}
				{locale}
				placement="docked"
				bind:query={composerQuestion}
				bind:inputEl={composerInputEl}
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
		class="fixed bottom-6 left-1/2 z-30 hidden w-[calc(var(--container-measure)+1.5rem)] -translate-x-1/2 flex-col items-stretch gap-0.5 rounded-xl border border-line-2 bg-panel px-4 py-2.5 text-left shadow-lg hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none md:flex"
	>
		<span class="flex items-center gap-2">
			<span aria-hidden="true" class="size-1.5 rounded-full bg-accent"></span>
			<span class="text-sm font-semibold text-ink">{t.name}</span>
			<span class="ml-auto font-mono text-[10px] text-muted">{formatShortcut(askShortcut)}</span>
		</span>
		<span class="text-xs text-ink-2">{t.launcherHint}</span>
	</button>
{/if}
