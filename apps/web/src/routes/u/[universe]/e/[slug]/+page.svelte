<script lang="ts">
	/**
	 * The entry read view, B1 = C: a document plus a right column that switches between
	 * Relations, Facts, Images and History.
	 */
	import { resolve } from '$app/paths';
	import EntryProse from '$lib/components/entry/EntryProse.svelte';
	import EntryTabs from '$lib/components/entry/EntryTabs.svelte';
	import type { FactRow } from '$lib/components/entry/FactsPanel.svelte';
	import type { FactSpan } from '$lib/markdown';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let activeFact = $state<FactRow | null>(null);

	function toggleFact(fact: FactRow): void {
		activeFact = activeFact?.id === fact.id ? null : fact;
	}

	let highlightSpan = $derived<FactSpan | null>(
		activeFact ? { start: activeFact.spanStart, end: activeFact.spanEnd } : null
	);
</script>

<svelte:head><title>{data.entity.name} &middot; {data.universe.name}</title></svelte:head>

<div class="flex flex-col md:flex-row">
	<article class="min-w-0 flex-1 px-6 py-8 md:px-10">
		<p class="mb-3 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/u/${data.universe.slug}`)}>{data.universe.name}</a>
			/ {data.entity.type} /
			<span class="text-ink-2">{data.entity.name}</span>
		</p>

		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<h1 class="mb-1 text-3xl font-semibold text-ink">{data.entity.name}</h1>
				<p class="flex flex-wrap items-center gap-2 text-sm text-muted">
					<span class="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-xs text-accent-ink">
						{data.entity.type}
					</span>
					{#if data.entity.aliases.length > 0}
						<span>also: {data.entity.aliases.join(', ')}</span>
					{/if}
				</p>
			</div>
			<a
				href={resolve(`/u/${data.universe.slug}/e/${data.entity.slug}/edit`)}
				class="flex-none rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
			>
				Edit
			</a>
		</div>

		<EntryProse
			body={data.entity.body}
			universeSlug={data.universe.slug}
			mentionTargets={data.mentionTargets}
			{highlightSpan}
		/>
	</article>

	<EntryTabs
		universeSlug={data.universe.slug}
		relations={data.relations}
		facts={data.facts}
		history={data.history}
		activeFactId={activeFact?.id ?? null}
		onFactToggle={toggleFact}
	/>
</div>
