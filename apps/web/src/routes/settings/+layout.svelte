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
	 */
	import type { Snippet } from 'svelte';
	import SettingsNav from '$lib/components/account/SettingsNav.svelte';
	import SettingsShell from '$lib/components/settings/SettingsShell.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<SettingsShell>
	{#snippet rail()}
		<SettingsNav />
	{/snippet}
	{@render children()}
</SettingsShell>
