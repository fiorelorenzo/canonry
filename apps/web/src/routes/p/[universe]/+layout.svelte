<script lang="ts">
	/**
	 * Decision E7: the players' wiki is public, read by people who have never seen the GM
	 * tool and never will - its own light chrome, no sidebar, no Ask button, no proposal
	 * count, nothing that implies an account. It still inherits the app's one shared design
	 * system (G1/G2, both palettes, serif everywhere) via `routes/layout.css`, which the
	 * root layout already imports for every route including this one - a second palette
	 * would mean checking guardrail 6's surface against colours nowhere else uses.
	 *
	 * Issue #127: this chrome's language is `data.locale`, which the root layout's own
	 * `load` already resolved from `locals.locale` - and `locals.locale` itself, for every
	 * path under `/p/`, comes from `Accept-Language` alone (hooks.server.ts), never an
	 * account preference or a cookie. A GM previewing their own share link while signed in
	 * still sees the chrome their browser asks for, not the language they write in.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	let t = $derived(messages(data.locale));
</script>

<svelte:head><title>{data.universe.name} &middot; {t.players.wikiLabel}</title></svelte:head>

<div class="min-h-screen bg-paper text-ink">
	<header class="border-b border-line bg-panel">
		<div class="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 text-sm md:px-8">
			<a
				href={resolve(`/p/${data.universe.slug}`)}
				class="font-semibold text-ink hover:text-accent"
			>
				{data.universe.name}
			</a>
			<span class="flex-1"></span>
			<span class="text-xs tracking-wide text-muted uppercase">{t.players.wikiLabel}</span>
		</div>
	</header>
	<!-- The gutter is `px-4 md:px-8` because that is the contract `PageHeader`'s band
	     bleeds against (`-mx-4 md:-mx-8`, plus the same padding re-added). This shell had
	     `px-6`, so at `md` the band bled 32px into a 24px gutter and the public wiki
	     scrolled 8px sideways at every desktop width - the one horizontal overflow left in
	     the app after round eighteen. Changing the number here rather than the band's keeps
	     one contract for every route instead of a second one for this shell. -->
	<main id="main" class="px-4 py-10 md:px-8">
		{@render children()}
	</main>
</div>
