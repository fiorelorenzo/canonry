<script lang="ts">
	/**
	 * #192: "say how many relations will move before it happens, and never lose one
	 * silently." The count comes straight from the already-loaded `usageCount` on the
	 * losing type - no separate preview round trip, since the table on the page already
	 * shows the exact number that is about to move. The server (`mergeRelationTypes`,
	 * packages/db/src/queries/relation-types.ts) confirms it back after the fact and
	 * reports any relation that already existed under the target label separately, so
	 * "never lose one silently" holds even when two relations turn out to describe the
	 * same fact once merged.
	 */
	import { enhance } from '$app/forms';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { Locale, Messages } from '$lib/i18n';
	import type { RelationTypeCatalogueRow } from '@canonry/db';
	import { relationTypeDisplayLabel, type MergeActionResult } from './types.js';

	let {
		open = $bindable(false),
		own,
		allTypes,
		t,
		relationTypeLabel,
		locale,
		form
	}: {
		open?: boolean;
		/** Only a universe's own type may be the losing side. */
		own: RelationTypeCatalogueRow[];
		/** Either side of the merge may be the target: shipped or the universe's own. */
		allTypes: RelationTypeCatalogueRow[];
		t: Messages['universe']['settings']['relations'];
		relationTypeLabel: Messages['relationTypeLabel'];
		locale: Locale;
		form?: MergeActionResult | undefined;
	} = $props();

	let fromTypeId = $state<string>('');
	let intoTypeId = $state<string>('');

	$effect(() => {
		if (open) return;
		fromTypeId = '';
		intoTypeId = '';
	});

	const fromType = $derived(own.find((row) => row.id === fromTypeId));
	const intoOptions = $derived(allTypes.filter((row) => row.id !== fromTypeId));
	const intoType = $derived(allTypes.find((row) => row.id === intoTypeId));
</script>

<Dialog bind:open>
	<DialogContent closeLabel={t.close}>
		<DialogHeader>
			<DialogTitle>{t.merge.dialogTitle}</DialogTitle>
			<DialogDescription>{t.merge.dialogDescription}</DialogDescription>
		</DialogHeader>
		<form
			method="POST"
			action="?/mergeRelationTypes"
			class="flex flex-col gap-4"
			use:enhance={() => {
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') open = false;
				};
			}}
		>
			<div class="flex flex-col gap-1.5">
				<label class="text-sm font-medium text-ink" for="merge-from">{t.merge.fromLabel}</label>
				<select
					id="merge-from"
					name="fromTypeId"
					required
					bind:value={fromTypeId}
					onchange={() => {
						if (intoTypeId === fromTypeId) intoTypeId = '';
					}}
					class="h-9 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm text-ink shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<option value="" disabled>{t.merge.pickFromPlaceholder}</option>
					{#each own as row (row.id)}
						<option value={row.id}
							>{relationTypeDisplayLabel(row, relationTypeLabel, locale)}</option
						>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label class="text-sm font-medium text-ink" for="merge-into">{t.merge.intoLabel}</label>
				<select
					id="merge-into"
					name="intoTypeId"
					required
					bind:value={intoTypeId}
					disabled={!fromTypeId}
					class="h-9 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm text-ink shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
				>
					<option value="" disabled>{t.merge.pickIntoPlaceholder}</option>
					{#each intoOptions as row (row.id)}
						<option value={row.id}
							>{relationTypeDisplayLabel(row, relationTypeLabel, locale)}</option
						>
					{/each}
				</select>
			</div>

			{#if fromType && intoType}
				<p class="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink-2">
					{fromType.usageCount === 0
						? t.merge.countWarningZero(
								relationTypeDisplayLabel(fromType, relationTypeLabel, locale),
								relationTypeDisplayLabel(intoType, relationTypeLabel, locale)
							)
						: t.merge.countWarning(
								fromType.usageCount,
								relationTypeDisplayLabel(fromType, relationTypeLabel, locale),
								relationTypeDisplayLabel(intoType, relationTypeLabel, locale)
							)}
				</p>
			{/if}

			{#if form?.action === 'merge' && form.error}
				<p class="text-sm text-danger">{form.error}</p>
			{/if}
			{#if form?.action === 'merge' && form.intoLabel && form.movedCount !== undefined}
				<p class="text-sm text-ink-2">
					{t.merge.movedToast(
						form.movedCount,
						(form.intoKey ? relationTypeLabel(form.intoKey)?.label : undefined) ?? form.intoLabel
					)}
				</p>
			{/if}

			<DialogFooter>
				<Button type="submit" disabled={!fromTypeId || !intoTypeId}>{t.merge.submit}</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
