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
	 */
	import { EmptyState } from '$lib/components/ui/empty-state';
	import RelationTypeTable from './RelationTypeTable.svelte';
	import RenameRelationTypeDialog from './RenameRelationTypeDialog.svelte';
	import WidenRelationTypeDialog from './WidenRelationTypeDialog.svelte';
	import MergeRelationTypesDialog from './MergeRelationTypesDialog.svelte';
	import TranslateRelationTypeDialog from './TranslateRelationTypeDialog.svelte';
	import type { Locale, Messages } from '$lib/i18n';
	import type { RelationTypeCatalogueRow } from '@canonry/db';
	import type { RelationCatalogueFormResult } from './types.js';

	let {
		types,
		t,
		relationTypeLabel,
		locale,
		canManage,
		form
	}: {
		types: RelationTypeCatalogueRow[];
		t: Messages['universe']['settings']['relations'];
		relationTypeLabel: Messages['relationTypeLabel'];
		locale: Locale;
		canManage: boolean;
		form?: RelationCatalogueFormResult | undefined;
	} = $props();

	const shipped = $derived(types.filter((row) => row.universeId === null));
	const own = $derived(types.filter((row) => row.universeId !== null));

	let renameTarget = $state<RelationTypeCatalogueRow | null>(null);
	let widenTarget = $state<RelationTypeCatalogueRow | null>(null);
	let translateTarget = $state<RelationTypeCatalogueRow | null>(null);
	let mergeOpen = $state(false);

	const renameForm = $derived(form?.action === 'rename' ? form : undefined);
	const widenForm = $derived(form?.action === 'widen' ? form : undefined);
	const mergeForm = $derived(form?.action === 'merge' ? form : undefined);
	const translateForm = $derived(form?.action === 'translate' ? form : undefined);
</script>

<div class="flex flex-col gap-8">
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
		<RelationTypeTable types={shipped} {t} {relationTypeLabel} {locale} shipped={true} />
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
