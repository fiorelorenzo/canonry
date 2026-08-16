<script lang="ts">
	/**
	 * #192: the whole relation catalogue - shipped types and a universe's own, side by
	 * side, the shipped half structurally read-only (SPEC.md §4.2, K1's "the shipped
	 * catalogue is read-only from here" - editing one of the ten is a migration, not a
	 * setting). `canManage` mirrors the settings page's own `viewerForbiddenError` guard:
	 * a viewer sees the tables and counts but no action ever renders for them, matching
	 * how the AI-toggle and precedence sections already gate their own controls.
	 */
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
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
		<h2 class="text-sm font-semibold text-ink">{t.shippedHeading}</h2>
		<p class="mt-1 max-w-measure text-sm text-ink-2">{t.shippedDescription}</p>
		<RelationTypeTable types={shipped} {t} {relationTypeLabel} {locale} shipped={true} />
	</section>

	<section>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-ink">{t.ownHeading}</h2>
				<p class="mt-1 max-w-measure text-sm text-ink-2">{t.ownDescription}</p>
			</div>
			{#if canManage && own.length > 0}
				<Button variant="secondary" size="sm" onclick={() => (mergeOpen = true)}>
					{t.merge.trigger}
				</Button>
			{/if}
		</div>

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
			/>
		{/if}
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
