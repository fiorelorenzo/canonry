<script lang="ts">
	/**
	 * Decision E7: the players' wiki is public, read by people who have never seen the GM
	 * tool and never will - its own light chrome, no sidebar, no Ask button, no proposal
	 * count, nothing that implies an account. It still inherits the app's one shared design
	 * system (G1/G2, both palettes, serif everywhere) via `routes/layout.css`, which the
	 * root layout already imports for every route including this one - a second palette
	 * would mean checking guardrail 6's surface against colours nowhere else uses.
	 */
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head><title>{data.universe.name} &middot; players' wiki</title></svelte:head>

<div class="min-h-screen bg-paper text-ink">
	<header class="border-b border-line bg-panel">
		<div class="mx-auto flex max-w-3xl items-center gap-2 px-6 py-3 text-sm">
			<a
				href={resolve(`/p/${data.universe.slug}`)}
				class="font-semibold text-ink hover:text-accent"
			>
				{data.universe.name}
			</a>
			<span class="flex-1"></span>
			<span class="text-xs tracking-wide text-muted uppercase">Players' wiki</span>
		</div>
	</header>
	<main id="main" class="mx-auto max-w-3xl px-6 py-10">
		{@render children()}
	</main>
</div>
