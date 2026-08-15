<script lang="ts">
	/**
	 * Issue #148 (I10 = B): the phone chrome the fixed rail can't carry below `md`.
	 * Two pieces, both `md:hidden`:
	 *
	 * - A top bar carrying everything A2's sidebar owned that the rail no longer
	 *   shows on a narrow screen - the universe switcher (behind a single trigger
	 *   that opens `Sidebar.svelte` a second time, `variant="drawer"`, inside a
	 *   `sheet` rather than a hand-rolled drawer per the issue), the palette
	 *   (`paletteState`, #149) and the account (a link straight to `/settings` -
	 *   the account menu itself lives in the drawer's footer, same as the rail,
	 *   so nothing here duplicates it).
	 * - E4's bottom tabs, generalised: three real destinations (Entries, Proposals
	 *   with its live count, Ask) plus a fourth "More" tab that opens the same
	 *   drawer as the top bar's trigger, rather than a second sheet or a fifth
	 *   destination competing with the drawer for the same job. Universe mode
	 *   only - account mode's three places already fit the drawer with room to
	 *   spare, so it gets the top bar alone.
	 *
	 * AppShell does not mount this at all under `/u/[universe]/table`: that
	 * route's own `ContextStrip` and `PhoneTabBar` (#81, E4's original) are this
	 * same pattern already built for that surface, and stacking a second top bar
	 * or a second bottom bar on top of them is exactly the "two navigation
	 * patterns at once" this issue rules out.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { messages, type Locale } from '$lib/i18n';
	import { paletteState } from '$lib/components/palette/palette-state.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Sidebar from './Sidebar.svelte';
	import type { RecentEntity, ShellQuota, UniverseSummary } from './types';

	let {
		mode,
		universeSlug,
		current,
		universes,
		recent,
		entryCount,
		proposalsPending,
		locale,
		user,
		quota
	}: {
		mode: 'universe' | 'account';
		universeSlug: string | null;
		current: UniverseSummary | null;
		universes: UniverseSummary[];
		recent: RecentEntity[];
		entryCount: number;
		proposalsPending: number;
		locale: Locale;
		user: { id: string; name: string; email: string };
		quota: ShellQuota | null;
	} = $props();

	const t = $derived(messages(locale).shell.phoneNav);
	const navT = $derived(messages(locale).universe.nav);

	let drawerOpen = $state(false);

	// Closes the drawer on every navigation (tapping a link inside it, or the
	// "More" tab reopening it and then a further tap) without the drawer's own
	// content - Sidebar.svelte, shared with the desktop rail - needing to know a
	// sheet exists at all.
	// Reading the pathname inside the condition is what registers the dependency: a bare
	// `page.url.pathname;` statement did the same thing and reads as dead code to eslint.
	$effect(() => {
		if (page.url.pathname) drawerOpen = false;
	});

	const initials = $derived(
		user.name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);

	interface PhoneTab {
		id: 'entries' | 'proposals' | 'ask';
		label: string;
		href: string;
		badge: number | null;
	}

	const tabs = $derived<PhoneTab[]>(
		universeSlug
			? [
					{ id: 'entries', label: navT.entries, href: resolve(`/u/${universeSlug}`), badge: null },
					{
						id: 'proposals',
						label: navT.proposals,
						href: resolve(`/u/${universeSlug}/proposals`),
						badge: proposalsPending > 0 ? proposalsPending : null
					},
					{ id: 'ask', label: t.ask, href: resolve(`/u/${universeSlug}/ask`), badge: null }
				]
			: []
	);
</script>

<header class="flex items-center gap-1.5 border-b border-line bg-panel px-2 py-1.5 md:hidden">
	<Sheet.Root bind:open={drawerOpen}>
		<Sheet.Trigger
			class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-ink hover:bg-panel-2"
		>
			<MenuIcon class="size-5 shrink-0 text-ink-2" aria-hidden="true" />
			<span class="min-w-0 flex-1 truncate">
				{mode === 'universe' && current ? current.name : 'Canonry'}
			</span>
			<span aria-hidden="true" class="shrink-0 text-xs text-ink-2">&#9662;</span>
		</Sheet.Trigger>
		<Sheet.Content side="left" class="w-4/5 max-w-xs gap-0 p-0" closeLabel={t.closeNavLabel}>
			<Sheet.Title class="sr-only">{t.openNavLabel}</Sheet.Title>
			<Sheet.Description class="sr-only">{t.openNavDescription}</Sheet.Description>
			<Sidebar
				variant="drawer"
				{mode}
				{universeSlug}
				{current}
				{universes}
				{recent}
				{entryCount}
				{proposalsPending}
				{locale}
				{user}
				{quota}
			/>
		</Sheet.Content>
	</Sheet.Root>

	<button
		type="button"
		onclick={() => (paletteState.open = true)}
		class="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-panel-2"
		aria-label={t.paletteTriggerLabel}
	>
		<SearchIcon class="size-5" aria-hidden="true" />
	</button>

	<a
		href={resolve('/settings')}
		class="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-bg text-xs font-semibold text-accent-ink hover:brightness-95"
		aria-label={t.accountLabel}
	>
		{initials}
	</a>
</header>

{#if mode === 'universe' && universeSlug}
	<nav
		class="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel md:hidden"
		aria-label={t.tabsAriaLabel}
	>
		{#each tabs as tab (tab.id)}
			{@const active = page.url.pathname === tab.href}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- tab.href is already a
		     resolve() result, built where `tabs` is declared above. -->
			<a
				href={tab.href}
				aria-current={active ? 'page' : undefined}
				class="flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs"
				class:text-accent-ink={active}
				class:font-semibold={active}
				class:text-ink-2={!active}
			>
				<span>{tab.label}</span>
				{#if tab.badge}
					<span class="rounded-full bg-ai-bg px-1.5 py-0 font-mono text-[9px] text-ai"
						>{tab.badge}</span
					>
				{/if}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/each}
		<button
			type="button"
			onclick={() => (drawerOpen = true)}
			class="flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs text-ink-2"
		>
			<span>{t.more}</span>
		</button>
	</nav>
{/if}
