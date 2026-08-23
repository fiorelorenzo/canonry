<script lang="ts">
	/**
	 * Issue #158, decision J1: `/u/` is a person, and a person's page is read by somebody who
	 * has no account and may never want one. So it gets the same light chrome the players'
	 * wiki gets rather than the app shell - no sidebar, no switcher, no Ask, nothing that
	 * implies a session (`AppShell.svelte` passes through on this subtree, same as on `/p/`).
	 * It inherits the one shared design system through `routes/layout.css`, which the root
	 * layout imports for every route including this one.
	 *
	 * What is in the bar is the product's own name, linking to the door page, and nothing
	 * else. A stranger who followed a link here has no other way to find out what they are
	 * looking at, and the profile itself is the page below rather than something to link back
	 * to from its own chrome (which is where `/p/`'s bar puts the world's name, because there
	 * a wiki has more than one page).
	 *
	 * Language, like `/p/`'s, is the visitor's own: `locals.locale` for every path under `/u/`
	 * comes from `Accept-Language` alone (`isPublicReaderPath`, hooks.server.ts), never from
	 * the account the profile is about and never from a cookie set elsewhere on this origin.
	 */
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="min-h-screen bg-paper text-ink">
	<header class="border-b border-line bg-panel">
		<div class="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 text-body md:px-8">
			<a href={resolve('/')} class="font-semibold text-ink hover:text-accent">Canonry</a>
		</div>
	</header>
	<!-- `px-4 md:px-8`, because that is the gutter `PageBand`'s paper bleeds against
	     (`-mx-4 md:-mx-8` plus the same padding re-added). Any other number here and the
	     band overflows sideways, which is the defect round eighteen found on `/p/`. -->
	<main id="main" class="px-4 py-10 md:px-8">
		{@render children()}
	</main>
</div>
