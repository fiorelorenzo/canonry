<script lang="ts">
	/**
	 * A2 = A: the fixed left sidebar every screen inside a universe sits beside.
	 * Universe switcher on top, then the capped nav (see nav.ts), then Recent.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { NAV_ITEMS } from './nav';
	import UniverseSwitcher from './UniverseSwitcher.svelte';
	import type { RecentEntity, UniverseSummary } from './types';

	let {
		universeSlug,
		current,
		universes,
		recent,
		entryCount,
		proposalsPending
	}: {
		universeSlug: string;
		current: UniverseSummary;
		universes: UniverseSummary[];
		recent: RecentEntity[];
		entryCount: number;
		proposalsPending: number;
	} = $props();

	// C2 = A: a quiet, persistent nav badge. Entries carries the same real count it always
	// has; Proposals now reads a real pending-proposal count too (#47/#51 land the table
	// and the review surface), zero when the inbox is empty rather than hidden - a settled
	// day should visibly say so, not just omit the number.
	const counts: Partial<Record<(typeof NAV_ITEMS)[number]['id'], number>> = $derived({
		entries: entryCount,
		proposals: proposalsPending
	});
</script>

<aside
	class="flex h-screen w-64 flex-none flex-col overflow-y-auto border-r border-line bg-panel"
	aria-label="Universe navigation"
>
	<div class="border-b border-line p-3">
		<UniverseSwitcher {current} {universes} />
		<a
			href={resolve(`/u/${universeSlug}/ask`)}
			class="mt-2 flex items-center gap-2 rounded-md border border-ai-line bg-ai-bg px-2.5 py-1.5 text-sm text-ai hover:opacity-90"
		>
			<span aria-hidden="true">✦</span>
			<span>Ask the Loremaster</span>
			<span class="ml-auto font-mono text-[10px] text-muted">⌘⇧A</span>
		</a>
	</div>

	<nav class="flex-1 p-2" aria-label="Primary">
		<ul class="flex flex-col gap-0.5">
			{#each NAV_ITEMS as item (item.id)}
				{@const href = resolve(item.href(universeSlug))}
				{@const active = page.url.pathname === href}
				<li>
					<a
						{href}
						class="flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-panel-2"
						class:text-ink={active}
						class:font-semibold={active}
						class:text-ink-2={!active}
						title={item.built ? undefined : `Not built yet, issue #${item.issue}`}
					>
						<span>{item.label}</span>
						{#if counts[item.id] !== undefined}
							<span
								class="rounded-full bg-panel-2 px-1.5 py-0.5 text-xs text-muted"
								class:bg-accent-bg={active}
							>
								{counts[item.id]}
							</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>

		{#if recent.length > 0}
			<div class="mt-5">
				<h2 class="px-2.5 text-xs font-semibold tracking-wide text-muted uppercase">Recent</h2>
				<ul class="mt-1 flex flex-col gap-0.5">
					{#each recent as entry (entry.id)}
						<li>
							<a
								href={resolve(`/u/${universeSlug}/e/${entry.slug}`)}
								class="block truncate rounded-md px-2.5 py-1 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink"
							>
								{entry.name}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</nav>
</aside>
