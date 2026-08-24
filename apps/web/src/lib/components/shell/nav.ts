/**
 * A2 = A (docs/design/DECISIONS.md): "fixed sidebar, universe switcher on top, capped at
 * seven items." A2's own drawn option (A), in git history at c84c8f8, draws
 * exactly these seven as the nav proper, with the switcher pinned above and explicitly
 * *not* counted against the cap: "a full-height text nav, all seven places listed, the
 * switcher pinned above it."
 *
 * Counted by hand before shipping this list: Entries, Works, Proposals, Table,
 * Players, Import, Settings is seven, not eight. Nothing here needed folding into the
 * switcher or nested under Settings; the list ships exactly as the artifact draws it.
 * Settings now resolves to the per-universe settings page (issue #107's "Stop writing"
 * switch, issue #19's precedence panel) rather than the account-wide appearance page -
 * that page is still reachable, linked from the universe settings page itself, since
 * A2 gives this nav item to "this universe", not to the account.
 *
 * Round thirteen R11: this used to carry a `built` flag, false for Players and Import,
 * that still drew a link - "a `built: false` flag that still draws a link is not a
 * guard, it is a comment." Both destinations are real pages now, so the flag is gone
 * rather than left false and unread.
 */
export interface NavItem {
	id: 'entries' | 'works' | 'proposals' | 'table' | 'players' | 'import' | 'settings';
	label: string;
	href: (universeSlug: string) => `/w/${string}`;
	/** Nearest roadmap issue for this destination, not necessarily a page-specific
	 * ticket: the board has not filed one for every destination's UI yet. */
	issue: number;
}

export const NAV_ITEMS: readonly NavItem[] = [
	// O1 = C (#283): `/w/<slug>` is the world home now and the browser lives one level down, so
	// this item points at the table and the world switcher keeps the home. Both used to point
	// here, which was fine while the two were the same page and is a fork in the road now.
	{
		id: 'entries',
		label: 'Entries',
		href: (slug) => `/w/${slug}/entries`,
		issue: 283
	},
	{ id: 'works', label: 'Works', href: (slug) => `/w/${slug}/works`, issue: 20 },
	{
		id: 'proposals',
		label: 'Proposals',
		href: (slug) => `/w/${slug}/proposals`,
		issue: 51
	},
	{ id: 'table', label: 'Table', href: (slug) => `/w/${slug}/table`, issue: 72 },
	{
		id: 'players',
		label: 'Players',
		href: (slug) => `/w/${slug}/players`,
		issue: 82
	},
	{ id: 'import', label: 'Import', href: (slug) => `/w/${slug}/import`, issue: 26 },
	{
		id: 'settings',
		label: 'Settings',
		href: (slug) => `/w/${slug}/settings`,
		issue: 107
	}
];

/**
 * Issue #141, I3 = B: the sidebar's other shape, when no universe is selected. Three
 * places rather than seven - "the account's own places, Universes, Settings, Docs" -
 * and no counts, since none of them are per-universe totals. Settings has no index
 * route of its own yet (that is #143's two-pane page), so this points at the same
 * appearance leaf the old root page's lone settings link used.
 */
export interface AccountNavItem {
	id: 'universes' | 'settings' | 'docs';
	label: string;
	href: '/' | '/settings/appearance' | '/docs';
}

export const ACCOUNT_NAV_ITEMS: readonly AccountNavItem[] = [
	{ id: 'universes', label: 'Universes', href: '/' },
	{ id: 'settings', label: 'Settings', href: '/settings/appearance' },
	{ id: 'docs', label: 'Docs', href: '/docs' }
];
