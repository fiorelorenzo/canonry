<script lang="ts">
	/** Import guides index (#110, SPEC.md §6.6). D1 = C: Canonry detects the source from
	 * whatever you drop and asks you to confirm, it never makes you pick a source
	 * first. These guides exist so the file you hand it is the right one to begin
	 * with, listed in the same order SPEC.md §6.6's table does. */
	import { resolve } from '$app/paths';
	import DocPage from '$lib/components/docs/DocPage.svelte';
	import { IMPORT_GUIDES } from '$lib/components/docs/importGuides';
</script>

<svelte:head>
	<title>Import guides: Canonry</title>
</svelte:head>

<DocPage title="Import guides" eyebrow="Docs" backHref={resolve('/docs')} backLabel="Docs">
	<p>
		Canonry does not ask you to pick a source before you upload anything. Drop a folder or a file,
		and it looks at its shape, tells you what it thinks it found, and asks you to confirm (or pick a
		different playbook from a short list) before it reads any further. These guides exist so the
		file you hand it is the right one to begin with: what to export from wherever your world lives
		now, and what Canonry does and does not understand once it gets there.
	</p>

	<h2>Sources</h2>
	<ul>
		{#each IMPORT_GUIDES as source (source.slug)}
			<li>
				<a href={resolve(`/docs/import/${source.slug}`)}>{source.label}</a>
				&mdash; {source.summary}
			</li>
		{/each}
	</ul>
</DocPage>
