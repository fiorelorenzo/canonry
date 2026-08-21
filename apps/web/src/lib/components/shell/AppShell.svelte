<script lang="ts">
	/**
	 * Issue #141 (I3 = B): the shell for the whole product, not only a universe. Reads
	 * `page.data` from `$app/state` directly rather than props threaded down from the
	 * root layout - SvelteKit already merges every ancestor layout's load data onto
	 * `page.data`, so `w/[universe]/+layout.server.ts`'s `current`/`universeSlug`/
	 * `recent`/`navCounts` show up here for free on any route nested under a universe,
	 * and are simply absent everywhere else. That absence is the mode switch: no
	 * store, no context, no prop drilling.
	 *
	 * Three renders, not two:
	 * - Signed out: pass-through, zero chrome. The door page (`routes/+page.svelte`)
	 *   and the auth pages (#139) each build their own frame; nothing here to double
	 *   up with.
	 * - Signed in, `current` present: universe mode, A2's original sidebar.
	 * - Signed in, `current` absent: account mode, this issue's new one.
	 *
	 * The public players' wiki (`routes/p/**`, decision E7) is a fourth case that is
	 * not a mode of this component at all - it keeps its own light chrome regardless
	 * of sign-in state (a GM previewing a share link while signed in still sees the
	 * public chrome, not their own account's), so this passes through unconditionally
	 * on that subtree.
	 */
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import type { Locale } from '$lib/i18n';
	import CommandPalette from '../palette/CommandPalette.svelte';
	import QuickAsk from '../copilot/QuickAsk.svelte';
	import PhoneNav from './PhoneNav.svelte';
	import NavProgressBar from './NavProgressBar.svelte';
	import Sidebar from './Sidebar.svelte';
	import { shellLayoutState } from './shell-layout-state.svelte';
	import type { RecentEntity, ShellQuota, UniverseSetupItem, UniverseSummary } from './types';

	let { children }: { children: Snippet } = $props();

	/** The fields every route's merged `page.data` actually carries, typed locally -
	 * `App.PageData` stays the SvelteKit default (`Record<string, any>`) because most
	 * of these fields are only present on some routes, which is the whole point of the
	 * mode switch below and not something a single global interface should paper over. */
	interface ShellPageData {
		user: { id: string; name: string; email: string } | null;
		locale: Locale;
		universes: UniverseSummary[];
		current?: UniverseSummary;
		universeSlug?: string;
		recent?: RecentEntity[];
		navCounts?: { entries: number; proposals: number };
		/** Issue #379, decision R4: present only under `/w/[universe]` - `?? []` reads
		 * the same as an empty universe layout, and Sidebar/PhoneNav both already treat
		 * an empty list as "nothing to warn about". */
		setupItems?: UniverseSetupItem[];
		shellQuota: ShellQuota | null;
	}

	const data = $derived(page.data as ShellPageData);
	const isPublicWiki = $derived(
		page.route.id === '/p' || (page.route.id?.startsWith('/p/') ?? false)
	);

	// Issue #148 (I10 = B): `/w/[universe]/table` already carries its own phone-shaped
	// top strip (`ContextStrip`) and bottom tabs (`PhoneTabBar`, E4's original) -
	// mounting PhoneNav there too would stack two top bars and two tab bars on a
	// 390px screen, exactly the "two navigation patterns at once" this issue rules
	// out. Every other signed-in route gets PhoneNav; this one keeps what it has.
	const isTableMode = $derived(page.route.id === '/w/[universe]/table');

	/** Issue #438, decision T11: the total bottom-of-viewport exclusion zone `main`
	 * reserves so nothing real ever sits under PhoneNav's bar or QuickAsk's own
	 * launcher/panel. Both publishers self-zero when their own chrome is not currently
	 * rendered (`shell-layout-state.svelte.ts`'s own doc comment), including in table
	 * mode, where neither one mounts at all - so this needs no `isTableMode` check of
	 * its own to hold E3 = C's "table mode gets no padding" rule; it holds by
	 * construction. */
	const dockReserve = $derived(shellLayoutState.phoneNavHeight + shellLayoutState.dockHeight);
</script>

{#if isPublicWiki || !data.user}
	{@render children()}
{:else}
	<div class="flex h-screen bg-paper">
		<Sidebar
			mode={data.current ? 'universe' : 'account'}
			universeSlug={data.universeSlug ?? null}
			current={data.current ?? null}
			universes={data.universes}
			recent={data.recent ?? []}
			entryCount={data.navCounts?.entries ?? 0}
			proposalsPending={data.navCounts?.proposals ?? 0}
			setupItems={data.setupItems ?? []}
			locale={data.locale}
			user={data.user}
			quota={data.shellQuota}
		/>
		<div class="flex min-w-0 flex-1 flex-col">
			{#if !isTableMode}
				<PhoneNav
					mode={data.current ? 'universe' : 'account'}
					universeSlug={data.universeSlug ?? null}
					current={data.current ?? null}
					universes={data.universes}
					recent={data.recent ?? []}
					entryCount={data.navCounts?.entries ?? 0}
					proposalsPending={data.navCounts?.proposals ?? 0}
					setupItems={data.setupItems ?? []}
					locale={data.locale}
					user={data.user}
					quota={data.shellQuota}
				/>
			{/if}
			<!-- Issue #438, decision T11: the reserve is `padding-bottom` on the scroll
			     container, not a trailing spacer inside it. A spacer only lengthens the
			     scrollable content, which is enough for a page that ends in prose and not
			     enough for a child that sizes itself to the container: the editor is a
			     full-height column since #420, so with a spacer it still stretched under the
			     dock and the panel sat over the textarea (measured: 59px of overlap at
			     1440x900). Padding shrinks the content box, so a full-height child shrinks
			     with it. Composed with the base padding rather than replacing it, because
			     `p-4`/`md:p-8` are the page's own gutters and this is additional. -->
			<!-- #474: `tabindex="0"` - this region scrolls its own content
			     (`overflow-y-auto`) independently of the document, and axe's
			     `scrollable-region-focusable` rule is right that a reader with no pointer
			     needs a way to reach it: without a tabindex an overflowing `<main>` can
			     never take focus, so arrow/Page Up/Down never has a target. Most routes'
			     content fits the viewport and never overflows, so this adds a tab stop
			     that does nothing on those; only a route long enough to actually scroll
			     (`/admin/metrics`, `/privacy`) makes it do anything. svelte's own linter
			     flags a nonnegative tabindex on a "noninteractive" element, but a landmark
			     that can overflow is exactly axe's documented exception - the two rules
			     disagree here on purpose, not by oversight. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<main
				id="main"
				tabindex="0"
				class="min-w-0 flex-1 overflow-y-auto px-4 pt-4 pb-[calc(1rem+var(--dock-reserve,0px))] md:px-8 md:pt-8 md:pb-[calc(2rem+var(--dock-reserve,0px))]"
				style:--dock-reserve="{dockReserve}px"
			>
				<NavProgressBar />
				{@render children()}
			</main>
		</div>
	</div>
	<CommandPalette
		mode={data.current ? 'universe' : 'account'}
		universeSlug={data.universeSlug ?? null}
		universes={data.universes}
		locale={data.locale}
	/>
	<!-- Issue #285 (decision O3): the floating Loremaster, on every signed-in universe
	     route and nowhere else. Two absences are the decision, not an oversight: account
	     mode has no universe to ask about, and table mode is left alone because E3 = C's
	     two-tier dock already owns that corner (the same reason PhoneNav is skipped
	     there). Below `md` the pill hides itself and PhoneNav's third tab is the
	     launcher. -->
	{#if data.current && data.universeSlug && !isTableMode}
		<QuickAsk
			universeSlug={data.universeSlug}
			universeName={data.current.name}
			universes={data.universes}
			locale={data.locale}
		/>
	{/if}
{/if}
