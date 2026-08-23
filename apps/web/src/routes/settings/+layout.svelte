<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { messages, type Locale } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import SettingsNav from '$lib/components/account/SettingsNav.svelte';
	import SettingsShell from '$lib/components/settings/SettingsShell.svelte';

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
	 * It carries no class of its own, so it changes no offset: the band below is still
	 * the first thing rendered and still lands where every other route's does.
	 *
	 * Round seventeen (V1 = B, #494): every route opens with one `Page` band
	 * whose h1 must land at the same pixel offset everywhere - which only holds if
	 * nothing *positions* the band. A leaf nested inside `SettingsShell`'s rail+content
	 * flex row cannot supply that band itself: rendered inside the row, its h1 would sit
	 * shifted right by the rail's width, and SvelteKit gives a layout no way to
	 * receive a snippet from its own page beyond `children`. So the header lives
	 * here, above `SettingsShell`, keyed off the stable per-leaf `page.route.id`
	 * rather than six leaves each supplying a duplicate header of their own.
	 */
	let { children }: { children: Snippet } = $props();

	const data = $derived(page.data as { locale: Locale });
	const t = $derived(messages(data.locale).settings);
	const HEADERS = $derived<Record<string, { title: string; description?: string }>>({
		'/settings/account': { title: t.account.title, description: t.account.description },
		'/settings/appearance': { title: t.appearance.title, description: t.appearance.description },
		'/settings/billing': { title: t.billing.title, description: t.billing.description },
		'/settings/export': { title: t.export.title },
		'/settings/keys': { title: t.keys.title },
		'/settings/language': { title: t.language.title, description: t.language.description }
	});
	const header = $derived(HEADERS[page.route.id ?? ''] ?? { title: '' });
</script>

<svelte:element
	this={page.data.user ? 'div' : 'main'}
	id={page.data.user ? undefined : 'main'}
	class={page.data.user ? undefined : 'px-4 md:px-8'}
>
	<Page width="working" title={header.title} description={header.description}>
		<SettingsShell>
			{#snippet rail()}
				<SettingsNav />
			{/snippet}
			{@render children()}
		</SettingsShell>
	</Page>
</svelte:element>
