<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Export: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-measure px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">&larr; Universes</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">Export</h1>
	<p class="mt-2 text-sm text-ink-2">
		Every entry in a universe becomes one markdown file with YAML frontmatter, flat in one zip, plus
		a README naming the universe and the export date. <code class="text-ink">[[Name]]</code>
		mentions are left exactly as written, because markdown is how Canonry stores canon (SPEC.md &sect;13):
		what comes out of this zip is what is in the database, nothing rewritten to fit a different layout.
	</p>
	<p class="mt-2 text-sm text-ink-2">
		This is a flat dump, not a typed, git-ready folder: every file sits at the top level of the zip,
		named after the entry's slug. GM-only entries are included too, with their own
		<code class="text-ink">visibility</code> named in the frontmatter rather than hidden or filtered out
		- this is the GM's own copy, not what players would see.
	</p>

	{#if data.universes.length === 0}
		<p class="mt-8 text-sm text-ink-2">No universes yet.</p>
	{:else}
		<ul class="mt-8 flex flex-col gap-3">
			{#each data.universes as universe (universe.id)}
				<li
					class="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
				>
					<span class="font-semibold text-ink">{universe.name}</span>
					<a
						href={resolve(`/settings/export/${universe.slug}`)}
						class="rounded-md border border-line px-3 py-1.5 text-sm text-accent hover:border-accent"
					>
						Download .zip
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
