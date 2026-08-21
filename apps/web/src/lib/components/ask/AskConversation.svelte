<script lang="ts">
	/**
	 * Issue #455, decision U11: the Ask page is a conversation, not a question box with one
	 * answer. Shared by both `routes/w/[universe]/ask/+page.svelte` (a fresh conversation,
	 * empty until the first question) and `.../ask/[conversationId]/+page.svelte` (one
	 * loaded from `kept_answer` by id, whether reached from `ask/kept`'s index or from the
	 * dock's "open in Ask") - the two routes differ only in where `initialTurns` and
	 * `conversationId` come from, never in how a turn renders or how asking continues one.
	 *
	 * The reference is `ai-game`'s own loremaster page (a different repo, a different
	 * design language): the shape taken from it is the message list, the GM's question
	 * right-aligned in its own bubble, the answer as prose with its sources under it, and
	 * the composer pinned at the bottom - built here in this product's own tokens, not its
	 * classes.
	 *
	 * A fresh conversation mints its id the moment the first question is sent (`crypto.
	 * randomUUID()`, exactly `quick-ask-state.svelte.ts`'s own pattern) and immediately
	 * `replaceState`s the URL to name it - the same courtesy the old `?q=` handling already
	 * gave a shared link, extended to every conversation this page ever holds, so a reload
	 * mid-conversation reopens the same one instead of losing it. Every turn is kept
	 * automatically as it settles (`$lib/ask/stream.ts`'s own `keepAnswer`, unchanged),
	 * fire-and-forget exactly as `QuickAsk.svelte` already does it (T10): the write must
	 * never hold up the next question or take a turn's own text off the screen.
	 *
	 * Guardrail 5's disclosure is said once, above the message list, the same placement
	 * T10 gave the docked panel's own copy ("the first thing... read before anything is
	 * asked") - no per-answer card. Guardrail 2: the answer itself carries no C1 mark (S9);
	 * a drafted proposal inside a turn keeps its own, through `AiMarkedParagraph`. Guardrail
	 * 4: `runAsk`'s reading-only branch (AI off) still answers from retrieval, which
	 * `turn.generated === false` surfaces as the same warning every other Ask surface uses.
	 */
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AiMarkedParagraph from '$lib/components/ai/AiMarkedParagraph.svelte';
	import InlineProposalReview from '$lib/components/proposals/InlineProposalReview.svelte';
	import type { DiffCandidateView } from '$lib/components/proposals/ProposalDiffCard.svelte';
	import { fetchCandidate } from '$lib/proposals/inline';
	import {
		ASK_DETAIL_LEVELS,
		keepAnswer,
		streamAsk,
		type AskDetailLevel,
		type AskSource
	} from '$lib/ask/stream';
	import {
		buildAskHistory,
		liveSourceToTurnSource,
		type ConversationTurn
	} from '$lib/ask/conversation';
	import { quickAskSuggestions } from '$lib/components/copilot/quick-ask-suggestions';
	import { stripMentionSyntax } from '$lib/markdown';

	let {
		universeSlug,
		universeName,
		locale,
		conversationId: initialConversationId,
		initialTurns = []
	}: {
		universeSlug: string;
		universeName: string;
		locale: Locale;
		conversationId: string | null;
		initialTurns?: ConversationTurn[];
	} = $props();

	const t = $derived(messages(locale).universe.ask);
	const LEVEL_IDS = ASK_DETAIL_LEVELS;

	/** Null until the first question of a fresh conversation is sent, at which point it is
	 * minted once and never changes again - the same id every turn from here on groups
	 * under. Non-null from the start for a loaded conversation. */
	let conversationId = $state<string | null>(initialConversationId);
	let turns = $state<ConversationTurn[]>(initialTurns);
	let question = $state('');
	let detailLevel = $state<AskDetailLevel>('normal');
	let isAsking = $state(false);
	let scrollAreaEl = $state<HTMLDivElement | null>(null);

	interface PanelEntry {
		name: string;
		type: string;
		body: string;
	}
	let panelEntry = $state<PanelEntry | null>(null);
	let panelLoading = $state(false);

	async function openPanel(slug: string) {
		panelLoading = true;
		panelEntry = null;
		try {
			const res = await fetch(`/w/${universeSlug}/ask/entry/${slug}`);
			if (res.ok) panelEntry = (await res.json()) as PanelEntry;
		} finally {
			panelLoading = false;
		}
	}
	function closePanel() {
		panelEntry = null;
	}

	/** One GET per drafted proposal, the first time it is seen, across every turn this
	 * conversation holds - not only the newest one, since a loaded conversation can arrive
	 * with several already (though only turns asked live this session ever carry a
	 * proposal at all; see `ConversationTurn`'s own comment). A failure falls back to the
	 * plan link the card already carries, so a proposal is never left with no way to reach
	 * its own review. */
	let inlineCandidates = $state<Record<string, DiffCandidateView>>({});
	let inlineUnavailable = $state<Record<string, true>>({});
	$effect(() => {
		for (const turn of turns) {
			for (const proposal of turn.proposals) {
				const id = proposal.proposalId;
				if (untrack(() => inlineCandidates[id] !== undefined || inlineUnavailable[id])) continue;
				void fetchCandidate(universeSlug, id)
					.then((candidate) => {
						inlineCandidates[id] = candidate;
					})
					.catch(() => {
						inlineUnavailable[id] = true;
					});
			}
		}
	});

	/** R6's own deterministic suggestions (`quick-ask-suggestions.ts`), reused rather than
	 * duplicated: this route carries no entity of its own, so it always falls into the
	 * "world" bucket unless it is standing on the proposals route's own tab. */
	const suggestions = $derived(
		quickAskSuggestions(
			{ routeId: page.route.id, entity: null },
			messages(locale).shell.quickAsk.suggestions
		)
	);

	async function keep(turn: ConversationTurn, sources: readonly AskSource[]) {
		if (turn.answer.length === 0) return;
		try {
			await keepAnswer({
				universeSlug,
				question: turn.question,
				answer: turn.answer,
				detailLevel,
				askedFromPath: page.url.pathname,
				sources,
				conversationId: conversationId ?? undefined
			});
		} catch {
			turn.keepError = t.keep.failed;
		}
	}

	async function ask(nextQuestion?: string) {
		const q = (nextQuestion ?? question).trim();
		if (q.length === 0 || isAsking) return;

		// A fresh conversation's id is minted the moment it actually needs one, and the URL
		// is renamed to match immediately - not only after the turn settles - so the address
		// bar always names the conversation this page is showing, in flight or not.
		if (!conversationId) {
			conversationId = crypto.randomUUID();
			replaceState(resolve(`/w/${universeSlug}/ask/${conversationId}`), {});
		}

		const askedDetailLevel = detailLevel;
		const precedingTurns = turns.slice();
		const turnId = crypto.randomUUID();
		question = '';
		isAsking = true;
		turns.push({
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
			keepError: null
		});

		// Closing over the pushed object directly would miss `$state`'s own deep-proxied
		// copy once it lands inside the reactive array (`quick-ask-state.svelte.ts`'s own
		// pattern, documented there) - re-read the live element by id on every event.
		function liveTurn(): ConversationTurn | undefined {
			return turns.find((candidate) => candidate.id === turnId);
		}

		let rawSources: readonly AskSource[] = [];
		try {
			await streamAsk(
				{
					universeSlug,
					question: q,
					detailLevel: askedDetailLevel,
					history: buildAskHistory(precedingTurns),
					context: { kind: 'world', name: universeName }
				},
				{
					onSources: (sources, follow) => {
						const turn = liveTurn();
						if (!turn) return;
						rawSources = sources;
						turn.sources = sources.map(liveSourceToTurnSource);
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
						if (turn) turn.generated = done.generated;
					},
					onError: (message) => {
						const turn = liveTurn();
						if (turn) turn.askError = message;
					}
				}
			);
		} catch {
			const turn = liveTurn();
			if (turn) turn.askError = t.askFailed;
		} finally {
			const turn = liveTurn();
			if (turn) turn.asking = false;
			isAsking = false;
		}

		// #455, following T10's own dock precedent: every turn is kept automatically as it
		// completes. Fire-and-forget on purpose - a slow or failed write must never hold up
		// the next question or take the turn's own text off the screen.
		const settled = liveTurn();
		if (settled) void keep(settled, rawSources);
	}

	function askSuggestion(suggestion: string): void {
		void ask(suggestion);
	}

	// Issue #149 (A3 = C): the palette's typed-question result routes here with `?q=`
	// rather than answering inline - this is where that question actually lands.
	// `replaceState` strips the param right away, before `ask` resolves, so a reload or a
	// copied/shared URL never re-fires the same question a second time. Only ever fires on
	// a fresh conversation: the palette's own link always points at the bare `/ask` route.
	$effect(() => {
		const carried = page.url.searchParams.get('q');
		if (!carried) return;
		const url = new URL(page.url);
		url.searchParams.delete('q');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, {});
		void ask(carried);
	});

	// Instant, never smooth (Q6): a jump is not an animation to begin with, and nothing
	// here earns motion while a model is already making the reader wait.
	$effect(() => {
		const turnCount = turns.length;
		const lastTurn = turns.at(-1);
		if (turnCount === 0 || !scrollAreaEl) return;
		if ((lastTurn?.answer.length ?? 0) >= 0) scrollAreaEl.scrollTop = scrollAreaEl.scrollHeight;
	});
</script>

<svelte:head>
	<title>{t.headTitle(universeName)}</title>
</svelte:head>

<!-- `h-full` rather than `h-screen`: this fills `main`'s own content box (`AppShell.svelte`),
     which already carries T11's own `padding-bottom` reservation for whatever the shell's
     floating chrome (PhoneNav's bar, QuickAsk's launcher or open panel) is showing right
     now. A viewport-relative `h-screen` here would ignore that reservation entirely and
     pin the composer below it, under the dock - measured before this fix, at 1440x900,
     with the panel closed. -->
<!-- V1 = B (#494): `flex h-full flex-col` here rather than the shared `PageBody`
     wrapper - this component's composer is pinned to the bottom and the turns list
     scrolls independently inside a fixed-height column, which needs an unbroken
     `h-full` chain from `main` down to the scroll area. Width is "wide" already, by
     omission: nothing here ever carried an `mx-auto max-w-*`, so there is nothing to
     replace. -->
<div class="flex h-full flex-col">
	<PageHeader title={t.crumb(universeName)}>
		{#snippet actions()}
			<a href={resolve(`/w/${universeSlug}/ask/kept`)} class="text-xs text-accent hover:underline">
				{t.keep.historyLink}
			</a>
		{/snippet}
	</PageHeader>
	<!-- Guardrail 5, said once here where it can be read before anything is asked
	     (T10's own placement for the docked panel) - no per-answer card. -->
	<p class="max-w-measure shrink-0 px-8 pb-4 text-xs text-ink-2">
		{t.disclosure}{t.keep.noteLinkBefore}<a
			href={resolve('/privacy')}
			class="text-accent hover:underline">{t.keep.noteLink}</a
		>.
	</p>

	<div class="flex flex-1 overflow-hidden">
		<div
			class="flex flex-1 flex-col overflow-hidden"
			class:max-w-2xl={panelEntry !== null || panelLoading}
		>
			<div bind:this={scrollAreaEl} class="flex-1 overflow-y-auto px-8 py-6">
				{#if turns.length === 0}
					<div class="mx-auto max-w-measure">
						<h2 class="text-lg text-ink">{t.emptyState.heading}</h2>
						<p class="mt-1 max-w-measure text-sm text-ink-2">{t.emptyState.body(universeName)}</p>
						{#if suggestions.length > 0}
							<p class="mt-6 text-xs tracking-wide text-muted uppercase">
								{t.emptyState.tryAsking}
							</p>
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each suggestions as suggestion (suggestion)}
									<button
										type="button"
										onclick={() => askSuggestion(suggestion)}
										class="rounded-lg border border-line bg-panel-2 px-3 py-2 text-left text-sm text-ink-2 hover:border-accent hover:bg-accent-bg hover:text-accent-ink"
									>
										{suggestion}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<div class="mx-auto flex max-w-measure flex-col gap-6">
					{#each turns as turn, index (turn.id)}
						<!-- The GM's own question, right-aligned in its own bubble - never marked,
					     it is not AI text. -->
						<div class="flex justify-end">
							<div
								class="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-bg px-4 py-2.5 text-sm text-accent-ink"
							>
								{turn.question}
							</div>
						</div>

						<div>
							{#if turn.askError}
								<p
									class="rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger"
								>
									{turn.askError}
								</p>
							{/if}

							{#if turn.generated === false}
								<p
									class="mt-2 rounded-md border border-warn-bg bg-warn-bg px-3 py-2 text-xs text-warn"
								>
									{t.noLiveModel}
								</p>
							{/if}

							{#if turn.answer.length > 0 || turn.asking}
								<!-- Guardrail 2 (S9): plain prose, no C1 mark - an Ask answer is not
							     proposed canon. `aria-busy` rather than `aria-live`: token-by-token
							     text would otherwise announce every mutation as its own
							     interruption. -->
								<div aria-busy={turn.asking}>
									<p class="max-w-measure text-sm leading-relaxed text-ink">
										{turn.answer}{#if turn.asking}<span
												aria-hidden="true"
												class="ask-cursor ml-0.5 inline-block h-4 w-0.5 align-middle"
											></span>{/if}
									</p>
								</div>
							{/if}

							{#if turn.proposals.length > 0 || turn.proposalFailures.length > 0}
								<div class="mt-3 flex flex-col gap-2">
									{#each turn.proposals as proposal (proposal.proposalId)}
										<!-- Guardrail 2: a proposal in a turn keeps its own C1 mark, through
									     `AiMarkedParagraph` - the surrounding answer does not. -->
										<div class="rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs">
											<span
												class="rounded-full border border-line-2 bg-panel px-1.5 py-0.5 text-[10px] text-ink-2"
											>
												{proposal.kind === 'draft_entity'
													? t.propose.badgeCreated
													: t.propose.badgeEdited}
											</span>
											<b class="text-ink">{proposal.entityName}</b>
											{#if proposal.redirected}
												<p class="mt-1 text-[11px] text-muted">
													{proposal.kind === 'draft_entity'
														? t.propose.redirectedToCreate(proposal.entityName)
														: t.propose.redirectedToEdit(proposal.entityName)}
												</p>
											{/if}
											<div class="mt-1">
												<AiMarkedParagraph
													segments={[{ text: proposal.summary, proposed: true }]}
												/>
											</div>
											{#if inlineCandidates[proposal.proposalId]}
												<div class="mt-2">
													<InlineProposalReview
														candidates={[inlineCandidates[proposal.proposalId]]}
														{universeSlug}
														{locale}
													/>
												</div>
											{:else if proposal.planId}
												<a
													href={resolve(`/w/${universeSlug}/proposals/${proposal.planId}`)}
													class="mt-1 inline-block text-[11px] text-ink-2 underline"
												>
													{t.propose.reviewLink}
												</a>
											{/if}
										</div>
									{/each}
									{#each turn.proposalFailures as failure, i (i)}
										<p
											class="rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-xs text-danger"
										>
											{t.propose.failed(failure.message)}
										</p>
									{/each}
								</div>
							{/if}

							{#if turn.sources.length > 0}
								<!-- Guardrail 3: which entry, which sentence, never a bare confidence
							     number. -->
								<div class="mt-3 border-t border-line pt-2">
									<p class="m-0 text-xs text-ink-2">{t.sourcesNote}</p>
									<div class="mt-1.5 flex flex-wrap gap-1.5">
										{#each turn.sources as source, i (source.kind === 'own_canon' ? (source.entity?.id ?? `deleted-${i}`) : `${source.url}-${i}`)}
											{#if source.kind === 'own_canon'}
												{#if source.entity}
													<button
														type="button"
														class="src clickable rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-left text-xs"
														onclick={() => openPanel(source.entity!.slug)}
													>
														<b class="text-ink underline decoration-dotted underline-offset-2"
															>{source.entity.name}</b
														>
														<span class="text-muted"> · {t.ownCanonLabel}</span>
														<span class="mt-0.5 block text-ink-2"
															>"{stripMentionSyntax(source.statement)}"</span
														>
													</button>
												{:else}
													<div
														class="src rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs"
													>
														<span class="text-muted">{t.deletedEntry}</span>
														<span class="mt-0.5 block text-ink-2"
															>"{stripMentionSyntax(source.statement)}"</span
														>
													</div>
												{/if}
											{:else}
												<div
													class="src derived rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs"
												>
													<span
														class="badge rounded-full border border-line-2 bg-panel px-1.5 py-0.5 text-[10px] text-ink-2"
														>{t.indexedBadge}</span
													>
													<b class="text-ink">{source.pageTitle}</b>
													<a
														href={source.url}
														target="_blank"
														rel="noreferrer"
														class="text-ink-2 underline">↗</a
													>
													{#if source.attribution}
														<span class="mt-0.5 block font-mono text-[11px] text-muted">
															{source.attribution}{#if source.licence}
																· {source.licence}{/if}
														</span>
													{/if}
													<span class="mt-0.5 block text-ink-2">"{source.statement}"</span>
												</div>
											{/if}
										{/each}
									</div>
								</div>
							{:else if turn.sourcesSeen}
								<p class="mt-3 border-t border-line pt-2 text-xs text-ink-2">{t.sourcesEmpty}</p>
							{/if}

							<!-- Only the most recent turn's own follow-ups stay actionable - an older
						     turn's suggestions read as stale once buried under later ones. Sends
						     immediately (S8): the chip's own words are the confirmation G11 wants. -->
							{#if index === turns.length - 1 && !turn.asking && turn.followUps.length > 0}
								<div class="mt-3 flex flex-wrap gap-1.5">
									{#each turn.followUps as followUp (followUp)}
										<Button
											type="button"
											variant="secondary"
											size="sm"
											class="border-line text-xs text-ink-2"
											onclick={() => ask(followUp)}
										>
											{followUp}
										</Button>
									{/each}
								</div>
							{/if}

							{#if turn.keepError}
								<p class="mt-2 mb-0 text-[11px] text-danger">{turn.keepError}</p>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- The composer, pinned outside the scrollable turns above so it never scrolls out
		     of reach. C8: the five detail levels stay, moved beside it. -->
			<div class="shrink-0 border-t border-line-2 bg-panel px-8 py-4">
				<div class="mx-auto max-w-measure">
					<form
						class="flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2"
						onsubmit={(e) => {
							e.preventDefault();
							void ask();
						}}
					>
						<Input
							class="h-auto flex-1 border-0 bg-transparent px-0 py-0 shadow-none ring-0 focus-visible:ring-0 dark:bg-transparent"
							placeholder={turns.length > 0 ? t.placeholderFollowUp : t.placeholder}
							bind:value={question}
						/>
						<Button type="submit" size="sm" disabled={isAsking || question.trim().length === 0}>
							{isAsking ? t.asking : t.ask}
						</Button>
					</form>

					<div class="mt-2 flex flex-wrap items-center gap-3">
						<span id="ask-detail-level-label" class="text-xs text-ink-2">{t.detailLevelLabel}</span>
						<div class="flex flex-wrap gap-1" role="group" aria-labelledby="ask-detail-level-label">
							{#each LEVEL_IDS as levelId (levelId)}
								<Button
									type="button"
									variant="secondary"
									size="sm"
									class={detailLevel === levelId
										? 'border-line bg-accent-bg text-xs text-ink'
										: 'border-line text-xs text-ink-2'}
									onclick={() => (detailLevel = levelId)}
								>
									{t.levels[levelId]}
								</Button>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</div>

		{#if panelLoading || panelEntry}
			<div class="w-96 flex-none overflow-y-auto border-l border-line bg-panel p-6">
				{#if panelLoading}
					<p class="text-sm text-muted">{t.loading}</p>
				{:else if panelEntry}
					<div class="flex items-start justify-between gap-2">
						<div>
							<p class="text-xs tracking-wide text-muted uppercase">{panelEntry.type}</p>
							<h2 class="mt-0.5 text-lg text-ink">{panelEntry.name}</h2>
						</div>
						<Button type="button" variant="ghost" size="sm" onclick={closePanel}>{t.close}</Button>
					</div>
					<p class="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">
						{panelEntry.body}
					</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* T7/Q6: a streaming answer ends in a one-character-tall bar on the accent, pulsing -
	   the same treatment `QuickAsk.svelte` already gives the dock's own turns, scoped
	   locally rather than widened globally since nothing else in this file needs it
	   stopped under reduced motion. */
	.ask-cursor {
		background-color: var(--color-accent);
		animation: ask-cursor-pulse 1.4s ease-in-out infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.ask-cursor {
			animation: none;
		}
	}

	@keyframes ask-cursor-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}
</style>
