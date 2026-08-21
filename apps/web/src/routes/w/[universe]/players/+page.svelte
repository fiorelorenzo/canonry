<script lang="ts">
	/**
	 * Issue R11, round thirteen: the GM's side of the players' wiki. No write action lives
	 * here - a reveal happens in Table mode (E5 = C), and an invitation does not exist
	 * anywhere in the product yet, so `invitationsNotice` says that in one sentence rather
	 * than the page growing a button that writes nothing.
	 *
	 * Issue #492: every name in the log is a link now. An entity row's whole label already
	 * is the entry's own name; a fact row's label is the statement `fact.entity_id` was
	 * extracted from (SPEC.md §4.2), so the whole statement links to that same entry
	 * rather than a guess at which words inside it are the name. A relation row names two
	 * entries ("Aldric Vane member of The Valdoria Watch"), so both link independently -
	 * the row does not pick a side. `nameLink` below is the one place that renders an
	 * entry name: the GM link plus, only where `revealed` says the party can see this
	 * specific entity too, a second small link to the player's own view of it - "what does
	 * the player see" being the question this page exists to answer (R11's own doc
	 * comment on `+page.server.ts`). Both links carry `data-entry-slug` (#442, T2), so
	 * `MentionPreview` below previews either one for free.
	 */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { Button } from '$lib/components/ui/button';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import MentionPreview from '$lib/components/entry/MentionPreview.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).universe.players);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}

	// Mention preview delegates off this element (#429/#442), one instance for the whole
	// revealed list rather than one per row.
	let revealedContainer = $state<HTMLElement | null>(null);
</script>

<svelte:head>
	<title>{t.headTitle(data.universe.name)}</title>
</svelte:head>

<PageHeader eyebrow={data.universe.name} title={t.heading} description={t.description} />
<PageBody width="working">
	<div class="flex flex-col gap-8 px-8 py-16">

	<div class="flex flex-col gap-2 rounded-lg border border-line bg-panel p-5">
		<h2 class="text-sm font-semibold text-ink">{t.wikiLinkLabel}</h2>
		<p class="font-mono text-sm text-ink-2">{resolve(`/p/${data.universe.slug}`)}</p>
		<div>
			<Button
				href={resolve(`/p/${data.universe.slug}`)}
				target="_blank"
				rel="noopener"
				variant="secondary"
				size="sm"
			>
				{t.openWikiLink}
			</Button>
		</div>
		<p class="mt-1 text-sm text-muted">{t.invitationsNotice}</p>
	</div>

	<div bind:this={revealedContainer} class="relative">
		<h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
			{t.revealedHeading}
		</h2>

		{#snippet nameLink(ref: { slug: string; name: string; revealed: boolean }, text: string)}
			<a
				href={resolve(`/w/${data.universe.slug}/e/${ref.slug}`)}
				data-entry-slug={ref.slug}
				class="text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg"
				>{text}</a
			>{#if ref.revealed}<Button
					href={resolve(`/p/${data.universe.slug}/${ref.slug}`)}
					data-entry-slug={ref.slug}
					target="_blank"
					rel="noopener"
					variant="ghost"
					size="icon"
					class="ml-0.5 size-5 shrink-0 align-middle text-ink-2 hover:text-ink"
					aria-label={t.openInWiki(ref.name)}
					><ExternalLinkIcon aria-hidden="true" class="size-3" /></Button
				>{/if}
		{/snippet}

		{#if data.log.length === 0}
			<EmptyState kind="cold" message={t.revealedEmpty}>
				{#snippet action()}
					<Button href={resolve(`/w/${data.universe.slug}/table`)}>{t.revealedEmptyAction}</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<ul class="flex flex-col gap-2.5">
				{#each data.log as entry (entry.id)}
					<li class="flex flex-col gap-0.5 text-sm">
						<span class="text-ink">
							{#if entry.kind === 'relation'}
								{@render nameLink(entry.from, entry.from.name)}
								{entry.relationLabel}
								{@render nameLink(entry.to, entry.to.name)}
							{:else}
								{@render nameLink(entry.entity, entry.label)}
							{/if}
						</span>
						<span class="text-xs text-muted">
							{t.kindLabel[entry.kind]} &middot; {entry.sessionName ?? t.sessionUnknown} &middot;
							{formatWhen(entry.confirmedAt)}
						</span>
					</li>
				{/each}
			</ul>
			<MentionPreview
				container={revealedContainer}
				universeSlug={data.universe.slug}
				surface="gm"
				locale={data.locale}
			/>
		{/if}
	</div>

	<div>
		<h2 class="mb-1 text-sm font-semibold tracking-wide text-muted uppercase">
			{t.hiddenHeading}
		</h2>
		<p class="mb-3 text-sm text-muted">{t.hiddenDescription}</p>

		{#if data.hidden.length === 0}
			<EmptyState kind="settled" message={t.hiddenEmpty} />
		{:else}
			<ul class="flex flex-col divide-y divide-line">
				{#each data.hidden as entity (entity.id)}
					<li>
						<a
							href={resolve(`/w/${data.universe.slug}/e/${entity.slug}`)}
							class="flex items-center justify-between gap-3 py-2 text-sm text-ink-2 transition-colors hover:text-ink"
						>
							<span>{entity.name}</span>
							<span class="text-xs tracking-wide text-muted uppercase"
								>{t.entityTypeLabel(entity.type)}</span
							>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	</div>
</PageBody>
