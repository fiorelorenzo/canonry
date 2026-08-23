<script lang="ts">
	/**
	 * Issue #143 (I6 = B): the two-pane settings page's own sub-nav, replacing "five
	 * islands, no index" (docs/ux/DECISIONS.md, I6; product-pass.html's own phrase, in git history at c84c8f8) with one list. Labels reuse
	 * each pane's own catalogue title (`settings.account.title`, `settings.language.
	 * title`, ...) rather than a second copy of the same six words for the nav row.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';

	interface NavPageData {
		locale: Locale;
	}
	const locale = $derived((page.data as NavPageData).locale);
	const t = $derived(messages(locale).settings);

	const ITEMS = $derived([
		{ href: resolve('/settings/account'), label: t.account.title },
		{ href: resolve('/settings/language'), label: t.language.title },
		{ href: resolve('/settings/appearance'), label: t.appearance.title },
		{ href: resolve('/settings/keys'), label: t.keys.title },
		{ href: resolve('/settings/billing'), label: t.billing.title },
		{ href: resolve('/settings/export'), label: t.export.title }
	]);
</script>

<nav aria-label={t.subNavAriaLabel} class="flex shrink-0 flex-col gap-0.5 lg:w-48">
	{#each ITEMS as item (item.href)}
		{@const active = page.url.pathname === item.href}
		<a
			href={item.href}
			class="rounded-md px-3 py-1.5 text-sm hover:bg-panel-2"
			class:bg-panel-2={active}
			class:font-semibold={active}
			class:text-ink={active}
			class:text-ink-2={!active}
		>
			{item.label}
		</a>
	{/each}
</nav>
