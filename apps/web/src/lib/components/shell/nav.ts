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
 * Only Entries (this universe's home, #104) and Settings (appearance, #104) resolve to
 * a real page this wave; Works, Proposals, Table, Players and Import are linked to
 * their eventual address per A2's own reasoning for Import ("needs an address that
 * survives past day one rather than a wizard that vanishes after first run") and 404
 * until the issue noted below ships the page.
 */
export interface NavItem {
	id: 'entries' | 'works' | 'proposals' | 'table' | 'players' | 'import' | 'settings';
	label: string;
	href: (universeSlug: string) => `/u/${string}` | '/settings/appearance';
	built: boolean;
	/** Nearest roadmap issue for this destination, not necessarily a page-specific
	 * ticket: the board has not filed one for every destination's UI yet. */
	issue: number;
}

export const NAV_ITEMS: readonly NavItem[] = [
	{ id: 'entries', label: 'Entries', href: (slug) => `/u/${slug}`, built: true, issue: 104 },
	{ id: 'works', label: 'Works', href: (slug) => `/u/${slug}/works`, built: false, issue: 20 },
	{
		id: 'proposals',
		label: 'Proposals',
		href: (slug) => `/u/${slug}/proposals`,
		built: false,
		issue: 47
	},
	{ id: 'table', label: 'Table', href: (slug) => `/u/${slug}/table`, built: false, issue: 72 },
	{
		id: 'players',
		label: 'Players',
		href: (slug) => `/u/${slug}/players`,
		built: false,
		issue: 82
	},
	{ id: 'import', label: 'Import', href: (slug) => `/u/${slug}/import`, built: false, issue: 26 },
	{ id: 'settings', label: 'Settings', href: () => '/settings/appearance', built: true, issue: 104 }
];
