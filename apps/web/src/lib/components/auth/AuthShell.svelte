<script lang="ts">
	/**
	 * The one layout behind both auth pages (I2 = C for sign-in, B for sign-up,
	 * docs/ux/product-pass.html#i2, issue #139). Sign-in and sign-up are not two
	 * designs: this is the title page, and sign-up is the same title page with
	 * `pane` set, which drops back to the title page below 900px. Full paper,
	 * the mark large and centred and linking to canonry.io, the form at about
	 * 21rem under it, everything secondary - the locale switcher included - in
	 * the footer rule at the bottom of the page rather than the top right.
	 *
	 * No page chrome from the root layout applies here: AppShell is a pass-through
	 * when signed out (confirmed with Shell, #141), so this component is the whole
	 * frame for these two routes, skip-link target included.
	 */
	import { resolve } from '$app/paths';
	import Mark from '$lib/components/brand/Mark.svelte';
	import { messages, type Locale } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import ArgumentPane from './ArgumentPane.svelte';
	import LocaleSwitcher from './LocaleSwitcher.svelte';

	let {
		locale,
		title,
		subtitle,
		pane = false,
		children
	}: {
		locale: Locale;
		/** #474: the sr-only `<h1>` every AuthShell screen needs (`page-has-heading-one`).
		 * The wordmark below is a link to canonry.io, not a heading, and I2 (#139) chose
		 * the title page deliberately with no visible screen title to duplicate - this
		 * carries the same string each page already puts in `<svelte:head><title>`. */
		title: string;
		subtitle: string;
		/** True only on sign-up: renders the static argument pane at >=900px (I2 = B). */
		pane?: boolean;
		children: Snippet;
	} = $props();

	const t = $derived(messages(locale).auth.footer);
</script>

<div class="flex min-h-dvh flex-col bg-paper">
	<main
		id="main"
		class="flex flex-1 flex-col {pane ? 'min-[900px]:flex-row min-[900px]:items-stretch' : ''}"
	>
		<div class="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-16">
			<h1 class="sr-only">{title}</h1>
			<a
				href="https://canonry.io"
				class="flex flex-col items-center gap-2 text-accent hover:opacity-80"
			>
				<Mark size={44} />
				<span class="font-serif text-2xl font-semibold text-ink">Canonry</span>
			</a>
			<p class="max-w-sm text-center text-sm text-ink-2">{subtitle}</p>
			<div class="w-[21rem] max-w-full">
				{@render children()}
			</div>
		</div>

		{#if pane}
			<div
				class="hidden flex-1 border-line bg-panel-2 px-10 py-16 min-[900px]:block min-[900px]:border-l"
			>
				<ArgumentPane {locale} />
			</div>
		{/if}
	</main>

	<footer
		class="flex flex-wrap items-center gap-4 border-t border-line bg-panel-2 px-6 py-3 text-label text-ink-2"
	>
		<LocaleSwitcher {locale} />
		<span class="flex-1"></span>
		<a href="https://canonry.io" class="hover:underline">{t.whatCanonryIs}</a>
		<a href={resolve('/docs')} class="hover:underline">{t.docs}</a>
		<a href={resolve('/privacy')} class="hover:underline">{t.privacy}</a>
	</footer>
</div>
