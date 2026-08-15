<script lang="ts">
	/** Import guides index (#110, SPEC.md §6.6). D1 = C: Canonry detects the source from
	 * whatever you drop and asks you to confirm, it never makes you pick a source
	 * first. These guides exist so the file you hand it is the right one to begin
	 * with, listed in the same order SPEC.md §6.6's table does. Issue #121's sweep
	 * localizes the chrome (`docs.importIndex`); each `source.label`/`source.summary`
	 * below comes from `importGuides.ts` and stays English - long-form reference
	 * content, not interface chrome. */
	import { resolve } from '$app/paths';
	import DocPage from '$lib/components/docs/DocPage.svelte';
	import { IMPORT_GUIDES } from '$lib/components/docs/importGuides';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale).docs.importIndex);
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<DocPage title={t.title} eyebrow={t.eyebrow} backHref={resolve('/docs')} backLabel={t.backLabel}>
	<p>
		{t.intro}
	</p>

	<h2>{t.sourcesHeading}</h2>
	<ul>
		{#each IMPORT_GUIDES as source (source.slug)}
			<li>
				<a href={resolve(`/docs/import/${source.slug}`)}>{source.label}</a>
				&mdash; {source.summary}
			</li>
		{/each}
	</ul>
</DocPage>
