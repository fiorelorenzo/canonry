<script lang="ts">
	/**
	 * Ask (issues #53/#60, C8 = B amended, G5 = A amended): the palette launches the flow
	 * (Sidebar's "Ask the Loremaster" button today, standing in for the full command
	 * palette issue #75 builds), the answer expands in place on this route, and clicking a
	 * source opens a side panel holding that entry - no popover, no navigation away, the
	 * answer stays readable beside it.
	 *
	 * Sources are rendered from the moment the `sources` SSE event arrives, before any
	 * answer text exists - `askAnswer` is empty until the first `token` event, but
	 * `askSources` is never empty-while-loading in a way that could read as "no evidence
	 * for this answer", satisfying guardrail 3 even mid-stream.
	 *
	 * Issue #285 (decision O3): the SSE reading and the keep POST both moved to
	 * `$lib/ask/stream.ts`, because the floating panel streams the same events and reads
	 * them the same way; the types this file used to mirror by hand live there too. And
	 * this route now has a second way in beside `?q=`: `askHandoff`, which is the panel's
	 * "open in Ask" handing over an answer that already streamed. That is G5's expand in
	 * place, so the arrival re-renders rather than re-asks, and nothing is spent twice.
	 */
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { providerLabel } from '$lib/providers';
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
		type AskProposalEvent,
		type AskProposalFailure,
		type AskSource,
		type OwnCanonSource
	} from '$lib/ask/stream';
	import { askHandoff } from '$lib/ask/handoff.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).universe.ask);

	type DetailLevel = AskDetailLevel;
	const LEVEL_IDS = ASK_DETAIL_LEVELS;

	let question = $state('');
	let detailLevel = $state<DetailLevel>('normal');
	let asking = $state(false);
	let generated = $state<boolean | null>(null);
	let askAnswer = $state('');
	let askSources = $state<AskSource[]>([]);
	let followUps = $state<string[]>([]);
	let askProposals = $state<AskProposalEvent[]>([]);
	let askProposalFailures = $state<AskProposalFailure[]>([]);
	let askError = $state<string | null>(null);

	// #290, decision O3: "keep" is the only exit that writes anything. `provider` arrives on
	// the `done` event because the guardrail 5 sentence beside the control names the company
	// that generated this text, and the client is not the place that gets to decide that.
	let provider = $state<string | null>(null);
	let keeping = $state(false);
	let keptId = $state<string | null>(null);
	let keepError = $state<string | null>(null);

	// #345: an answer that drafted something used to end in a link to the plan screen, which
	// is the same "here is a signpost, go elsewhere to act" the entry page had. The diff for
	// each drafted proposal is fetched here and reviewed in place, in the same region and the
	// same card the entry page and the inbox use. One proposal per card, still one accept per
	// entry: nothing here decides more than the card a GM is reading.
	let inlineCandidates = $state<Record<string, DiffCandidateView>>({});
	let inlineUnavailable = $state<Record<string, true>>({});

	async function keep() {
		if (keeping || keptId !== null || askAnswer.length === 0) return;
		keeping = true;
		keepError = null;
		try {
			// Sources travel as references, never as the prose that was rendered from them:
			// the record cites the entry, and the sentence it was grounded on. #285 moved that
			// mapping into `keepSourcePayload`, so the floating panel cannot send a different
			// shape than this route does.
			keptId = await keepAnswer({
				universeSlug: data.universeSlug,
				question,
				answer: askAnswer,
				detailLevel,
				askedFromPath: page.url.pathname,
				sources: askSources
			});
		} catch {
			keepError = t.keep.failed;
		} finally {
			keeping = false;
		}
	}

	interface PanelEntry {
		name: string;
		type: string;
		body: string;
	}
	let panelEntry = $state<PanelEntry | null>(null);
	let panelLoading = $state(false);

	async function openPanel(source: OwnCanonSource) {
		panelLoading = true;
		panelEntry = null;
		try {
			const res = await fetch(`/w/${data.universeSlug}/ask/entry/${source.entitySlug}`);
			if (res.ok) panelEntry = (await res.json()) as PanelEntry;
		} finally {
			panelLoading = false;
		}
	}

	function closePanel() {
		panelEntry = null;
	}

	// One GET per drafted proposal, the first time it is seen. A failure is not an error the
	// GM has to read: the card falls back to the plan link it used to carry, so a proposal is
	// never left with no way to reach its own review.
	$effect(() => {
		for (const proposal of askProposals) {
			const id = proposal.proposalId;
			if (untrack(() => inlineCandidates[id] !== undefined || inlineUnavailable[id])) continue;
			void fetchCandidate(data.universeSlug, id)
				.then((candidate) => {
					inlineCandidates[id] = candidate;
				})
				.catch(() => {
					inlineUnavailable[id] = true;
				});
		}
	});

	async function ask(nextQuestion?: string) {
		const q = (nextQuestion ?? question).trim();
		if (q.length === 0 || asking) return;
		question = q;
		asking = true;
		generated = null;
		askAnswer = '';
		askSources = [];
		followUps = [];
		askProposals = [];
		askProposalFailures = [];
		askError = null;
		panelEntry = null;
		// A new answer is a new thing to keep, so the previous keep never carries over.
		provider = null;
		keptId = null;
		keepError = null;

		try {
			await streamAsk(
				{ universeSlug: data.universeSlug, question: q, detailLevel },
				{
					onSources: (sources, follow) => {
						askSources = sources;
						followUps = follow;
					},
					onToken: (delta) => {
						askAnswer += delta;
					},
					onProposal: (proposal) => {
						askProposals = [...askProposals, proposal];
					},
					onProposalFailure: (failure) => {
						askProposalFailures = [...askProposalFailures, failure];
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
			askError = t.askFailed;
		} finally {
			asking = false;
		}
	}

	// Issue #285 (decision O3): "open in Ask" from the floating panel. G5's expand in
	// place, so what arrives is an answer that already streamed and this route re-renders
	// it rather than asking again: one model call for one question, wherever it was typed.
	// Taken before the `?q=` effect below can fire, and taken once, so a later visit here
	// is a blank composer again.
	$effect(() => {
		const carried = askHandoff.take();
		if (!carried) return;
		question = carried.question;
		detailLevel = carried.detailLevel;
		askAnswer = carried.answer;
		askSources = carried.sources;
		followUps = carried.followUps;
		askProposals = carried.proposals;
		askProposalFailures = carried.proposalFailures;
		generated = carried.generated;
		provider = carried.provider;
		// Already kept from the panel: the route says so instead of offering to store the
		// same answer a second time.
		keptId = carried.keptId;
	});

	// Issue #149 (A3 = C): the palette's typed-question result routes here with `?q=`
	// rather than answering inline (C8, G5) - this is where that question actually
	// lands. `replaceState` strips the param right away, before `ask` resolves, so a
	// reload or a copied/shared URL never re-fires the same question a second time.
	$effect(() => {
		const carried = page.url.searchParams.get('q');
		if (!carried) return;
		const url = new URL(page.url);
		url.searchParams.delete('q');
		// Rewrites the current URL to drop a consumed query param, it navigates nowhere.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, {});
		ask(carried);
	});

	async function askAtLevel(level: DetailLevel) {
		detailLevel = level;
		if (askAnswer.length > 0 || askSources.length > 0) await ask(question);
	}
</script>

<svelte:head>
	<title>{t.headTitle(data.current.name)}</title>
</svelte:head>

<div class="flex h-screen">
	<div
		class="flex-1 overflow-y-auto px-8 py-8"
		class:max-w-2xl={panelEntry !== null || panelLoading}
	>
		<div class="flex items-baseline justify-between gap-4">
			<p class="crumb text-xs tracking-wide text-muted uppercase">{t.crumb(data.current.name)}</p>
			<!-- #290: the way to what was kept. #285 moves the sidebar's own item here once the
			     floating composer lands; until then this is how the history is reached. -->
			<a
				href={resolve(`/w/${data.universeSlug}/ask/kept`)}
				class="text-xs text-accent hover:underline">{t.keep.historyLink}</a
			>
		</div>

		<form
			class="mt-3 flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2"
			onsubmit={(e) => {
				e.preventDefault();
				void ask();
			}}
		>
			<Input
				class="h-auto flex-1 border-0 bg-transparent px-0 py-0 shadow-none ring-0 focus-visible:ring-0 dark:bg-transparent"
				placeholder={t.placeholder}
				bind:value={question}
			/>
			<Button type="submit" size="sm" disabled={asking}>
				{asking ? t.asking : t.ask}
			</Button>
		</form>

		<div class="mt-2 flex flex-wrap gap-1">
			{#each LEVEL_IDS as levelId (levelId)}
				<Button
					type="button"
					variant="secondary"
					size="sm"
					class={detailLevel === levelId
						? 'border-line bg-accent-bg text-xs text-ink'
						: 'border-line text-xs text-ink-2'}
					onclick={() => askAtLevel(levelId)}
				>
					{t.levels[levelId]}
				</Button>
			{/each}
		</div>

		{#if askError}
			<p class="mt-4 rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger">
				{askError}
			</p>
		{/if}

		{#if generated === false}
			<p class="mt-3 rounded-md border border-warn-bg bg-warn-bg px-3 py-2 text-xs text-warn">
				{t.noLiveModel}
			</p>
		{/if}

		{#if askAnswer.length > 0 || asking}
			<p class="mt-4 max-w-measure text-sm leading-relaxed text-ink">
				{askAnswer}{#if asking}<span class="ai-note text-ai"> …</span>{/if}
			</p>
		{/if}

		<!-- #290, decision O3: the one exit that writes. The guardrail 5 sentence sits with it
		     rather than in a policy page (F3 = C), and it says what is stored, who generated the
		     text, that it stays a note rather than becoming canon, and that only the GM removes
		     it. Shown once the answer has finished arriving, because keeping half a stream would
		     store half a record. -->
		{#if askAnswer.length > 0 && !asking}
			<div class="mt-4 max-w-measure rounded-lg border border-line-2 bg-panel-2 p-3">
				<p class="mt-0 mb-0 text-xs text-ink-2">
					{t.keep.noteBefore}{provider
						? t.keep.noteProvider(providerLabel(provider))
						: t.keep.noteNoProvider}{t.keep.noteAfter}
					{t.keep.noteLinkBefore}<a href={resolve('/privacy')} class="text-accent hover:underline"
						>{t.keep.noteLink}</a
					>.
				</p>
				<div class="mt-2 flex items-center gap-3">
					{#if keptId}
						<span class="text-xs text-ink-2">{t.keep.kept}</span>
						<a
							href={resolve(`/w/${data.universeSlug}/ask/kept`)}
							class="text-xs text-accent hover:underline">{t.keep.historyLink}</a
						>
					{:else}
						<Button type="button" variant="secondary" size="sm" disabled={keeping} onclick={keep}>
							{keeping ? t.keep.keeping : t.keep.button}
						</Button>
					{/if}
				</div>
				{#if keepError}
					<p class="mt-2 mb-0 text-xs text-danger">{keepError}</p>
				{/if}
			</div>
		{/if}

		{#if askProposals.length > 0}
			<div class="mt-4 flex flex-col gap-2">
				{#each askProposals as proposal (proposal.proposalId)}
					<!-- issue #256, guardrail 2: pending, not canon - AiMarkedParagraph is the
						same dashed-underline/marker treatment the entry read view already uses
						for an unaccepted proposal's wording, reused rather than a second visual
						language. Guardrail 6: a redirected outcome says so, so the GM never reads
						this as "did what I asked" when it did the other thing instead. -->
					<div class="rounded-lg border border-ai-line bg-ai-bg px-2.5 py-2 text-xs">
						<span class="badge rounded-full bg-ai px-1.5 py-0.5 text-[10px] text-paper">
							{proposal.kind === 'draft_entity' ? t.propose.badgeCreated : t.propose.badgeEdited}
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
							<AiMarkedParagraph segments={[{ text: proposal.summary, proposed: true }]} />
						</div>
						<!-- #345: the diff, the evidence and the accept, here. The plan link stays as
						     the fallback for the case where fetching the diff failed, so a drafted
						     proposal always has some way to reach a review. -->
						{#if inlineCandidates[proposal.proposalId]}
							<div class="mt-2">
								<InlineProposalReview
									candidates={[inlineCandidates[proposal.proposalId]]}
									universeSlug={data.universeSlug}
									locale={data.locale}
								/>
							</div>
						{:else if proposal.planId}
							<a
								href={resolve(`/w/${data.universeSlug}/proposals/${proposal.planId}`)}
								class="mt-1 inline-block text-[11px] text-ink-2 underline"
							>
								{t.propose.reviewLink}
							</a>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if askProposalFailures.length > 0}
			<div class="mt-4 flex flex-col gap-2">
				{#each askProposalFailures as failure, i (i)}
					<!-- issue #256, the real-gateway regression: this never depends on the
						model's own words to say a proposal failed. It renders from
						onProposalFailure directly, the moment the drafting call throws. -->
					<p class="rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-xs text-danger">
						{t.propose.failed(failure.message)}
					</p>
				{/each}
			</div>
		{/if}

		{#if askSources.length > 0}
			<div class="mt-4 flex flex-col gap-1.5">
				{#each askSources as source, i (source.kind === 'own_canon' ? source.entityId : `${source.dataSourceId}-${i}`)}
					{#if source.kind === 'own_canon'}
						<!-- #147: this reads as a result card (title, label and a quoted excerpt
							stacked on three lines), not an action button - Button's inline-flex,
							centred, whitespace-nowrap base would fight that layout rather than fit
							it, so it keeps its own border/bg treatment. -->
						<button
							type="button"
							class="src clickable rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-left text-xs"
							onclick={() => openPanel(source)}
						>
							<b class="text-ink underline decoration-dotted underline-offset-2"
								>{source.entityName}</b
							>
							<span class="text-muted"> · {t.ownCanonLabel}</span>
							<span class="mt-0.5 block text-ink-2">"{source.statement}"</span>
						</button>
					{:else}
						<div class="src derived rounded-lg border border-ai-line bg-ai-bg px-2.5 py-2 text-xs">
							<!-- #147: bg-ai/text-paper is C1's AI-marking treatment - violet is the
								copilot's colour and nothing else may spend it, so this indexed-source
								chip keeps its own styling rather than becoming Badge. -->
							<span class="badge rounded-full bg-ai px-1.5 py-0.5 text-[10px] text-paper"
								>{t.indexedBadge}</span
							>
							<b class="text-ink">{source.pageTitle}</b>
							<a href={source.url} target="_blank" rel="noreferrer" class="text-ink-2 underline"
								>↗</a
							>
							<span class="lic mt-0.5 block font-mono text-[11px] text-muted">
								{source.attribution}{#if source.licence}
									· {source.licence}{/if}
							</span>
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		{#if followUps.length > 0}
			<div class="mt-3 flex flex-wrap gap-1.5">
				{#each followUps as followUp (followUp)}
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
	</div>

	{#if panelLoading || panelEntry}
		<div class="w-96 flex-none overflow-y-auto border-l border-line bg-panel p-6">
			<Button
				type="button"
				variant="link"
				size="sm"
				class="h-auto p-0 text-muted hover:text-ink"
				onclick={closePanel}>{t.close} ✕</Button
			>
			{#if panelLoading}
				<p class="mt-3 text-sm text-muted">{t.loading}</p>
			{:else if panelEntry}
				<div class="kicker mt-3">
					<span class="text-xs tracking-wide text-muted uppercase">{panelEntry.type}</span>
				</div>
				<h1 class="mt-1 font-serif text-lg text-ink">{panelEntry.name}</h1>
				<div class="prose mt-3 text-sm whitespace-pre-wrap text-ink-2">{panelEntry.body}</div>
			{/if}
		</div>
	{/if}
</div>
