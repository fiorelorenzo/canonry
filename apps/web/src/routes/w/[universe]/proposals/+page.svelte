<script lang="ts">
	/**
	 * C2 = A: the inbox. Round seventeen V2 = A (#498, docs/ux/DECISIONS.md): "the inbox
	 * is the queue" - this page used to be three rows that only named what plan or import
	 * job was waiting and linked out to read it; now every waiting proposal renders here,
	 * as a `ProposalQueue` group per plan/import job, with C6's keyboard queue running
	 * the whole list rather than one plan's slice.
	 *
	 * Groups sort newest-first regardless of origin - a propagation plan and an import
	 * job are not two buckets on this page, they are the same queue in arrival order,
	 * which is the whole point of "the inbox is the queue" (previously this page listed
	 * every propagation plan, then every import job, in two separate lists).
	 */
	import { dateFormat, messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import ProposalQueue, {
		type ProposalGroupView
	} from '$lib/components/proposals/ProposalQueue.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).proposals);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}

	let rawGroups = $derived(
		[
			...data.planGroups.map((g) => ({
				...g,
				kind: 'plan' as const,
				sortKey: new Date(g.createdAt).getTime()
			})),
			...data.importGroups.map((g) => ({
				...g,
				kind: 'import' as const,
				sortKey: new Date(g.createdAt).getTime()
			}))
		].sort((a, b) => b.sortKey - a.sortKey)
	);

	let groups = $derived<ProposalGroupView[]>([
		// Round eighteen: the plan-less group goes first, because it is the one nothing else
		// in the product surfaces. A pending proposal with no plan is written by the warm
		// cache's own NPC draft (`packages/warm/src/store.ts`), was counted by the sidebar,
		// and had nowhere to be read: "mi dice che c'e una proposta nella sidebar ma poi
		// nella pagina proposte non c'e niente". Its heading names where it came from
		// rather than a plan it does not have.
		...(data.planlessCandidates.length > 0
			? [
					{
						id: 'planless',
						heading: t.inbox.planless,
						meta: t.inbox.entriesLabel(data.planlessCandidates.length),
						importJobId: null,
						candidates: data.planlessCandidates
					}
				]
			: []),
		...rawGroups.map((g) =>
			g.kind === 'plan'
				? {
						id: g.id,
						heading: t.inbox.from(t.provenance(g.trigger, g.triggerEntityName)),
						meta: `${t.inbox.entriesLabel(g.total)} \u00b7 ${formatWhen(g.createdAt)}`,
						importJobId: null,
						candidates: g.candidates
					}
				: {
						id: g.id,
						heading: t.inbox.importFrom(g.playbook),
						meta: `${t.inbox.entriesLabel(g.total)} \u00b7 ${formatWhen(g.createdAt)}`,
						importJobId: g.id,
						candidates: g.candidates
					}
		)
	]);
</script>

<svelte:head><title>{t.title} &middot; {data.universe.name}</title></svelte:head>

<PageHeader title={t.title} />
<PageBody width="working">
	<div class="px-6 py-8">
		{#if groups.length === 0}
			<EmptyState kind="settled" message={t.inbox.empty} />
		{:else}
			<ProposalQueue
				{groups}
				universeSlug={data.universe.slug}
				diffPriceCredits={data.diffPriceCredits}
				locale={data.locale}
			/>
		{/if}
	</div>
</PageBody>
