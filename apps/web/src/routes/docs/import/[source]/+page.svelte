<script lang="ts">
	import { resolve } from '$app/paths';
	import DocPage from '$lib/components/docs/DocPage.svelte';
	import DocsCallout from '$lib/components/docs/DocsCallout.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.guide.label} import guide: Canonry</title>
</svelte:head>

<DocPage
	title={data.guide.label}
	eyebrow="Import guides"
	backHref={resolve('/docs/import')}
	backLabel="Import guides"
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
