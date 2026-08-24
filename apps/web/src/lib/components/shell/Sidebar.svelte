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
	 * Issue #349 threads `universeSlug` through to ShellUserRow too, for the account
	 * menu's own kept-answers row (see that file's doc comment).
	 *
	 * Issue #148 (I10 = B): `variant` picks which outer shell this same nav+footer
	 * markup sits inside - 'rail' is A2's fixed 256px column, hidden below `md` now
	 * that the shell has a real breakpoint, and 'drawer' is PhoneNav.svelte's second
	 * mount of this exact component inside a Sheet, filling whatever the sheet gives
	 * it. Only the `<aside>` tag's own class list branches on it - everything a
	 * sibling issue owns inside this file (the footer)
	 * is written once and simply renders twice, one per variant, so neither has to
	 * touch this prop or know it exists.
	 *
	 * Issue #121: `NAV_ITEMS.label` and `ACCOUNT_NAV_ITEMS.label` both stay an English
	 * id-like fallback/type discriminant (nav.ts's own doc comment) - the visible
	 * label is always looked up from the message catalogue instead of the raw field.
	 *
	 * Issue #429, decision T2 (round fifteen): Recents is the GM's most-used list of
	 * entries, and its links now preview exactly like a mention in prose does - same
	 * `MentionPreview.svelte`, same GM endpoint. Mounted once per `<aside>` below
	 * (`container`), not once per page, keyed off `data-entry-slug` on the Recents
	 * anchors, the same attribute `markdown.ts`'s mention renderer emits.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Mark from '$lib/components/brand/Mark.svelte';
	import MentionPreview from '$lib/components/entry/MentionPreview.svelte';
	import { messages, type Locale } from '$lib/i18n';
	import { ACCOUNT_NAV_ITEMS, NAV_ITEMS } from './nav';
	import QuotaMeter from './QuotaMeter.svelte';
	import ShellUserRow from './ShellUserRow.svelte';
	import UniverseSwitcher from './UniverseSwitcher.svelte';
	import type { RecentEntity, ShellQuota, UniverseSetupItem, UniverseSummary } from './types';

	let {
		mode,
		universeSlug,
		current,
		universes,
		recent,
		entryCount,
		proposalsPending,
		setupItems,
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
		/** Issue #379, decision R4: `universeSetupItems()`'s own output, unchanged -
		 * this component only counts `done === false`, it never re-decides what
		 * "unset" means. Empty in account mode, where there is no current universe. */
		setupItems: UniverseSetupItem[];
		locale: Locale;
		user: { id: string; name: string; email: string };
		quota: ShellQuota | null;
		/** 'rail' (default): A2's fixed desktop column. 'drawer': PhoneNav's mobile
		 * Sheet mount - see the doc comment above. */
		variant?: 'rail' | 'drawer';
	} = $props();

	const t = $derived(messages(locale).universe);
	const shellT = $derived(messages(locale).shell);

	// C2 = A: a quiet, persistent nav badge. Entries carries the same real count it always
	// has; Proposals now reads a real pending-proposal count too (#47/#51 land the table
	// and the review surface), zero when the inbox is empty rather than hidden - a settled
	// day should visibly say so, not just omit the number. V9 (round seventeen, #501): this
	// aside stays mounted across a navigation (A2's fixed sidebar), so when the count the
	// layout load re-reads actually differs from the one already on screen, the badge below
	// crossfades to the new number instead of snapping - `{#key}` remounts the span, which is
	// what makes the fade token's own enter animation run again for a value that just changed
	// rather than one that is merely rendering for the first time.
	const counts: Partial<Record<(typeof NAV_ITEMS)[number]['id'], number>> = $derived({
		entries: entryCount,
		proposals: proposalsPending
	});

	// Issue #379, decision R4: the count the shell row shows, and the gate for
	// whether it renders at all - `undefined` (never present) reads the same as
	// `[]` (nothing left unset), so account mode and a fully set-up universe both
	// simply show nothing.
	const unsetSetupCount = $derived(setupItems.filter((item) => !item.done).length);

	// #429, T2 round fifteen: the sidebar's own mention-preview trigger surface, one
	// instance per mounted `<aside>` (rail and drawer each get their own, never one per
	// page), positioned against this element exactly the way `EntryProse.svelte`
	// positions its card against the prose div.
	let container = $state<HTMLElement | null>(null);
</script>

<aside
	bind:this={container}
	class={variant === 'drawer'
		? 'relative flex h-full w-full flex-col bg-panel'
		: 'relative hidden h-screen w-64 flex-none flex-col border-r border-line bg-panel md:flex'}
	aria-label={mode === 'universe' ? t.sidebar.navAriaLabel : shellT.sidebar.accountNavAriaLabel}
>
	<div class="border-b border-line p-3">
		<div class="mb-2 flex items-center gap-1.5 text-accent">
			<Mark size={14} />
			<span class="text-xs font-semibold tracking-wide text-ink-2">Canonry</span>
		</div>
		<UniverseSwitcher {current} {universes} {locale} />
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
							class="flex items-center justify-between rounded-md px-2.5 py-1.5 text-body transition-colors hover:bg-panel-2"
							class:text-ink={active}
							class:font-semibold={active}
							class:text-ink-2={!active}
						>
							<span>{t.nav[item.id]}</span>
							{#if counts[item.id] !== undefined}
								{#key counts[item.id]}
									<span
										class="animate-in rounded-full bg-panel-2 px-1.5 py-0.5 text-label text-muted duration-fade ease-arrive fade-in-0"
										class:bg-accent-bg={active}
									>
										{counts[item.id]}
									</span>
								{/key}
							{/if}
						</a>
					</li>
				{/each}
			</ul>

			{#if recent.length > 0}
				<div class="mt-5">
					<h2 class="px-2.5 text-label font-semibold tracking-wide text-muted uppercase">
						{t.sidebar.recentHeading}
					</h2>
					<ul class="mt-1 flex flex-col gap-0.5">
						{#each recent as entry (entry.id)}
							<li>
								<a
									href={resolve(`/w/${universeSlug}/e/${entry.slug}`)}
									data-entry-slug={entry.slug}
									class="block truncate rounded-md px-2.5 py-1 text-body text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink"
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
							class="flex items-center rounded-md px-2.5 py-1.5 text-body transition-colors hover:bg-panel-2"
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

	{#if mode === 'universe' && universeSlug}
		<MentionPreview {container} {universeSlug} surface="gm" {locale} />
	{/if}

	<!-- Issue #379, decision R4: a quiet row under the nav, never a toast, modal or
	     per-page banner - gated on `unsetSetupCount > 0` so it is simply absent once
	     the checklist is empty, and never dismissible, since a dismissed warning about
	     an unset setting would lie the moment it was dismissed. -->
	{#if mode === 'universe' && universeSlug && unsetSetupCount > 0}
		<div class="border-t border-line p-3">
			<a
				href={resolve(`/w/${universeSlug}/settings`)}
				class="block rounded-md border border-warn-bg bg-warn-bg px-2.5 py-1.5 text-label text-warn hover:brightness-95"
			>
				{shellT.sidebar.setupWarning(unsetSetupCount)}
			</a>
		</div>
	{/if}

	<!-- Shared footer (issue #141, I3 = B). #150 (F2's quota meter) is the sibling
	     above ShellUserRow; #143/#144 (I6 = B, I5 = B) turned ShellUserRow itself into
	     the real account menu - Docs and Privacy now live as rows inside that menu
	     (`docs/design/DECISIONS.md`, I6; product-pass.html's own mock, in git history at c84c8f8), which is also why
	     there is no longer a standalone Privacy link in this div: one menu, not a menu
	     plus a leftover link saying the same thing twice. #349 adds `universeSlug` to
	     the props ShellUserRow reads: universe mode's own kept-answers link now lives
	     in that menu instead of as a row above (see ShellUserRow.svelte).

	     Issue #201: the meter also needs `universes.length > 0` - an account with no
	     universe yet (mid-`/onboarding`) can't spend either budget, so the footer
	     would show two ceilings for things the GM hasn't met. The auth pages need no
	     equivalent check: AppShell.svelte never mounts this component at all when
	     `data.user` is null, which is every route under `/auth`. -->
	<div class="flex flex-col gap-1.5 border-t border-line p-3">
		{#if quota && universes.length > 0}
			<QuotaMeter {quota} {locale} />
		{/if}
		<ShellUserRow {user} {locale} {quota} {universeSlug} />
	</div>
</aside>
