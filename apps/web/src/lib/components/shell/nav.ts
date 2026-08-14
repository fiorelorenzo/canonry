/**
 * A2 = A (docs/ux/DECISIONS.md): "fixed sidebar, universe switcher on top, capped at
 * seven items." docs/ux/a2-information-architecture.html's chosen option (A) draws
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
 */
export interface NavItem {
	id: 'entries' | 'works' | 'proposals' | 'table' | 'players' | 'import' | 'settings';
	label: string;
	href: (universeSlug: string) => `/u/${string}`;
	built: boolean;
	/** Nearest roadmap issue for this destination, not necessarily a page-specific
	 * ticket: the board has not filed one for every destination's UI yet. */
	issue: number;
}

export const NAV_ITEMS: readonly NavItem[] = [
	{ id: 'entries', label: 'Entries', href: (slug) => `/u/${slug}`, built: true, issue: 104 },
	{ id: 'works', label: 'Works', href: (slug) => `/u/${slug}/works`, built: true, issue: 20 },
	{
		id: 'proposals',
		label: 'Proposals',
		href: (slug) => `/u/${slug}/proposals`,
		built: true,
		issue: 51
	},
	{ id: 'table', label: 'Table', href: (slug) => `/u/${slug}/table`, built: true, issue: 72 },
	{
		id: 'players',
		label: 'Players',
		href: (slug) => `/u/${slug}/players`,
		built: false,
		issue: 82
	},
	{ id: 'import', label: 'Import', href: (slug) => `/u/${slug}/import`, built: false, issue: 26 },
	{
		id: 'settings',
		label: 'Settings',
		href: (slug) => `/u/${slug}/settings`,
		built: true,
		issue: 107
	}
];
