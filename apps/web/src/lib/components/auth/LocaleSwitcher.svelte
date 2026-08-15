<script lang="ts">
	/**
	 * The compact switcher SPEC.md §17 asks for on the sign-in and sign-up pages: there
	 * is no account yet to hold a preference, so it sets the `canonry_locale` cookie
	 * instead (`negotiateLocale`'s second rung, ahead of `Accept-Language`, behind an
	 * account preference once one exists). Both pages render this identically and post
	 * to their own `?/setLocale` action - see either page's `+page.server.ts`.
	 *
	 * Locale names are shown as endonyms (`LOCALE_NAMES`, "English"/"Italiano"), each in
	 * its own language, not translated through the active locale - the one label a
	 * language switcher must never need translating to be understood.
	 */
	import { enhance } from '$app/forms';
	import { LOCALE_NAMES, LOCALES, messages, type Locale } from '$lib/i18n';

	let { locale }: { locale: Locale } = $props();

	const label = $derived(messages(locale).auth.languageSwitcher.label);
</script>

<form method="POST" action="?/setLocale" use:enhance class="flex items-center gap-2 text-xs">
	<span class="sr-only">{label}</span>
	{#each LOCALES as loc (loc)}
		<button
			type="submit"
			name="locale"
			value={loc}
			aria-pressed={locale === loc}
			class="rounded-full border px-2.5 py-1 font-medium tracking-wide uppercase"
			class:border-accent={locale === loc}
			class:text-accent-ink={locale === loc}
			class:bg-accent-bg={locale === loc}
			class:border-line={locale !== loc}
			class:text-ink-2={locale !== loc}
		>
			{LOCALE_NAMES[loc]}
		</button>
	{/each}
</form>
