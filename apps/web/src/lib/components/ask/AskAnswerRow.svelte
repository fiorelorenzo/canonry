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
		<!-- #711: `text-ink-2`, not `text-muted`. The row above takes `bg-accent-bg` when it
		     is the turn the dock sent the reader to, and muted is a paper-and-panel ink that
		     fails AA the moment a surface takes a hue (#562, and the ten measurements next to
		     the tokens in layout.css). Unconditional rather than paired with `highlighted`,
		     because ink-2 is right on panel too and it is what the preview line below already
		     uses, so the two secondary lines in this summary stop disagreeing. -->
		<span
			class="mt-1 shrink-0 text-label text-ink-2 transition-transform"
			class:rotate-90={open}
			aria-hidden="true">&#9656;</span
		>
		<div class="min-w-0 flex-1">
			<h2 class="m-0 text-body font-medium text-ink">{turn.question}</h2>
			<p class="mt-0.5 text-label text-ink-2">
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

		{#if turn.loss}
			<!-- Issue #699: the same two lines the dock paints on the live turn (#696), from the
			     same `universe.ask.truncated.*` keys and in the same `warn` treatment, so the
			     record cannot say less than the answer said when it was written. Directly under
			     the paragraph it is about and above the sources, which is where the dock puts it
			     and what makes it legible: the sentence it explains is the one that stops short.
			     Deliberately not on the collapsed summary above - that row shows one line of
			     preview, so a caveat there would be attached to a sentence the reader cannot yet
			     see, and the issue's own question about the list row is answered no for that
			     reason. Guardrail 7: the second line only appears when a proposal really was
			     lost, and neither line says anything about the ones that survived. -->
			<div class="mt-2 rounded-md border border-warn-bg bg-warn-bg px-3 py-2 text-label text-warn">
				{#if turn.loss.truncated}
					<p class="m-0">{t.truncated.notice}</p>
				{/if}
				{#if turn.loss.lostProposals > 0}
					<p class="m-0" class:mt-1={turn.loss.truncated}>
						{t.truncated.proposalsLost(turn.loss.lostProposals)}
					</p>
				{/if}
			</div>
		{/if}

		{#if turn.sources.length > 0}
			<!-- Guardrail 3: which entry, which sentence, never a bare confidence number.
			     Issue #797 (round twenty-one): the entry used to be a bordered, rounded-full
			     pill under the quote (see QuickAsk.svelte's own comment on the same change,
			     shared shape). It is a plain inline link now - the app's own quote treatment
			     (`border-line-2`, italic - `EvidencePopover.svelte`) for the sentence and the
			     one inline-link shape (#551) for the entry underneath it, a tight list rather
			     than a row of chips. -->
			<div class="mt-2 border-t border-line pt-1.5">
				<p class="m-0 text-label text-ink-2">{t.sourcesNote}</p>
				<ul class="mt-1.5 mb-0 flex list-none flex-col gap-1.5 p-0">
					{#each turn.sources as source, i (source.kind === 'own_canon' ? (source.entity?.slug ?? `deleted-${i}`) : `${source.url}-${i}`)}
						<li class="min-w-0 border-l-2 border-line-2 pl-2 text-label text-ink-2">
							<p class="m-0 italic">&ldquo;{stripMentionSyntax(source.statement)}&rdquo;</p>
							<p class="m-0 mt-0.5">
								{#if source.kind === 'own_canon'}
									{#if source.entity}
										<!-- G5: opens the side panel, no preview and no navigation. -->
										<button
											type="button"
											onclick={() => onOpenEntry(source.entity!.slug)}
											class="font-medium text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg"
										>
											{source.entity.name}
										</button>
										<!-- #562/#711: `text-ink-2`, not `text-muted` - this whole row sits
										     inside `class:bg-accent-bg={highlighted}` (the row above, opened via
										     the dock's "open in Ask"), and muted fails contrast the moment that
										     surface takes the hue. -->
										<span class="text-ink-2"> · {t.ownCanonLabel}</span>
									{:else}
										<span class="text-ink-2">{t.deletedEntry}</span>
									{/if}
								{:else}
									<a
										href={source.url}
										target="_blank"
										rel="noreferrer"
										class="font-medium text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg"
									>
										{source.pageTitle}
									</a>
									<span class="text-ink-2">
										· {t.indexedBadge} · {source.attribution}{#if source.licence}
											· {source.licence}{/if}
									</span>
								{/if}
							</p>
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			<!-- #535: a stored answer with no citation is one the world had nothing to say
			     about, and the paragraph above it is general knowledge. The line says both,
			     because the record outlives the session that produced it (W3). Issue #797:
			     compressed to one line - see `t.sourcesEmpty`'s own comment in messages.ts. -->
			<div class="mt-2 border-t border-line pt-1.5">
				<p class="m-0 text-label text-ink-2">{t.sourcesEmpty}</p>
			</div>
		{/if}
	</div>
</details>
