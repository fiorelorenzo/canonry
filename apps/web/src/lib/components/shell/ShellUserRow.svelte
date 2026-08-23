<script lang="ts">
	/**
	 * Issue #143 (I6 = B) and #144 (I5 = B): the real account menu, replacing the plain
	 * link wave one (#141) left here as a placeholder. Built on `dropdown-menu` (I9 = C)
	 * so focus management, Escape and outside-click come from bits-ui rather than being
	 * hand-rolled a third time in this app - `UniverseSwitcher.svelte`'s own open/close
	 * listeners are exactly the cost I6 (`docs/ux/DECISIONS.md`) is naming. Kept as its
	 * own file, not inlined into Sidebar.svelte, per that file's footer comment.
	 *
	 * Every row is one click from here to a real destination: Account, Language,
	 * Appearance, Model keys, Plan and credits and Export all live under `/settings`
	 * behind this same menu (#143), and Docs/Privacy ride along so guardrail 5's "stated
	 * plainly" is true from every screen the shell wraps, universe mode included, where
	 * neither used to have a link at all. Issue #349 (round eleven P5) adds a further
	 * row, universe mode only: what was kept from the Loremaster (`/w/<slug>/ask/kept`,
	 * #290's persistence) used to be a standalone row above `Sidebar.svelte`'s own nav,
	 * louder than any of A2's capped seven items for something that is not navigation.
	 * It reads as one of this menu's own occasional destinations instead now, which is
	 * what "goes with the account's own surfaces" means concretely.
	 *
	 * `quota` arrives as a prop, same as `QuotaMeter.svelte`'s sibling in the footer -
	 * Sidebar.svelte already threads it down from `AppShell`'s `page.data.shellQuota`,
	 * so this reads it the same way rather than re-deriving it from `page.data` a
	 * second time. `themePreference` has no such prop yet, so it is read straight off
	 * `page.data` here, the same reasoning `AppShell.svelte`'s own doc comment gives for
	 * reading it directly rather than threading one more prop through Sidebar for a
	 * value already resolved once in `routes/+layout.server.ts`.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { authClient } from '$lib/auth-client';
	import { LOCALE_NAMES, LOCALES, messages, type Locale } from '$lib/i18n';
	import type { ThemePreference } from '$lib/theme';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { cn } from '$lib/utils/cn.js';
	import type { ShellQuota } from './types';

	let {
		user,
		locale,
		quota,
		universeSlug
	}: {
		user: { name: string; email: string };
		locale: Locale;
		quota: ShellQuota | null;
		/** Null in account mode (no universe selected): the kept-answers row below is
		 * universe-scoped (#290's `ask/kept` table has no account-wide view) and simply
		 * does not render there, the same way `Sidebar.svelte`'s own primary nav swaps
		 * to `ACCOUNT_NAV_ITEMS` when this is null. */
		universeSlug: string | null;
	} = $props();

	const t = $derived(messages(locale).shell);
	const askT = $derived(messages(locale).universe.ask);
	const settingsT = $derived(messages(locale).settings);

	/** Only the one field this component reads off the merged page data, typed
	 * locally rather than widening `App.PageData` - the same shape AppShell.svelte's
	 * own `ShellPageData` interface uses for the same reason. */
	interface MenuPageData {
		themePreference: ThemePreference;
	}
	const pageData = $derived(page.data as MenuPageData);

	const themeLabel = $derived(
		{
			light: settingsT.appearance.light,
			dark: settingsT.appearance.dark,
			system: settingsT.appearance.system
		}[pageData.themePreference]
	);
	// The included quota, not the warm budget: F2 counts them separately and the footer meter
	// above already shows both, so the one number this row can afford is the one a GM means
	// when they ask what is left. I5's own mock draws it as the included pair.
	const creditsLabel = $derived(
		quota ? t.quota.ratio(quota.includedRemaining, quota.includedTotal) : null
	);

	let menuOpen = $state(false);
	let signingOut = $state(false);
	let switchingLocale = $state(false);

	async function signOut() {
		signingOut = true;
		await authClient.signOut();
		await invalidateAll();
		signingOut = false;
		await goto(resolve('/'));
	}

	// #144 (I5 = B): a real `<form>` posting to the same `/settings/language` action the
	// settings page itself uses, so the account preference (not only a cookie) is what
	// changes - SPEC 17's own requirement that the choice follows the GM to the phone.
	// `id`+`form=` (not DOM nesting) ties each locale button to it, because
	// `DropdownMenuSubContent` portals its own subtree away from this form. The id is
	// suffixed with `$props.id()` (Svelte 5) rather than a bare literal because Phone's
	// responsive shell (#148) can mount this component twice at once (rail and drawer);
	// a duplicate DOM id would make `form=` resolve to whichever copy happens to be
	// first in the document instead of this instance's own.
	const localeFormUid = $props.id();
	const localeFormId = `account-menu-locale-form-${localeFormUid}`;
</script>

<form
	id={localeFormId}
	method="POST"
	action={resolve('/settings/language')}
	class="hidden"
	use:enhance={() => {
		switchingLocale = true;
		return async ({ update }) => {
			await update();
			switchingLocale = false;
		};
	}}
></form>

<DropdownMenu.Root bind:open={menuOpen}>
	<DropdownMenu.Trigger
		class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-panel-2"
	>
		<span class="min-w-0 flex-1 truncate font-medium text-ink">{user.name}</span>
		<span aria-hidden="true" class="shrink-0 text-muted">{menuOpen ? '▴' : '▾'}</span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-64">
		<DropdownMenu.Label>
			<span class="block truncate text-sm font-semibold text-ink">{user.name}</span>
			<span class="block truncate text-xs font-normal text-muted">{user.email}</span>
		</DropdownMenu.Label>
		<DropdownMenu.Separator />

		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a href={resolve('/settings/account')} {...props}>{t.accountMenu.account}</a>
			{/snippet}
		</DropdownMenu.Item>

		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger>
				{t.accountMenu.language}
				<span class="ml-auto text-xs text-muted">
					{switchingLocale ? '…' : LOCALE_NAMES[locale]}
				</span>
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent>
				{#each LOCALES as loc (loc)}
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<button
								type="submit"
								form={localeFormId}
								name="locale"
								value={loc}
								disabled={switchingLocale}
								aria-current={loc === locale ? 'true' : undefined}
								{...props}
								class={cn(props.class as string | undefined, 'w-full text-left')}
							>
								{LOCALE_NAMES[loc]}
							</button>
						{/snippet}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>

		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a href={resolve('/settings/appearance')} {...props}>
					{t.accountMenu.appearance}
					<span class="ml-auto text-xs text-muted">{themeLabel}</span>
				</a>
			{/snippet}
		</DropdownMenu.Item>

		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a href={resolve('/settings/keys')} {...props}>{t.accountMenu.modelKeys}</a>
			{/snippet}
		</DropdownMenu.Item>

		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a href={resolve('/settings/billing')} {...props}>
					{t.accountMenu.planAndCredits}
					{#if creditsLabel}
						<span class="ml-auto text-xs text-muted">{creditsLabel}</span>
					{/if}
				</a>
			{/snippet}
		</DropdownMenu.Item>

		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a href={resolve('/settings/export')} {...props}>{t.accountMenu.export}</a>
			{/snippet}
		</DropdownMenu.Item>

		{#if universeSlug}
			<DropdownMenu.Separator />
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a href={resolve(`/w/${universeSlug}/ask`)} {...props}>
						{askT.keep.historyLink}
					</a>
				{/snippet}
			</DropdownMenu.Item>
		{/if}

		<DropdownMenu.Separator />

		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a href={resolve('/docs')} {...props}>{messages(locale).auth.footer.docs}</a>
			{/snippet}
		</DropdownMenu.Item>
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a href={resolve('/privacy')} {...props}>{messages(locale).auth.footer.privacy}</a>
			{/snippet}
		</DropdownMenu.Item>

		<DropdownMenu.Separator />

		<DropdownMenu.Item variant="destructive" disabled={signingOut} onSelect={() => signOut()}>
			{signingOut ? t.signingOut : t.signOut}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
