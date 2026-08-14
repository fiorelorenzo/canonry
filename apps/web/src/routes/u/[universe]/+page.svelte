<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.current.name} — Canonry</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-8 py-10">
	<header>
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-semibold text-ink">{data.current.name}</h1>
			<span
				class="rounded-full border border-line-2 px-2 py-0.5 text-xs tracking-wide text-muted uppercase"
			>
				{data.current.kind}
			</span>
		</div>
		{#if data.current.baseUniverseName}
			<p class="mt-2 max-w-measure text-sm text-ink-2">
				Derived: reads its own canon plus <b class="text-ink">{data.current.baseUniverseName}</b>'s
				indexed corpus, read-only. Your canon always wins (SPEC.md 4.1).
			</p>
		{/if}
	</header>

	<section class="mt-8">
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">Recent entries</h2>
		{#if data.recentEntries.length === 0}
			<p class="mt-2 text-sm text-ink-2">Nothing here yet.</p>
		{:else}
			<ul class="mt-3 flex flex-col divide-y divide-line">
				{#each data.recentEntries as entry (entry.id)}
					<li class="py-3">
						<a
							href={resolve(`/u/${data.current.slug}/e/${entry.slug}`)}
							class="text-base font-medium text-ink hover:text-accent"
						>
							{entry.name}
						</a>
						<span class="ml-2 text-xs tracking-wide text-muted uppercase">{entry.type}</span>
						{#if entry.excerpt}
							<p class="mt-1 max-w-measure text-sm text-ink-2">{entry.excerpt}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
