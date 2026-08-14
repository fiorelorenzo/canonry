<script lang="ts">
	/**
	 * Issue #75: "who is this" while a player waits. Every keystroke fetches
	 * `/table/search`, which answers from the instant lane (indexed name/alias query) and
	 * only reaches for the fast lane (Qdrant) when the exact match misses - the response
	 * says which lane answered and how long it took, rendered here rather than hidden,
	 * because #75's acceptance is a number to quote, not a claim.
	 */
	import { resolve } from '$app/paths';
	import type { EntitySearchHit } from '@canonry/db';
	import type { SearchHit } from './types';

	let { universeSlug }: { universeSlug: string } = $props();

	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let lane = $state<'instant' | 'fast' | null>(null);
	let elapsedMs = $state<number | null>(null);
	let fastLaneNote = $state<string | null>(null);
	let loading = $state(false);
	let requestSeq = 0;

	async function runSearch(q: string) {
		const seq = ++requestSeq;
		if (q.trim().length === 0) {
			hits = [];
			lane = null;
			elapsedMs = null;
			fastLaneNote = null;
			return;
		}
		loading = true;
		const start = performance.now();
		const response = await fetch(`/u/${universeSlug}/table/search?q=${encodeURIComponent(q)}`);
		const clientElapsedMs = Math.round((performance.now() - start) * 100) / 100;
		if (seq !== requestSeq) return; // a later keystroke's response already landed
		loading = false;
		if (!response.ok) return;
		const body = (await response.json()) as {
			lane: 'instant' | 'fast';
			hits: EntitySearchHit[];
			elapsedMs?: number;
			instantElapsedMs?: number;
			fastElapsedMs?: number;
			unavailableReason?: string;
		};
		lane = body.lane;
		hits = body.hits ?? [];
		elapsedMs =
			body.lane === 'instant'
				? (body.elapsedMs ?? clientElapsedMs)
				: (body.fastElapsedMs ?? clientElapsedMs);
		fastLaneNote = body.unavailableReason ?? null;
	}

	let debounceHandle: ReturnType<typeof setTimeout> | undefined;
	function onInput() {
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(() => runSearch(query), 120);
	}
</script>

<div class="flex flex-col gap-2">
	<label
		for="table-instant-search"
		class="font-mono text-[10px] tracking-wide text-muted uppercase"
	>
		Who is this?
	</label>
	<input
		id="table-instant-search"
		type="text"
		bind:value={query}
		oninput={onInput}
		placeholder="Type a name or alias..."
		class="w-full rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink"
		autocomplete="off"
	/>

	{#if query.trim().length > 0}
		<div class="flex items-center gap-2 text-xs text-muted">
			{#if loading}
				<span>searching…</span>
			{:else if lane}
				<span class="rounded-full bg-panel-2 px-2 py-0.5 font-mono">
					{lane} lane &middot; {elapsedMs}ms
				</span>
			{/if}
		</div>

		{#if !loading && hits.length === 0}
			<p class="text-sm text-muted">
				{fastLaneNote ?? `No match for "${query}".`}
			</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each hits as hit ('id' in hit ? hit.id : hit.url)}
					{#if 'id' in hit}
						<li class="rounded-md border border-line bg-panel p-2.5 text-sm">
							<a
								href={resolve(`/u/${universeSlug}/e/${hit.slug}`)}
								class="font-semibold text-ink hover:underline"
							>
								{hit.name}
							</a>
							<span class="ml-1.5 text-xs text-muted">{hit.type}</span>
							{#if hit.matchedAlias}
								<span class="ml-1.5 text-xs text-muted">aka {hit.matchedAlias}</span>
							{/if}
							{#if hit.excerpt}
								<p class="mt-1 text-xs text-ink-2">{hit.excerpt}</p>
							{/if}
						</li>
					{:else}
						<li class="rounded-md border border-line bg-panel p-2.5 text-sm">
							<span class="font-semibold text-ink">{hit.title}</span>
							<span class="ml-1.5 text-xs text-muted">{hit.breadcrumb}</span>
							<p class="mt-1 text-xs text-ink-2">{hit.excerpt}</p>
						</li>
					{/if}
				{/each}
			</ul>
		{/if}
	{/if}
</div>
