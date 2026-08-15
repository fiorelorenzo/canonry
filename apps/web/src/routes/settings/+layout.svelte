<script lang="ts">
	/**
	 * Issue #143 (I6 = B): the settings page's shared frame - a left sub-nav plus the
	 * six leaves as panes, replacing "five islands, no index" (docs/ux/product-pass.
	 * html#i6). No `<main>` of its own: `AppShell` (#141) already owns that landmark on
	 * the root layout, and every leaf below used to open with its own
	 * `<main id="main">` plus a "← Universes" back link pointed at a screen the
	 * sidebar already reaches from anywhere - both removed rather than duplicated once
	 * per pane.
	 */
	import type { Snippet } from 'svelte';
	import SettingsNav from '$lib/components/account/SettingsNav.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="flex flex-col gap-8 lg:flex-row lg:gap-10">
	<SettingsNav />
	<div class="min-w-0 flex-1">
		{@render children()}
	</div>
</div>
