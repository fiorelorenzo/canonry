<script lang="ts">
	/**
	 * Issue #75: "who is this" while a player waits. Every keystroke fetches
	 * `/table/search`, which answers from the instant lane (indexed name/alias query) and
	 * only reaches for the fast lane (Qdrant) when the exact match misses - the response
	 * says which lane answered and how long it took, rendered here rather than hidden,
	 * because #75's acceptance is a number to quote, not a claim.
	 */
	import { resolve } from '$app/paths';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import type { EntitySearchHit } from '@canonry/db';
	import { messages, type Locale } from '$lib/i18n';
	import type { SearchHit } from './types';

	let { universeSlug, locale }: { universeSlug: string; locale: Locale } = $props();

	const t = $derived(messages(locale).table.instantSearch);

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
		{t.whoIsThis}
	</label>
	<Input
		id="table-instant-search"
		type="text"
		bind:value={query}
		oninput={onInput}
		placeholder={t.placeholder}
		class="bg-panel-2"
		autocomplete="off"
	/>

	{#if query.trim().length > 0}
		<div class="flex items-center gap-2 text-xs text-muted">
			{#if loading}
				<span>{t.searching}</span>
			{:else if lane}
				<Badge variant="secondary" class="font-mono">
					{t.laneStatus(lane === 'instant' ? t.instantLane : t.fastLane, elapsedMs ?? 0)}
				</Badge>
			{/if}
		</div>

		{#if !loading && hits.length === 0}
			<p class="text-sm text-muted">
				{fastLaneNote ?? t.noMatch(query)}
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
								<span class="ml-1.5 text-xs text-muted">{t.aka(hit.matchedAlias)}</span>
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
