<script lang="ts">
	/**
	 * Issue #531, W3 = B: one row per answer, native `<details>`/`<summary>` so
	 * expanding needs no script - the same disclosure `EntrySections.svelte` and
	 * `settings/+page.svelte` already use for on-demand content (B4 = B). Collapsed: the
	 * question as the row's own heading, when it was asked, how many sources, and the
	 * answer's first line. Expanded: the whole answer as prose with its sources under a
	 * rule and a small label - T9's shape, kept where it belongs now that the composer
	 * has moved to the dock.
	 *
	 * `highlighted` opens the row on mount and scrolls it into view - the target of
	 * the dock's "open in Ask" (`?turn=<id>` on the `[conversationId]` route, resolved
	 * server-side so the row is already open in the first response; the scroll is a
	 * client-only nicety on top of that, never load-bearing).
	 *
	 * `onOpenEntry`: an `own_canon` source click opens G5's side panel rather than
	 * navigating there - unamended by the reversal ("G5's source panel stays what a
	 * source click opens", DECISIONS.md round eighteen). The caller (`ask/+page.svelte`,
	 * `ask/[conversationId]/+page.svelte`) owns the panel itself, one panel shared by
	 * every row on the page rather than one per row. An indexed source has no entry of
	 * its own to show in that panel, so it keeps its plain external link.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { stripMentionSyntax } from '$lib/markdown';
	import type { AskRowView } from '$lib/ask/history';

	let {
		turn,
		locale,
		highlighted = false,
		onOpenEntry
	}: {
		turn: AskRowView;
		locale: Locale;
		highlighted?: boolean;
		onOpenEntry: (slug: string) => void;
	} = $props();

	const t = $derived(messages(locale).universe.ask);

	function askedAtLabel(iso: string): string {
		return new Date(iso).toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	let open = $state(highlighted);
	let detailsEl = $state<HTMLDetailsElement | null>(null);

	$effect(() => {
		if (highlighted && detailsEl) detailsEl.scrollIntoView({ block: 'center' });
	});
</script>

<details
	bind:this={detailsEl}
	bind:open
	id={`turn-${turn.id}`}
	class="py-3"
	class:bg-accent-bg={highlighted}
>
	<summary
		class="flex cursor-pointer list-none items-start gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
	>
		<span
			class="mt-1 shrink-0 text-label text-muted transition-transform"
			class:rotate-90={open}
			aria-hidden="true">&#9656;</span
		>
		<div class="min-w-0 flex-1">
			<h2 class="m-0 text-body font-medium text-ink">{turn.question}</h2>
			<p class="mt-0.5 text-label text-muted">
				{askedAtLabel(turn.keptAt)} · {t.sourceCount(turn.sources.length)}
			</p>
			{#if !open}
				<p class="mt-1 max-w-measure truncate text-label text-ink-2">{turn.preview}</p>
			{/if}
		</div>
	</summary>

	<div class="mt-3 max-w-measure pl-5">
		{#if !turn.generated}
			<p class="mb-2 rounded-md border border-warn-bg bg-warn-bg px-3 py-2 text-label text-warn">
				{t.noLiveModel}
			</p>
		{/if}
		<p class="text-body leading-relaxed whitespace-pre-wrap text-ink">{turn.answer}</p>

		{#if turn.sources.length > 0}
			<!-- Guardrail 3: which entry, which sentence, never a bare confidence number. -->
			<div class="mt-3 border-t border-line pt-2">
				<p class="m-0 text-label text-ink-2">{t.sourcesNote}</p>
				<ul class="mt-1.5 mb-0 flex list-none flex-wrap gap-1.5 p-0">
					{#each turn.sources as source, i (source.kind === 'own_canon' ? (source.entity?.slug ?? `deleted-${i}`) : `${source.url}-${i}`)}
						<li>
							{#if source.kind === 'own_canon'}
								{#if source.entity}
									<!-- G5: opens the side panel, no preview and no navigation. -->
									<button
										type="button"
										onclick={() => onOpenEntry(source.entity!.slug)}
										title={stripMentionSyntax(source.statement)}
										class="inline-flex max-w-56 items-center gap-1 rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-label text-ink hover:bg-accent-bg"
									>
										<span class="truncate">{source.entity.name}</span>
										<span class="shrink-0 text-label text-muted">{t.ownCanonLabel}</span>
									</button>
								{:else}
									<span
										title={stripMentionSyntax(source.statement)}
										class="inline-flex max-w-56 items-center gap-1 rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-label text-ink-2"
									>
										{t.deletedEntry}
									</span>
								{/if}
							{:else}
								<a
									href={source.url}
									target="_blank"
									rel="noreferrer"
									title={source.statement}
									class="inline-flex max-w-64 items-center gap-1 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-label"
								>
									<span class="shrink-0 text-label text-ink-2">{t.indexedBadge}</span>
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
		{:else}
			<div class="mt-3 border-t border-line pt-2">
				<p class="m-0 text-label text-ink-2">{t.sourcesEmpty}</p>
			</div>
		{/if}
	</div>
</details>
