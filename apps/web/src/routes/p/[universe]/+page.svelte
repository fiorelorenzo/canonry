<script lang="ts">
	/**
	 * V7 (DECISIONS.md, round seventeen): only what the party has revealed is listed here.
	 * An unrevealed entity used to appear as a greyed-out row naming it; that published the
	 * shape of the world before anyone at the table had heard of it, which is the one thing
	 * a players' wiki must not do. A gap page for an unrevealed entity is still reachable by
	 * its own URL (E7) - a mention inside revealed prose still links to it - it is just not
	 * enumerated for browsing. At the start of a campaign this list is honestly empty.
	 *
	 * Issue #127: `t` is chrome, in the visitor's negotiated `data.locale` - the entity
	 * `name`s below are canon, never touched by it (SPEC.md §17's third rule: an entry's
	 * own language is not the reader's to overrule).
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale));
</script>

<svelte:head><title>{t.players.indexTitle} &middot; {data.universe.name}</title></svelte:head>

<PageHeader title={t.players.indexTitle} description={t.players.indexSubtitle} />
<PageBody width="reading">
	{#if data.entities.length === 0}
		<EmptyState kind="cold" message={t.players.emptyState} />
	{:else}
		<ul class="divide-y divide-line">
			{#each data.entities as row (row.id)}
				<li class="flex items-center gap-3 py-3">
					<a
						href={resolve(`/p/${data.universe.slug}/${row.slug}`)}
						class="text-base font-medium text-ink hover:text-accent"
					>
						{row.name}
					</a>
					<span class="text-xs tracking-wide text-muted uppercase">{row.type}</span>
				</li>
			{/each}
		</ul>
	{/if}
</PageBody>
