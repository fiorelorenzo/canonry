<script lang="ts">
	/**
	 * #192, decision K1 (DECISIONS.md "Round six"): the relation catalogue a GM can
	 * actually see. One `PageHeader` at the top of this leaf (I9's shared shape, used by
	 * every other settings page under `/settings/*`); the universe settings page links
	 * here rather than inlining this much table and dialog, matching how F4's export gets
	 * its own leaf instead of living inline in Settings too.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader } from '$lib/components/ui/page-header';
	import RelationCatalogue from '$lib/components/relations/RelationCatalogue.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.settings.relations);
</script>

<svelte:head><title>{t.headTitle(data.universeName)}</title></svelte:head>

<div class="mx-auto max-w-4xl px-8 py-10">
	<p class="mb-3 text-xs text-muted">
		<a class="hover:underline" href={resolve(`/w/${data.universeSlug}/settings`)}>{t.backLink}</a>
	</p>

	<PageHeader
		title={t.title}
		eyebrow={data.universeName}
		description={t.description(data.universeName)}
	/>

	<div class="mt-8">
		<RelationCatalogue types={data.types} {t} canManage={data.canManage} form={form ?? undefined} />
	</div>
</div>
