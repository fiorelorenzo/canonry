<script lang="ts">
	import { resolve } from '$app/paths';
	import EntryProse from '$lib/components/entry/EntryProse.svelte';
	import GapNotice from '$lib/components/players/GapNotice.svelte';
	import PublicFactsList from '$lib/components/players/PublicFactsList.svelte';
	import PublicRelationsList from '$lib/components/players/PublicRelationsList.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.entity.name} &middot; {data.universe.name}</title></svelte:head>

<p class="mb-3 text-xs text-muted">
	<a class="hover:underline" href={resolve(`/p/${data.universe.slug}`)}>{data.universe.name}</a>
	/ {data.entity.type} /
	<span class="text-ink-2">{data.entity.name}</span>
</p>

<div class="mb-6">
	<h1 class="mb-1 text-3xl font-semibold text-ink">{data.entity.name}</h1>
	<p class="flex flex-wrap items-center gap-2 text-sm text-muted">
		<span class="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-xs text-accent-ink">
			{data.entity.type}
		</span>
		{#if data.entity.status === 'full'}
			<span>
				revealed{data.entity.revealedInSession ? ` \u00b7 ${data.entity.revealedInSession}` : ''}
			</span>
		{:else}
			<span>not yet discovered</span>
		{/if}
	</p>
</div>

{#if data.entity.status === 'gap'}
	<GapNotice name={data.entity.name} type={data.entity.type} />
{:else}
	<EntryProse
		body={data.entity.body}
		universeSlug={data.universe.slug}
		mentionTargets={data.mentionTargets}
	/>
	<PublicFactsList facts={data.entity.facts} />
	<PublicRelationsList relations={data.entity.relations} universeSlug={data.universe.slug} />
{/if}
