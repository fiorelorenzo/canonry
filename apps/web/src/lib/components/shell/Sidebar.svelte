<script lang="ts">
	/**
	 * A2 = A, extended by issue #141 (I3 = B): the fixed sidebar is the frame for the
	 * whole product now, not only a universe. `mode: 'universe'` is A2's original
	 * design, unchanged - switcher on top, the capped nav from `nav.ts`'s `NAV_ITEMS`
	 * with their counts, Recent underneath. `mode: 'account'` is new: the switcher
	 * (UniverseSwitcher.svelte, which branches on `current` being null) offers every
	 * universe plus "All universes" and "New universe", and the nav below it is
	 * `nav.ts`'s `ACCOUNT_NAV_ITEMS` - Universes, Settings, Docs - instead of a
	 * universe's seven places.
	 *
	 * The footer at the bottom is shared by both modes and is not conditional on the
	 * mode at all. Issue #141 only builds the user row (ShellUserRow.svelte, a plain
	 * link to `/settings` plus sign-out); #143 (I6) replaces that one component with a
	 * real account menu, and #150 (F2) adds the quota meter as a sibling above it -
	 * both land inside the footer `<div>` marked below, touching nothing else here.
	 *
	 * Issue #148 (I10 = B): `variant` picks which outer shell this same nav+footer
	 * markup sits inside - 'rail' is A2's fixed 256px column, hidden below `md` now
	 * that the shell has a real breakpoint, and 'drawer' is PhoneNav.svelte's second
	 * mount of this exact component inside a Sheet, filling whatever the sheet gives
	 * it. Only the `<aside>` tag's own class list branches on it - everything a
	 * sibling issue owns inside this file (the footer, the Ask row's shortcut text)
	 * is written once and simply renders twice, one per variant, so neither has to
	 * touch this prop or know it exists.
	 *
	 * Issue #121: `NAV_ITEMS.label` and `ACCOUNT_NAV_ITEMS.label` both stay an English
	 * id-like fallback/type discriminant (nav.ts's own doc comment) - the visible
	 * label is always looked up from the message catalogue instead of the raw field.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Mark from '$lib/components/brand/Mark.svelte';
	import { messages, type Locale } from '$lib/i18n';
	import { formatShortcut, SHORTCUTS } from '$lib/keys';
	import { ACCOUNT_NAV_ITEMS, NAV_ITEMS } from './nav';
	import QuotaMeter from './QuotaMeter.svelte';
	import ShellUserRow from './ShellUserRow.svelte';
	import UniverseSwitcher from './UniverseSwitcher.svelte';
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
		quota,
		variant = 'rail'
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
		/** 'rail' (default): A2's fixed desktop column. 'drawer': PhoneNav's mobile
		 * Sheet mount - see the doc comment above. */
		variant?: 'rail' | 'drawer';
	} = $props();

	const t = $derived(messages(locale).universe);
	const shellT = $derived(messages(locale).shell);

	// Issue #149 (G3 = B): the Ask button's hint used to be a hardcoded "⌘⇧A", a Mac
	// glyph shown to every platform with no handler behind it. `CommandPalette.svelte`
	// now binds this chord for real (global, "Ask, directly - skipping the palette");
	// this renders whatever that binding actually is, per platform, from the one
	// source both agree on.
	const askShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'ask')!;

	// C2 = A: a quiet, persistent nav badge. Entries carries the same real count it always
	// has; Proposals now reads a real pending-proposal count too (#47/#51 land the table
	// and the review surface), zero when the inbox is empty rather than hidden - a settled
	// day should visibly say so, not just omit the number.
	const counts: Partial<Record<(typeof NAV_ITEMS)[number]['id'], number>> = $derived({
		entries: entryCount,
		proposals: proposalsPending
	});
</script>

<aside
	class={variant === 'drawer'
		? 'flex h-full w-full flex-col bg-panel'
		: 'hidden h-screen w-64 flex-none flex-col border-r border-line bg-panel md:flex'}
	aria-label={mode === 'universe' ? t.sidebar.navAriaLabel : shellT.sidebar.accountNavAriaLabel}
>
	<div class="border-b border-line p-3">
		<div class="mb-2 flex items-center gap-1.5 text-accent">
			<Mark size={14} />
			<span class="text-xs font-semibold tracking-wide text-ink-2">Canonry</span>
		</div>
		<UniverseSwitcher {current} {universes} {locale} />
		{#if mode === 'universe' && universeSlug}
			<a
				href={resolve(`/w/${universeSlug}/ask`)}
				class="mt-2 flex items-center gap-2 rounded-md border border-ai-line bg-ai-bg px-2.5 py-1.5 text-sm text-ai hover:opacity-90"
				title={t.sidebar.askTheLoremaster}
			>
				<span aria-hidden="true">✦</span>
				<!-- Truncated rather than wrapped, with the full phrase on `title` and in the
				     accessible name: off macOS the hint beside it reads "Ctrl+Shift+A" instead of
				     three glyphs, and something has to give in a 256px rail. -->
				<span class="truncate">{t.sidebar.askTheLoremaster}</span>
				<span class="ml-auto flex-none font-mono text-[10px] whitespace-nowrap text-muted"
					>{formatShortcut(askShortcut)}</span
				>
			</a>
		{/if}
	</div>

	<nav class="flex-1 overflow-y-auto p-2" aria-label={t.sidebar.primaryNavAriaLabel}>
		{#if mode === 'universe' && universeSlug}
			<ul class="flex flex-col gap-0.5">
				{#each NAV_ITEMS as item (item.id)}
					{@const href = resolve(item.href(universeSlug))}
					{@const active = page.url.pathname === href}
					<li>
						<a
							{href}
							class="flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-panel-2"
							class:text-ink={active}
							class:font-semibold={active}
							class:text-ink-2={!active}
							title={item.built ? undefined : t.sidebar.notBuiltYet}
						>
							<span>{t.nav[item.id]}</span>
							{#if counts[item.id] !== undefined}
								<span
									class="rounded-full bg-panel-2 px-1.5 py-0.5 text-xs text-muted"
									class:bg-accent-bg={active}
								>
									{counts[item.id]}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>

			{#if recent.length > 0}
				<div class="mt-5">
					<h2 class="px-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
						{t.sidebar.recentHeading}
					</h2>
					<ul class="mt-1 flex flex-col gap-0.5">
						{#each recent as entry (entry.id)}
							<li>
								<a
									href={resolve(`/w/${universeSlug}/e/${entry.slug}`)}
									class="block truncate rounded-md px-2.5 py-1 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink"
								>
									{entry.name}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{:else}
			<ul class="flex flex-col gap-0.5">
				{#each ACCOUNT_NAV_ITEMS as item (item.id)}
					{@const href = resolve(item.href)}
					{@const active = page.url.pathname === href}
					<li>
						<a
							{href}
							class="flex items-center rounded-md px-2.5 py-1.5 text-sm hover:bg-panel-2"
							class:text-ink={active}
							class:font-semibold={active}
							class:text-ink-2={!active}
						>
							{shellT.sidebar.accountNav[item.id]}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</nav>

	<!-- Shared footer (issue #141, I3 = B). #150 (F2's quota meter) is the sibling
	     above ShellUserRow; #143/#144 (I6 = B, I5 = B) turned ShellUserRow itself into
	     the real account menu - Docs and Privacy now live as rows inside that menu
	     (docs/ux/product-pass.html#i6's own mock draws them there), which is also why
	     there is no longer a standalone Privacy link in this div: one menu, not a menu
	     plus a leftover link saying the same thing twice.

	     Issue #201: the meter also needs `universes.length > 0` - an account with no
	     universe yet (mid-`/onboarding`) can't spend either budget, so the footer
	     would show two ceilings for things the GM hasn't met. The auth pages need no
	     equivalent check: AppShell.svelte never mounts this component at all when
	     `data.user` is null, which is every route under `/auth`. -->
	<div class="flex flex-col gap-1.5 border-t border-line p-3">
		{#if quota && universes.length > 0}
			<QuotaMeter {quota} {locale} />
		{/if}
		<ShellUserRow {user} {locale} {quota} />
	</div>
</aside>
