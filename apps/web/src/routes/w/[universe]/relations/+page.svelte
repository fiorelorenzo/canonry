<script lang="ts">
	/**
	 * #192, decision K1 (DECISIONS.md "Round six"): the relation catalogue a GM can
	 * actually see. Issue #795 (DECISIONS.md "Round twenty-one", amends U1): this leaf
	 * is a first-class page now, `/w/[universe]/relations`, not a settings sub-page -
	 * it is felt everywhere a relation is (the entries surface links here too), not
	 * only from Settings' Canon group. The old `/settings/relations` path redirects
	 * (`../settings/relations/+page.server.ts`). `eyebrow` names the universe the same
	 * way `/players` does one level below the world switcher, since nothing above this
	 * page's own band says which universe it belongs to any more.
	 */
	import { messages } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import RelationCatalogue from '$lib/components/relations/RelationCatalogue.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.relations);
	const relationTypeLabel = $derived(messages(data.locale).relationTypeLabel);
</script>

<svelte:head><title>{t.headTitle(data.universeName)}</title></svelte:head>

<Page
	width="working"
	eyebrow={data.universeName}
	title={t.title}
	description={t.description(data.universeName)}
>
	<div class="mt-8">
		<RelationCatalogue
			types={data.types}
			{t}
			{relationTypeLabel}
			locale={data.locale}
			canManage={data.canManage}
			form={form ?? undefined}
			forkTypeId={data.forkTypeId}
			forkAddFrom={data.forkAddFrom}
			forkAddTo={data.forkAddTo}
		/>
	</div>
</Page>
