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

	/** Issue #438, decision T11, narrowed by round eighteen: the bottom-of-viewport
	 * exclusion zone `main` reserves is **the launcher's band, never the open panel's**.
	 *
	 * T11 said the shell reserves the dock's height so nothing real is ever underneath it,
	 * and #488 made that reserve come out of `main`'s own box rather than out of its
	 * scrollable content, which was right for the launcher and wrong for the panel: the
	 * panel grows to `max-h-[70vh]`, so opening it took up to seventy per cent of the
	 * viewport out of the scrollport and the page visibly *cut* instead of being covered.
	 * Lorenzo's words, from the deployed preview: "quando si apre il dock del loremaster è
	 * come se tagliasse il contenuto della pagina al posto che starci sopra".
	 *
	 * The distinction is what the reserve is for. The launcher is always there and nobody
	 * asked for it, so content underneath it would be content the reader cannot reach
	 * without moving something they did not put there. The panel is transient, dismissible
	 * and deliberately opened, which is exactly the case where covering is the expected
	 * behaviour: it is how every dialog and every chat panel in the world behaves, and the
	 * reader closes it. So QuickAsk's panel publishes no height at all now, and the
	 * launcher's own band stays reserved while the panel is open so the page does not jump
	 * a hundred pixels each time it opens (`QuickAsk.svelte` holds that value). */
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
			<!-- Issue #438, decision T11, and issue #488 which finished it: the reserve
			     used to be `padding-bottom` on this scroll container, which only lengthens
			     the *content* that overflows, so it protected the very end of the document
			     (you could always scroll far enough to clear the dock) without protecting
			     anything in between. `main` is a flex item whose own rendered box already
			     fills "remaining space after the sidebar/PhoneNav", full viewport height on
			     any route long enough to scroll - the dock is `position: fixed`, so at any
			     scroll position some row of content shares the same screen rectangle as its
			     opaque band, and padding at the tail of the scrollable content never moves
			     that rectangle. `margin-bottom` does: a flex item's outer size (content +
			     padding + margin) is what flex-grow distributes the container's height
			     across, so this margin comes out of `main`'s own content box, and the box
			     that clips `overflow-y-auto` - the actual scrollport - ends `dockReserve`px
			     above the real viewport bottom at every scroll position, not only the last
			     one. Nothing inside `main` can ever be laid out under the dock's band
			     because that band is no longer part of `main`'s box at all; the gap below it
			     shows the shell's own `bg-paper`, which is what already sits behind the dock
			     everywhere else, so the reserve reads as intentional space rather than a
			     clipped page. `p-4`/`md:p-8` go back to being exactly the page's own gutter,
			     unchanged by whether the dock is mounted, since the box no longer needs to
			     borrow the gutter's calc to also carry the dock. -->
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
			<!-- Round eighteen: no top padding here, on purpose. V1's header band is
			     `position: sticky; top: 0`, and sticky offsets resolve against the
			     scrollport's *padding* box, so a `pt-8` on this element parked the band 32px
			     down from the scrollport's edge and left a 32px strip above it that scrolled
			     content passed straight through. On the entries table that showed a sliver
			     of a row above the page title; on the players page it showed the whole
			     "open the players' wiki" button sitting over the header. Lorenzo saw both on
			     the preview: "il contenuto delle pagine a volte finisce sopra l'header
			     sticky". The gutter moved into `PageHeader` itself, which bleeds it back out
			     horizontally, so the band's own paper starts at the scrollport's edge and
			     there is nothing above it to see through. Every route inside this shell
			     opens with that band (V1 = B, and `page-header-offset.test.ts` is what keeps
			     it true), so no route loses its top gutter by this. -->
			<main
				id="main"
				tabindex="0"
				class="mb-[var(--dock-reserve,0px)] min-w-0 flex-1 overflow-y-auto px-4 pb-4 md:px-8 md:pb-8"
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
