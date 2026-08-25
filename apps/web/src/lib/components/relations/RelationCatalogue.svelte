<script lang="ts">
	/**
	 * #192: the whole relation catalogue - a universe's own types and the shipped ten,
	 * the shipped half structurally read-only (SPEC.md §4.2, K1's "the shipped
	 * catalogue is read-only from here" - editing one of the ten is a migration, not a
	 * setting). `canManage` mirrors the settings page's own `viewerForbiddenError` guard:
	 * a viewer sees both lists and their counts but no action ever renders for them,
	 * matching how the AI-toggle and precedence sections already gate their own controls.
	 *
	 * Issue #450 (U1, DECISIONS.md "Round sixteen"): a universe's own types render first
	 * and get the room - `RelationTypeTable` draws them as one spacious row each rather
	 * than a table, actions included - and the shipped ten move below as reference,
	 * compact and read-only. Merge is a per-row trigger now too (rename/widen/translate's
	 * neighbour), not a section-level button: every own row opens the same
	 * `MergeRelationTypesDialog`, unpre-filled, because that dialog's own contract
	 * (fresh `fromTypeId`/`intoTypeId` state on every open) is exactly what this issue
	 * keeps unchanged - see `RelationTypeTable`'s own comment on `onMerge`.
	 *
	 * Issue #795 (DECISIONS.md "Round twenty-one", amends U1): this component itself is
	 * unmoved and unchanged in shape - what moved is the route around it, from
	 * `/w/[universe]/settings/relations` to `/w/[universe]/relations`, and what changed
	 * inside `RelationTypeTable` is the markup each section renders (a real `<table>`
	 * now, not a `<ul>`), not this file's own section/dialog wiring.
	 */
	import { EmptyState } from '$lib/components/ui/empty-state';
	import RelationTypeTable from './RelationTypeTable.svelte';
	import RenameRelationTypeDialog from './RenameRelationTypeDialog.svelte';
	import WidenRelationTypeDialog from './WidenRelationTypeDialog.svelte';
	import ForkShippedRelationTypeDialog from './ForkShippedRelationTypeDialog.svelte';
	import MergeRelationTypesDialog from './MergeRelationTypesDialog.svelte';
	import TranslateRelationTypeDialog from './TranslateRelationTypeDialog.svelte';
	import type { Locale, Messages } from '$lib/i18n';
	import type { RelationTypeCatalogueRow } from '@canonry/db';
	import type { EntityType } from '@canonry/db/schema';
	import { relationTypeDisplayLabel, type RelationCatalogueFormResult } from './types.js';

	let {
		types,
		t,
		relationTypeLabel,
		locale,
		canManage,
		form,
		forkTypeId = null,
		forkAddFrom = [],
		forkAddTo = []
	}: {
		types: RelationTypeCatalogueRow[];
		t: Messages['universe']['relations'];
		relationTypeLabel: Messages['relationTypeLabel'];
		locale: Locale;
		canManage: boolean;
		form?: RelationCatalogueFormResult | undefined;
		/** Issue #648: the review queue's shipped-refusal notice links here with the type it
		 * refused and the pair it needs, so the GM lands on the question rather than on the
		 * page. Null whenever the GM opened the catalogue by itself. */
		forkTypeId?: string | null;
		forkAddFrom?: EntityType[];
		forkAddTo?: EntityType[];
	} = $props();

	const shipped = $derived(types.filter((row) => row.universeId === null));
	const own = $derived(types.filter((row) => row.universeId !== null));

	let renameTarget = $state<RelationTypeCatalogueRow | null>(null);
	let widenTarget = $state<RelationTypeCatalogueRow | null>(null);
	let translateTarget = $state<RelationTypeCatalogueRow | null>(null);
	let forkTarget = $state<RelationTypeCatalogueRow | null>(null);
	/** The deep link only ever opens the dialog once: the state above owns it from the first
	 * render on, so closing it does not reopen on the next reactive pass, and the pair only
	 * pre-fills the open the link asked for. */
	let deepLinkConsumed = $state(false);
	$effect(() => {
		if (deepLinkConsumed || !forkTypeId || !canManage) return;
		deepLinkConsumed = true;
		forkTarget = types.find((row) => row.id === forkTypeId && row.universeId === null) ?? null;
	});
	let mergeOpen = $state(false);

	const renameForm = $derived(form?.action === 'rename' ? form : undefined);
	const widenForm = $derived(form?.action === 'widen' ? form : undefined);
	const mergeForm = $derived(form?.action === 'merge' ? form : undefined);
	const translateForm = $derived(form?.action === 'translate' ? form : undefined);
	const forkForm = $derived(form?.action === 'fork' ? form : undefined);
	/** The word the notice uses is resolved the same way every other row's is: through the
	 * i18n bundle on the shipped type's own key (#196), so an Italian GM reads the Italian
	 * label rather than the English text the fork stored. `createdLabel` from the action is
	 * only the fallback for a row this list somehow does not carry. */
	const forkNotice = $derived.by(() => {
		if (!forkForm || forkForm.error || !forkForm.createdLabel) return null;
		const source = types.find((row) => row.id === forkForm.typeId);
		return source
			? relationTypeDisplayLabel(source, relationTypeLabel, locale)
			: forkForm.createdLabel;
	});
</script>

<div class="flex flex-col gap-8">
	{#if forkNotice}
		<!-- Issue #648: a GM who arrived from a refused accept has to be told that the fork
		     alone changed nothing in canon, and where to go back to. Guardrail 1: the
		     relation is still a proposal waiting for its own accept. -->
		<p
			role="status"
			class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-body text-ink-2"
		>
			{t.fork.createdNotice(forkNotice)}
		</p>
	{/if}
	<section>
		<h2 class="text-title font-semibold text-ink">{t.ownHeading}</h2>
		<p class="mt-1 max-w-measure text-body text-ink-2">{t.ownDescription}</p>

		{#if own.length === 0}
			<div class="mt-3">
				<EmptyState kind="derived" message={t.emptyOwn} explanation={t.emptyOwnExplanation} />
			</div>
		{:else}
			<RelationTypeTable
				types={own}
				{t}
				{relationTypeLabel}
				{locale}
				shipped={false}
				{canManage}
				onRename={(row) => (renameTarget = row)}
				onWiden={(row) => (widenTarget = row)}
				onTranslate={(row) => (translateTarget = row)}
				onMerge={() => (mergeOpen = true)}
			/>
		{/if}
	</section>

	<section>
		<h2 class="text-title font-semibold text-ink">{t.shippedHeading}</h2>
		<p class="mt-1 max-w-measure text-body text-ink-2">{t.shippedDescription}</p>
		<RelationTypeTable
			types={shipped}
			{t}
			{relationTypeLabel}
			{locale}
			shipped={true}
			{canManage}
			onFork={(row) => (forkTarget = row)}
		/>
	</section>
</div>

{#if renameTarget}
	<RenameRelationTypeDialog
		type={renameTarget}
		{t}
		{relationTypeLabel}
		{locale}
		form={renameForm}
		onClose={() => (renameTarget = null)}
	/>
{/if}
{#if widenTarget}
	<WidenRelationTypeDialog
		type={widenTarget}
		{t}
		{relationTypeLabel}
		{locale}
		form={widenForm}
		onClose={() => (widenTarget = null)}
	/>
{/if}
{#if forkTarget}
	<ForkShippedRelationTypeDialog
		type={forkTarget}
		{t}
		{relationTypeLabel}
		{locale}
		form={forkForm}
		addFrom={forkTarget.id === forkTypeId ? forkAddFrom : []}
		addTo={forkTarget.id === forkTypeId ? forkAddTo : []}
		onClose={() => (forkTarget = null)}
	/>
{/if}
{#if translateTarget}
	<TranslateRelationTypeDialog
		type={translateTarget}
		{t}
		{relationTypeLabel}
		{locale}
		form={translateForm}
		onClose={() => (translateTarget = null)}
	/>
{/if}
{#if canManage}
	<MergeRelationTypesDialog
		bind:open={mergeOpen}
		{own}
		allTypes={types}
		{t}
		{relationTypeLabel}
		{locale}
		form={mergeForm}
	/>
{/if}
