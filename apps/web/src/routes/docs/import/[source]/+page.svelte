<script lang="ts">
	/** Issue #121's sweep localizes only the DocPage chrome here (`docs.importGuide`):
	 * `section.heading`/block text below is per-source reference content from
	 * `importGuides.ts` and stays English, same reasoning as the import guides index. */
	import { resolve } from '$app/paths';
	import DocPage from '$lib/components/docs/DocPage.svelte';
	import DocsCallout from '$lib/components/docs/DocsCallout.svelte';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale).docs.importGuide);
</script>

<svelte:head>
	<title>{t.browserTitle(data.guide.label)}: Canonry</title>
</svelte:head>

<DocPage
	title={data.guide.label}
	eyebrow={t.eyebrow}
	backHref={resolve('/docs/import')}
	backLabel={t.backLabel}
>
	{#each data.guide.sections as section (section.heading)}
		<h2>{section.heading}</h2>
		{#each section.blocks as block, i (i)}
			{#if block.kind === 'p'}
				<p>{block.text}</p>
			{:else if block.kind === 'callout'}
				<DocsCallout tone={block.tone}>{block.text}</DocsCallout>
			{:else if block.ordered}
				<ol>
					{#each block.items as item (item)}
						<li>{item}</li>
					{/each}
				</ol>
			{:else}
				<ul>
					{#each block.items as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			{/if}
		{/each}
	{/each}
</DocPage>
