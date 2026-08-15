/**
 * Issue #149 (A3 = C): the palette's "run an action" result kind - "the nav
 * destinations, New entry, New universe, the settings panes" (the issue's own list).
 * Pure data assembly, kept out of `CommandPalette.svelte` so the mode-conditional
 * wiring is readable and testable on its own.
 *
 * Deep-links to the account-wide settings panes are offered in both modes: a GM
 * mid-universe reaching for "language" or "billing" should not have to leave first,
 * and none of these destinations depend on universe context. `ACCOUNT_NAV_ITEMS`'
 * own generic "Settings" entry is skipped in account mode - the six finer panes below
 * already cover the same destination (`/settings/appearance`) under a real label, and
 * showing both would put two rows on the same href.
 */
import { resolve } from '$app/paths';
import { messages, type Locale } from '$lib/i18n';
import { ACCOUNT_NAV_ITEMS, NAV_ITEMS } from '$lib/components/shell/nav';

export interface PaletteAction {
	id: string;
	label: string;
	href: string;
}

export function paletteActions(
	mode: 'universe' | 'account',
	universeSlug: string | null,
	locale: Locale
): PaletteAction[] {
	const t = messages(locale);
	const actions: PaletteAction[] = [];

	if (mode === 'universe' && universeSlug) {
		for (const item of NAV_ITEMS) {
			actions.push({
				id: `nav-${item.id}`,
				label: t.universe.nav[item.id],
				href: resolve(item.href(universeSlug))
			});
		}
		actions.push({
			id: 'new-entry',
			label: t.universe.index.newEntryAction,
			href: `${resolve(`/w/${universeSlug}`)}?new=entry`
		});
	}

	if (mode === 'account') {
		for (const item of ACCOUNT_NAV_ITEMS) {
			if (item.id === 'settings') continue;
			actions.push({
				id: `account-nav-${item.id}`,
				label: t.shell.sidebar.accountNav[item.id],
				href: resolve(item.href)
			});
		}
	}

	actions.push({
		id: 'new-universe',
		label: t.universe.switcher.newUniverse,
		href: resolve('/onboarding')
	});
	actions.push({
		id: 'settings-account',
		label: t.shell.palette.accountSettingsAction,
		href: resolve('/settings/account')
	});
	actions.push({
		id: 'settings-appearance',
		label: t.settings.appearance.title,
		href: resolve('/settings/appearance')
	});
	actions.push({
		id: 'settings-language',
		label: t.settings.language.title,
		href: resolve('/settings/language')
	});
	actions.push({
		id: 'settings-keys',
		label: t.settings.keys.title,
		href: resolve('/settings/keys')
	});
	actions.push({
		id: 'settings-billing',
		label: t.settings.billing.title,
		href: resolve('/settings/billing')
	});
	actions.push({
		id: 'settings-export',
		label: t.settings.export.title,
		href: resolve('/settings/export')
	});

	return actions;
}

/** Case-insensitive substring match against an action's label - no fuzzy scoring, the
 * same discipline `searchEntitiesByNameOrAlias` applies server side: a cheap,
 * deterministic filter over a small, static list. */
export function filterActions(actions: PaletteAction[], query: string): PaletteAction[] {
	const q = query.trim().toLowerCase();
	if (!q) return actions;
	return actions.filter((action) => action.label.toLowerCase().includes(q));
}
