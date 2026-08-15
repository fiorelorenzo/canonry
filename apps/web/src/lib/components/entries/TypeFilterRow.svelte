<script lang="ts">
	/**
	 * Issue #145 (I7 = C): "a type filter row with real counts". Same chip look as
	 * `proposals/TypeFilterChips.svelte`, but these are links, not buttons - filtering
	 * happens server side against Postgres (the issue's own instruction, distinct from
	 * the review queue's client-side bucket split), so a click is a normal navigation to
	 * `?type=...`, which also makes a filtered view bookmarkable and back-button safe.
	 *
	 * Deliberately five types, not six: 'session' has no create path anywhere in the
	 * product yet (grep confirms it - the only inserts are test fixtures), so it never
	 * earns a chip. It still shows up under "All" and through search, so it stays
	 * reachable per the issue's own acceptance line.
	 */
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { EntityType } from '@canonry/db/schema';
	import type { Messages } from '$lib/i18n';

	const BROWSABLE_TYPES: EntityType[] = ['character', 'place', 'faction', 'event', 'item'];

	let {
		universeSlug,
		counts,
		totalCount,
		selected,
		query,
		t
	}: {
		universeSlug: string;
		counts: Partial<Record<EntityType, number>>;
		totalCount: number;
		selected: EntityType | null;
		query: string;
		t: Messages['universe']['index']['filters'];
	} = $props();

	// `SvelteURLSearchParams` rather than the built-in: this app's eslint config forbids the
	// mutable global in a component, since a plain URLSearchParams mutated during render would
	// not be tracked. It is thrown away immediately either way.
	function hrefFor(type: EntityType | null): string {
		const params = new SvelteURLSearchParams();
		if (type) params.set('type', type);
		if (query) params.set('q', query);
		const qs = params.toString();
		return qs ? `${resolve(`/u/${universeSlug}`)}?${qs}` : resolve(`/u/${universeSlug}`);
	}
</script>

<div class="flex flex-wrap items-center gap-2" role="group" aria-label={t.all}>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefFor() builds on resolve()
	     and appends a query string, which the rule cannot see through. -->
	<a
		href={hrefFor(null)}
		class="rounded-full border px-3 py-1 font-mono text-xs"
		class:border-ink={selected === null}
		class:bg-ink={selected === null}
		class:text-panel={selected === null}
		class:border-line-2={selected !== null}
		class:text-ink-2={selected !== null}
		aria-current={selected === null ? 'page' : undefined}
	>
		{t.all}
		{totalCount}
	</a>
	{#each BROWSABLE_TYPES as type (type)}
		<a
			href={hrefFor(type)}
			class="rounded-full border px-3 py-1 font-mono text-xs"
			class:border-ink={selected === type}
			class:bg-ink={selected === type}
			class:text-panel={selected === type}
			class:border-line-2={selected !== type}
			class:text-ink-2={selected !== type}
			aria-current={selected === type ? 'page' : undefined}
		>
			{t.typeLabel(type)}
			{counts[type] ?? 0}
		</a>
	{/each}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</div>
