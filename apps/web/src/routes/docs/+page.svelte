<script lang="ts">
	/** The docs hub (#110). One category exists so far, import guides; this page is
	 * the index that a future doc (export and lock-in, G10) grows a second card on
	 * rather than a route that has to be reshaped to admit one. */
	import { resolve } from '$app/paths';
	import DocPage from '$lib/components/docs/DocPage.svelte';
</script>

<svelte:head>
	<title>Docs: Canonry</title>
</svelte:head>

<DocPage title="Guides" backHref={resolve('/')} backLabel="Universes">
	<p>
		Practical guides for getting a world into Canonry and anything else that needs plain
		instructions rather than a spec section.
	</p>

	<h2>Import guides</h2>
	<p>
		One page per source, with the export steps to follow before you upload anything: Obsidian,
		Kanka, World Anvil, OneNote, PDF, DOCX, and the generic path for anything else.
	</p>
	<p>
		<a href={resolve('/docs/import')}>Read the import guides</a>
	</p>
</DocPage>
