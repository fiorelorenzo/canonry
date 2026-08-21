<script lang="ts">
	/**
	 * Issue #143 (I6 = B): the settings page's shared frame - a left sub-nav plus the
	 * six leaves as panes, replacing "five islands, no index" (docs/ux/product-pass.
	 * html#i6). No `<main>` of its own: `AppShell` (#141) already owns that landmark on
	 * the root layout, and every leaf below used to open with its own
	 * `<main id="main">` plus a "← Universes" back link pointed at a screen the
	 * sidebar already reaches from anywhere - both removed rather than duplicated once
	 * per pane.
	 *
	 * Issue #406 (S1, DECISIONS.md "Round fourteen"): the two-column div itself moved
	 * to `SettingsShell` (`$lib/components/settings/SettingsShell.svelte`) once the
	 * universe's own settings page needed the same shape - this file now only
	 * supplies the rail's contents for the account (`SettingsNav`).
	 *
	 * Issue #491: "no `<main>` of its own" above is right for a signed-in reader and
	 * wrong for everybody else. None of the six account panes redirects a signed-out
	 * visitor (each `load` returns instead), and `AppShell` only renders its own
	 * landmark once there is a session, so those six rendered with no main landmark at
	 * all. The wrapper below picks whichever tag the shell is not already supplying,
	 * the same conditional #474 used for the dev galleries, so there is always exactly
	 * one. It sits here rather than in `SettingsShell` because a universe's settings
	 * page uses that component too and is behind a real guard, so it never needs this.
	 */
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import SettingsNav from '$lib/components/account/SettingsNav.svelte';
	import SettingsShell from '$lib/components/settings/SettingsShell.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:element this={page.data.user ? 'div' : 'main'} id={page.data.user ? undefined : 'main'}>
	<SettingsShell>
		{#snippet rail()}
			<SettingsNav />
		{/snippet}
		{@render children()}
	</SettingsShell>
</svelte:element>
