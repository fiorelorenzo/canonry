<script lang="ts">
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale).settings);
</script>

<svelte:head>
	<title>{t.export.title}: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-measure px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">{t.backToUniverses}</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">{t.export.title}</h1>
	<p class="mt-2 text-sm text-ink-2">
		{t.export.para1Before}<code class="text-ink">[[Name]]</code>{t.export.para1After}
	</p>
	<p class="mt-2 text-sm text-ink-2">
		{t.export.para2Before}<code class="text-ink">visibility</code>{t.export.para2After}
	</p>

	{#if data.universes.length === 0}
		<p class="mt-8 text-sm text-ink-2">{t.export.emptyState}</p>
	{:else}
		<ul class="mt-8 flex flex-col gap-3">
			{#each data.universes as universe (universe.id)}
				<li
					class="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
				>
					<span class="font-semibold text-ink">{universe.name}</span>
					<a
						href={resolve(`/settings/export/${universe.slug}`)}
						class="rounded-md border border-line px-3 py-1.5 text-sm text-accent hover:border-accent"
					>
						{t.export.downloadButton}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
