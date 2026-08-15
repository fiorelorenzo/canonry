<script lang="ts">
	/** The docs hub (#110). Two categories: import guides, and issue #131's "what we
	 * translate" page. Issue #121's sweep localizes this index's own chrome (the
	 * `docs.hub` catalogue namespace); the page the second link points at was already
	 * bilingual under its own `docsLanguages` namespace (issue #131). */
	import { resolve } from '$app/paths';
	import DocPage from '$lib/components/docs/DocPage.svelte';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale).docs);
</script>

<svelte:head>
	<title>{t.hub.browserTitle}: Canonry</title>
</svelte:head>

<DocPage title={t.hub.title}>
	<p>
		{t.hub.intro}
	</p>

	<h2>{t.hub.importHeading}</h2>
	<p>
		{t.hub.importIntro}
	</p>
	<p>
		<a href={resolve('/docs/import')}>{t.hub.importLink}</a>
	</p>

	<h2>{t.hub.languagesHeading}</h2>
	<p>
		{t.hub.languagesIntro}
	</p>
	<p>
		<a href={resolve('/docs/languages')}>{t.hub.languagesLink}</a>
	</p>
</DocPage>
