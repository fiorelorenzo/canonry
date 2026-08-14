<script lang="ts">
	/**
	 * Decision E7's index: every revealable entity, `gm_only` never listed, a gap row
	 * reachable by browsing just like a full one (the E7 artifact's own cost note on option
	 * C: a gap page is reached "by search", not only by following a mention).
	 */
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.entities.length} entries &middot; players' wiki</title></svelte:head>

<h1 class="mb-1 text-2xl font-semibold text-ink">Everything the table has touched</h1>
<p class="mb-8 max-w-measure text-sm text-ink-2">
	If it came up at the table, it is here. A name in grey has been heard but not yet explored.
</p>

{#if data.entities.length === 0}
	<p class="text-sm text-muted">Nothing has been said aloud yet.</p>
{:else}
	<ul class="divide-y divide-line">
		{#each data.entities as row (row.id)}
			<li class="flex items-center gap-3 py-3">
				<a
					href={resolve(`/p/${data.universe.slug}/${row.slug}`)}
					class="text-base font-medium hover:text-accent"
					class:text-ink={row.status === 'full'}
					class:text-muted={row.status === 'gap'}
				>
					{row.name}
				</a>
				<span class="text-xs tracking-wide text-muted uppercase">{row.type}</span>
				<span class="flex-1"></span>
				{#if row.status === 'gap'}
					<span class="text-xs text-muted italic">not yet discovered</span>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
