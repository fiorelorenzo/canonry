<script lang="ts">
	/**
	 * Issue #450 (U1, DECISIONS.md "Round sixteen"): the three-group rail issue #406 (S1,
	 * "Round fourteen") built inline in `settings/+page.svelte`, pulled out once the
	 * relation catalogue needed the exact same list a second time - as a leaf of its own,
	 * one level deeper, rather than a fragment on that page (#421's shell already holds
	 * "Canon"; this leaf is that group's own page). `SettingsShell`'s own doc comment
	 * says a universe's rail is same-page anchors, and that stays true here: a leaf below
	 * the settings page passes `href`s that point back at it (`/w/<slug>/settings#group-
	 * x`) rather than switching to real routing the way the account's `SettingsNav` does.
	 *
	 * `active` is the one thing a leaf adds over the settings page's own copy: which row
	 * names the group this leaf belongs to, marked the same way `SettingsNav` marks the
	 * account's current route (`page.url.pathname === item.href`) - except a same-page
	 * anchor's own url never changes across groups, so there is no url to compare and
	 * this takes the answer as a prop instead. The settings page itself passes no
	 * `active`: every group is equally "not the current leaf" from there.
	 */
	interface RailItem {
		id: 'images' | 'loremaster' | 'canon';
		href: string;
		label: string;
		unset: boolean;
	}

	let {
		ariaLabel,
		incompleteMark,
		items,
		active
	}: {
		ariaLabel: string;
		incompleteMark: string;
		items: RailItem[];
		active?: RailItem['id'];
	} = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- a same-page fragment anchor,
     or a leaf's own absolute link back into one, is never something resolve() can
     rewrite. -->
<nav aria-label={ariaLabel} class="flex shrink-0 flex-col gap-0.5 lg:w-48">
	{#each items as item (item.id)}
		<a
			href={item.href}
			class="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-panel-2"
			class:font-semibold={item.id === active}
			class:text-ink={item.id === active}
			class:text-ink-2={item.id !== active}
			aria-current={item.id === active ? 'true' : undefined}
		>
			<span>{item.label}</span>
			{#if item.unset}
				<span
					class="shrink-0 rounded-full bg-warn-bg px-1.5 py-0.5 text-label font-medium text-warn"
				>
					{incompleteMark}
				</span>
			{/if}
		</a>
	{/each}
</nav>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
