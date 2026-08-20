<script lang="ts">
	/**
	 * Issue R11, round thirteen: the GM's side of the players' wiki. No write action lives
	 * here - a reveal happens in Table mode (E5 = C), and an invitation does not exist
	 * anywhere in the product yet, so `invitationsNotice` says that in one sentence rather
	 * than the page growing a button that writes nothing.
	 */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).universe.players);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
</script>

<svelte:head>
	<title>{t.headTitle(data.universe.name)}</title>
</svelte:head>

<div class="mx-auto flex max-w-measure flex-col gap-8 px-8 py-16">
	<PageHeader eyebrow={data.universe.name} title={t.heading} description={t.description} />

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

	<div>
		<h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
			{t.revealedHeading}
		</h2>

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
						<span class="text-ink">{entry.label}</span>
						<span class="text-xs text-muted">
							{t.kindLabel[entry.kind]} &middot; {entry.sessionName ?? t.sessionUnknown} &middot;
							{formatWhen(entry.confirmedAt)}
						</span>
					</li>
				{/each}
			</ul>
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
