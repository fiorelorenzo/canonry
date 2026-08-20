<script lang="ts">
	/**
	 * Issue #285, decision O3 = A: a floating pill that expands in place. Ask had three
	 * doors and all three left the page; this is the fourth, and it is the only one that
	 * answers where the GM already is.
	 *
	 * The six amendments the decision carries, and where each one lives in this file:
	 *
	 * - **The palette's own input, in a docked placement.** The composer below is
	 *   `CommandPalette.svelte` with `placement="docked"`, not a second input: one
	 *   implementation in two positions, so #149's box and this one cannot drift. The
	 *   entry rows come along for free, which is A3 = C's own "in case a name was meant".
	 * - **Hidden in table mode.** Enforced by AppShell, which does not mount this
	 *   component under `/w/[universe]/table` at all - E3 = C's two-tier dock already owns
	 *   that corner, and a pill floating over it would be two docks in one screen. The
	 *   mod+shift+A binding lives here rather than in the palette for the same reason: on
	 *   the one surface the pill hides, the chord is simply not bound, instead of opening a
	 *   panel nobody can see.
	 * - **A tab in the phone's bottom bar, not a circle over the content.** The pill is
	 *   `hidden md:inline-flex`; below `md` the launcher is PhoneNav's third tab, which
	 *   flips the same `quickAskState`. The panel itself is full width above that bar.
	 * - **Keep is the only write.** Closing this loses everything, exactly as closing the
	 *   palette already does, which is what lets `ask/kept` be a history rather than a
	 *   transcript.
	 * - **The theme's own colours, not the copilot's violet.** Paper, `--line`, `--ink` and
	 *   the umber accent for the pill, the panel, the context chip and the input, in both
	 *   palettes (G1). **This does not repeal C1**: the streamed answer renders through
	 *   `AiMarkedParagraph`, which is the violet dashed underline plus the numbered margin
	 *   marker C1 reserves for AI text nobody has accepted, and the indexed-source chips
	 *   keep the same violet treatment the Ask route gives them. What lost the violet is
	 *   the furniture, which was never AI text. Do not paint the chrome violet again
	 *   without reading `docs/ux/DECISIONS.md` round ten first.
	 * - **An icon closes the panel, not the word.** With its accessible name on
	 *   `aria-label`, so the control is still named for anything that is not looking at it.
	 *
	 * Guardrail 3: the sources ride along with the answer as chips, and each one opens the
	 * entry or the page it came from. Guardrail 5: the same disclosure sentence the Ask
	 * route shows beside keep (#290) shows here, because this writes the same record; the
	 * provider it names arrives on the `done` event and is resolved again server-side when
	 * the record is actually stored.
	 *
	 * Detail levels are not here on purpose. The panel asks at `normal`, and "open in Ask"
	 * carries the answer onto the route where C8's five levels live, rather than a second
	 * row of five buttons in a 22rem box.
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
	import {
		keepAnswer,
		streamAsk,
		type AskDetailLevel,
		type AskProposalEvent,
		type AskProposalFailure,
		type AskSource
	} from '$lib/ask/stream';
	import type { UniverseSummary } from '$lib/components/shell/types';
	import { quickAskState } from './quick-ask-state.svelte';

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

	let pillEl = $state<HTMLButtonElement | null>(null);

	let question = $state('');
	let asking = $state(false);
	let answer = $state('');
	let sources = $state<AskSource[]>([]);
	/** #346: whether the `sources` event has arrived, which is the only thing that tells an
	 * empty list apart from a list that has not been sent yet. `runAsk` fires it once before
	 * any answer text exists, so this flips before the first token either way, and the empty
	 * state can be shown without waiting for the stream to finish. */
	let sourcesSeen = $state(false);
	let followUps = $state<string[]>([]);
	let proposals = $state<AskProposalEvent[]>([]);
	let proposalFailures = $state<AskProposalFailure[]>([]);
	let askError = $state<string | null>(null);
	let generated = $state<boolean | null>(null);
	let provider = $state<string | null>(null);
	let keeping = $state(false);
	let keptId = $state<string | null>(null);
	let keepError = $state<string | null>(null);

	/** The page this was opened from, named. An entry route carries the entity it is
	 * showing on `page.data`; everywhere else the world itself is what a question is
	 * about. Narrowed rather than asserted: most routes have no `entity` at all. */
	const contextName = $derived.by(() => {
		const entity: unknown = page.data.entity;
		if (entity && typeof entity === 'object' && 'name' in entity && typeof entity.name === 'string')
			return entity.name;
		return universeName;
	});

	function reset() {
		question = '';
		asking = false;
		answer = '';
		sources = [];
		sourcesSeen = false;
		followUps = [];
		proposals = [];
		proposalFailures = [];
		askError = null;
		generated = null;
		provider = null;
		keeping = false;
		keptId = null;
		keepError = null;
	}

	function open() {
		quickAskState.open = true;
	}

	/** Everything typed and abandoned stays abandoned (O3): closing throws the session
	 * away rather than parking it for the next opening. The pill only exists again once
	 * the panel is gone, which is why the focus return waits for a flush: `bind:this` is
	 * null while the panel is what is mounted. */
	async function close() {
		quickAskState.open = false;
		reset();
		await tick();
		pillEl?.focus();
	}

	async function ask(nextQuestion: string) {
		const q = nextQuestion.trim();
		if (q.length === 0 || asking) return;
		question = q;
		asking = true;
		answer = '';
		sources = [];
		sourcesSeen = false;
		followUps = [];
		proposals = [];
		proposalFailures = [];
		askError = null;
		generated = null;
		// A new answer is a new thing to keep, so the previous keep never carries over.
		provider = null;
		keptId = null;
		keepError = null;
		try {
			await streamAsk(
				{ universeSlug, question: q, detailLevel: DETAIL_LEVEL },
				{
					onSources: (list, follow) => {
						sources = list;
						sourcesSeen = true;
						followUps = follow;
					},
					onToken: (delta) => {
						answer += delta;
					},
					onProposal: (proposal) => {
						proposals = [...proposals, proposal];
					},
					onProposalFailure: (failure) => {
						proposalFailures = [...proposalFailures, failure];
					},
					onDone: (done) => {
						generated = done.generated;
						provider = done.provider;
					},
					onError: (message) => {
						askError = message;
					}
				}
			);
		} catch {
			// A stream that never opened. An `error` event over a stream that did open arrives
			// through `onError` above, already in the reader's language.
			askError = askT.askFailed;
		} finally {
			asking = false;
		}
	}

	async function keep() {
		if (keeping || keptId !== null || answer.length === 0) return;
		keeping = true;
		keepError = null;
		try {
			keptId = await keepAnswer({
				universeSlug,
				question,
				answer,
				detailLevel: DETAIL_LEVEL,
				askedFromPath: page.url.pathname,
				sources
			});
		} catch {
			keepError = askT.keep.failed;
		} finally {
			keeping = false;
		}
	}

	/** G5's expand in place: the same answer moves onto the route rather than being asked
	 * a second time there. The navigation itself closes the panel through the effect
	 * below. */
	async function openInAsk() {
		askHandoff.put({
			question,
			detailLevel: DETAIL_LEVEL,
			answer,
			sources,
			followUps,
			proposals,
			proposalFailures,
			generated,
			provider,
			keptId
		});
		await goto(resolve(`/w/${universeSlug}/ask`));
	}

	// A navigation closes the panel: a source chip is a real link, and a panel left
	// floating over the page it was opened from would be talking about somewhere else.
	// `lastPath` is a plain `let`, so writing it inside the effect neither loops nor makes
	// opening the panel look like a navigation.
	let lastPath = page.url.pathname;
	$effect(() => {
		const path = page.url.pathname;
		if (path === lastPath) return;
		lastPath = path;
		if (quickAskState.open) void close();
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
	<!-- Phone: full width above E4's bottom tab bar. Desktop: the corner the pill was in.
	     The desktop width is derived rather than picked (#346). It was `md:w-88`, 352px, and
	     an answer with source chips in a 352px column wrapped into a ribbon: the chips are
	     `max-w-56`/`max-w-64` each, so two of them never sat on one line and a quoted
	     sentence broke every three or four words. What the panel holds is prose at the same
	     `text-sm` the Ask route renders its own answer in, and the reading room already has
	     a number for how wide that reads: `--container-measure`, 34rem, declared in
	     `routes/layout.css` for exactly that purpose. So the panel is that measure plus its
	     own `px-3` padding, 35.5rem, and the answer inside it gets the same line length the
	     route gives it rather than a width nobody can account for. 568px measured, against
	     352px before. It stays a panel: O3 chose a pill that expands in place and C2 says
	     never a modal, so there is no overlay, no focus trap and nothing behind it is
	     inert - at the `md` breakpoint itself 568px plus the two 24px gutters leaves the
	     page visible beside it. Height is deliberately unchanged: at 390x844 the phone
	     panel already reaches 590px above a 64px bar, and the ribbon was a width problem. -->
	<section
		class="fixed inset-x-2 bottom-16 z-30 flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-line-2 bg-panel shadow-2xl md:inset-x-auto md:right-6 md:bottom-6 md:w-[calc(var(--container-measure)+1.5rem)]"
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

		<div class="overflow-y-auto">
			<CommandPalette
				mode="universe"
				{universeSlug}
				{universes}
				{locale}
				placement="docked"
				onAsk={ask}
				onNavigate={() => void close()}
			/>

			{#if askError}
				<p
					class="mx-3 mt-2 rounded-md border border-danger-bg bg-danger-bg px-2.5 py-1.5 text-xs text-danger"
				>
					{askError}
				</p>
			{/if}

			{#if generated === false}
				<p
					class="mx-3 mt-2 rounded-md border border-warn-bg bg-warn-bg px-2.5 py-1.5 text-xs text-warn"
				>
					{askT.noLiveModel}
				</p>
			{/if}

			{#if answer.length > 0 || asking}
				<!-- C1 = B, untouched by O3's colour amendment: unaccepted AI wording keeps the
				     dashed violet underline and the numbered margin marker, here as on every
				     other surface that renders it. -->
				<div class="px-3 pt-3 text-sm">
					{#if answer.length > 0}
						<AiMarkedParagraph segments={[{ text: answer, proposed: true }]} />
					{/if}
					{#if asking}
						<p class="ai-note mt-1 mb-0 pl-6 text-xs text-ai">{t.streaming}</p>
					{/if}
				</div>
			{/if}

			{#if proposals.length > 0 || proposalFailures.length > 0}
				<div class="mt-2 flex flex-col gap-1.5 px-3">
					{#each proposals as proposal (proposal.proposalId)}
						<!-- issue #256, guardrail 1 and 6: an answer that also drafted something says
						     so, and says which way round it went, wherever it was asked from. -->
						<div class="rounded-lg border border-ai-line bg-ai-bg px-2.5 py-1.5 text-xs">
							<span class="rounded-full bg-ai px-1.5 py-0.5 text-[10px] text-paper">
								{proposal.kind === 'draft_entity'
									? askT.propose.badgeCreated
									: askT.propose.badgeEdited}
							</span>
							<b class="text-ink">{proposal.entityName}</b>
							{#if proposal.planId}
								<a
									href={resolve(`/w/${universeSlug}/proposals/${proposal.planId}`)}
									class="mt-1 block text-[11px] text-ink-2 underline">{askT.propose.reviewLink}</a
								>
							{/if}
						</div>
					{/each}
					{#each proposalFailures as failure, i (i)}
						<p
							class="m-0 rounded-md border border-danger-bg bg-danger-bg px-2.5 py-1.5 text-xs text-danger"
						>
							{askT.propose.failed(failure.message)}
						</p>
					{/each}
				</div>
			{/if}

			{#if sources.length > 0}
				<!-- Guardrail 3: which entry, which sentence, as something a hand can open. The
				     chips are the panel's own compact form of the Ask route's source cards; the
				     indexed one keeps SPEC.md §7's attribution and licence, which are shown on
				     every answer a derived source appears in and are not optional.
				     #346: the list says what it is before it says what is in it. Six chips with
				     no sentence above them read as "one of these backed every claim", and the
				     honest statement is narrower and still worth making: the answer was written
				     from these and from nothing else. No score is shown, here or anywhere, which
				     is guardrail 3's own second half ("never a bare confidence score") and also
				     what `ask.ts`'s own measurement says a number here could not mean. -->
				<p class="mx-3 mt-3 mb-0 text-[11px] text-ink-2">{askT.sourcesNote}</p>
				<ul class="mt-1.5 mb-0 flex list-none flex-wrap gap-1.5 px-3">
					{#each sources as source, i (source.kind === 'own_canon' ? source.entityId : `${source.dataSourceId}-${i}`)}
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
									class="inline-flex max-w-64 items-center gap-1 rounded-full border border-ai-line bg-ai-bg px-2 py-0.5 text-xs"
								>
									<span class="shrink-0 text-[10px] text-ai">{askT.indexedBadge}</span>
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
			{:else if sourcesSeen}
				<!-- #346's other half. A floor on retrieval with nothing behind it turns six
				     wrong chips into silence, and silence beside an answer reads as a list that
				     failed to load rather than as a canon this question did not touch. The
				     answer itself says the same thing in its own words (`noSourcesInstruction`
				     in `ask.ts`); this says it about the citation list, which is the thing
				     guardrail 3 is about. -->
				<p class="mx-3 mt-3 mb-0 text-[11px] text-ink-2">{askT.sourcesEmpty}</p>
			{/if}

			{#if answer.length > 0 && !asking}
				<!-- Guardrail 5, and F3 = C: the disclosure sits with the control that stores
				     the record, not in a policy page the GM never opens. Same sentence, same
				     catalogue keys, as the Ask route's own keep control (#290). -->
				<div class="mx-3 mt-3 mb-3 rounded-lg border border-line-2 bg-panel-2 p-2.5">
					<p class="m-0 text-[11px] text-ink-2">
						{askT.keep.noteBefore}{provider
							? askT.keep.noteProvider(providerLabel(provider))
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
							onclick={openInAsk}
						>
							{t.openInAsk}
						</Button>
						{#if keptId}
							<span class="text-xs text-ink-2">{askT.keep.kept}</span>
							<a
								href={resolve(`/w/${universeSlug}/ask/kept`)}
								class="text-xs text-accent hover:underline">{askT.keep.historyLink}</a
							>
						{:else}
							<Button type="button" size="sm" class="text-xs" disabled={keeping} onclick={keep}>
								{keeping ? askT.keep.keeping : askT.keep.button}
							</Button>
						{/if}
					</div>
					{#if keepError}
						<p class="mt-2 mb-0 text-xs text-danger">{keepError}</p>
					{/if}
				</div>
			{/if}
		</div>
	</section>
{:else}
	<!-- The launcher: desktop only. Below `md` the third tab in PhoneNav's bottom bar is
	     this same control (O3's amendment), rather than a circle drawn over the content. -->
	<button
		bind:this={pillEl}
		type="button"
		onclick={open}
		aria-expanded={false}
		aria-label={t.openLabel}
		class="fixed right-6 bottom-6 z-30 hidden items-center gap-2 rounded-full border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink shadow-lg hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none md:inline-flex"
	>
		<span aria-hidden="true" class="size-1.5 rounded-full bg-accent"></span>
		<span>{t.name}</span>
		<span class="font-mono text-[10px] text-muted">{formatShortcut(askShortcut)}</span>
	</button>
{/if}
