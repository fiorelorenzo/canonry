<script lang="ts">
	/**
	 * The entry read view, B1 = C: a document plus a right column that switches between
	 * Relations, Facts, Images, History and Audit (C9 = B, #55).
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import EntryProseWithSecrets from '$lib/components/players/EntryProseWithSecrets.svelte';
	import EntryTabs from '$lib/components/entry/EntryTabs.svelte';
	import CompleteEntryControl from '$lib/components/entry/CompleteEntryControl.svelte';
	import LanguageControl from '$lib/components/entry/LanguageControl.svelte';
	import AuditFlagBadge from '$lib/components/audit/AuditFlagBadge.svelte';
	import type { FactRow } from '$lib/components/entry/FactsPanel.svelte';
	import type { FactSpan } from '$lib/markdown';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let t = $derived(messages(data.locale));

	let activeFact = $state<FactRow | null>(null);
	let activeDetailTab = $state<'relations' | 'facts' | 'images' | 'history' | 'audit'>('relations');

	function toggleFact(fact: FactRow): void {
		activeFact = activeFact?.id === fact.id ? null : fact;
	}

	let highlightSpan = $derived<FactSpan | null>(
		activeFact ? { start: activeFact.spanStart, end: activeFact.spanEnd } : null
	);

	// C9 = B: the title badge is a pointer into the aside's own Audit tab, not a second
	// copy of the flag list - clicking it switches the tab and scrolls it into view.
	function openAuditTab(): void {
		activeDetailTab = 'audit';
		document.getElementById('entry-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head><title>{data.entity.name} &middot; {data.universe.name}</title></svelte:head>

<div class="flex flex-col md:flex-row">
	<article class="min-w-0 flex-1 px-6 py-8 md:px-10">
		<p class="mb-3 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/u/${data.universe.slug}`)}>{data.universe.name}</a>
			/ {data.entity.type} /
			<span class="text-ink-2">{data.entity.name}</span>
		</p>

		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<div class="mb-1 flex flex-wrap items-center gap-2">
					<h1 class="text-3xl font-semibold text-ink">{data.entity.name}</h1>
					<AuditFlagBadge
						count={data.audit.flags.length}
						onOpen={openAuditTab}
						locale={data.locale}
					/>
				</div>
				<div class="flex flex-wrap items-center gap-2 text-sm text-muted">
					<span class="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-xs text-accent-ink">
						{data.entity.type}
					</span>
					<LanguageControl
						language={data.entity.language}
						languageSource={data.entity.languageSource}
						canWrite={data.media.canWrite}
						locale={data.locale}
					/>
					{#if data.entity.aliases.length > 0}
						<span>{t.entry.page.aliasesLabel(data.entity.aliases.join(', '))}</span>
					{/if}
				</div>
			</div>
			<div class="flex flex-none items-start gap-2">
				<CompleteEntryControl aiEnabled={data.universe.aiEnabled} locale={data.locale} />
				<a
					href={resolve(`/u/${data.universe.slug}/e/${data.entity.slug}/edit`)}
					class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				>
					{t.entry.page.editLink}
				</a>
			</div>
		</div>

		{#if data.proposals.count > 0}
			<!-- C1 = B: the marking below is the "unmistakable" cue on the sentences
			     themselves; this line is the discoverable path from noticing a marker to
			     actually reading the diff (#51), not a second marking treatment. -->
			<a
				href={data.proposals.planId
					? resolve(`/u/${data.universe.slug}/proposals/${data.proposals.planId}`)
					: resolve(`/u/${data.universe.slug}/proposals`)}
				class="mb-6 flex items-center gap-2 rounded-md border border-ai-line bg-ai-bg px-3 py-2 text-sm text-ink-2 hover:brightness-95"
			>
				<span class="font-mono text-xs font-bold text-ai">{data.proposals.count}</span>
				<span>
					{t.entry.page.pendingProposalsText(data.proposals.count)}
				</span>
			</a>
		{/if}

		<EntryProseWithSecrets
			body={data.entity.body}
			universeSlug={data.universe.slug}
			mentionTargets={data.mentionTargets}
			locale={data.locale}
			{highlightSpan}
			markedSentences={new Set(data.proposals.markedSentences)}
		/>
	</article>

	<EntryTabs
		universeSlug={data.universe.slug}
		relations={data.relations}
		facts={data.facts}
		history={data.history}
		audit={data.audit.flags}
		bind:active={activeDetailTab}
		activeFactId={activeFact?.id ?? null}
		onFactToggle={toggleFact}
		media={{
			entitySlug: data.entity.slug,
			entityName: data.entity.name,
			entityType: data.entity.type,
			aiEnabled: data.universe.aiEnabled,
			canWrite: data.media.canWrite,
			assets: data.media.assets,
			styleModifier: data.media.style.modifier,
			entityImagePromptModifier: data.entity.imagePromptModifier,
			portraitPrice: data.media.generate.portrait.price,
			variantsPrice: data.media.generate.variants.price,
			portraitModel: data.media.generate.portrait.model,
			variantsModel: data.media.generate.variants.model
		}}
		locale={data.locale}
	/>
</div>
