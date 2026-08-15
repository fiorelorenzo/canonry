<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale).settings);
</script>

<svelte:head>
	<title>{t.export.title}: Canonry</title>
</svelte:head>

<PageHeader title={t.export.title} />

<p class="mt-4 text-sm text-ink-2">
	{t.export.para1Before}<code class="text-ink">[[Name]]</code>{t.export.para1After}
</p>
<p class="mt-2 text-sm text-ink-2">
	{t.export.para2Before}<code class="text-ink">visibility</code>{t.export.para2After}
</p>

{#if data.universes.length === 0}
	<div class="mt-8">
		<EmptyState kind="cold" message={t.export.emptyState} />
	</div>
{:else}
	<ul class="mt-8 flex flex-col gap-3">
		{#each data.universes as universe (universe.id)}
			<li
				class="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
			>
				<span class="font-semibold text-ink">{universe.name}</span>
				<Button href={resolve(`/settings/export/${universe.slug}`)} variant="secondary" size="sm">
					{t.export.downloadButton}
				</Button>
			</li>
		{/each}
	</ul>
{/if}
