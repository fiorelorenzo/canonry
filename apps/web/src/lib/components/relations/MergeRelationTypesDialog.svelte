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
	 *
	 * Issue #286, decision O4 = B: a relation type is a vocabulary rather than the GM's
	 * own free data, ten shipped keys plus whatever this universe has added, so both
	 * fields are the Select. The list is short and closed, and a combobox would put a
	 * search box in front of six rows.
	 *
	 * **Without JavaScript this form stops being progressive, and it always was.** The
	 * whole form lives inside a bits-ui dialog, which no reader with scripting off can
	 * open, so there is nothing here for a `<noscript>` fallback to rescue: the two
	 * `Select.Root name=...` hidden inputs are the only value carriers, which is correct
	 * because JavaScript is the only way to reach this markup at all.
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
	import * as Select from '$lib/components/ui/select';
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
				<label class="text-body font-medium text-ink" for="merge-from">{t.merge.fromLabel}</label>
				<Select.Root
					type="single"
					name="fromTypeId"
					required
					bind:value={fromTypeId}
					onValueChange={(next) => {
						if (intoTypeId === next) intoTypeId = '';
					}}
				>
					<Select.Trigger id="merge-from" class="w-full">
						{#if fromType}
							{relationTypeDisplayLabel(fromType, relationTypeLabel, locale)}
						{:else}
							<span class="text-muted-foreground">{t.merge.pickFromPlaceholder}</span>
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each own as row (row.id)}
							{@const label = relationTypeDisplayLabel(row, relationTypeLabel, locale)}
							<Select.Item value={row.id} {label}>{label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="flex flex-col gap-1.5">
				<label class="text-body font-medium text-ink" for="merge-into">{t.merge.intoLabel}</label>
				<Select.Root type="single" name="intoTypeId" required bind:value={intoTypeId}>
					<Select.Trigger id="merge-into" class="w-full" disabled={!fromTypeId}>
						{#if intoType}
							{relationTypeDisplayLabel(intoType, relationTypeLabel, locale)}
						{:else}
							<span class="text-muted-foreground">{t.merge.pickIntoPlaceholder}</span>
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each intoOptions as row (row.id)}
							{@const label = relationTypeDisplayLabel(row, relationTypeLabel, locale)}
							<Select.Item value={row.id} {label}>{label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			{#if fromType && intoType}
				<p class="rounded-md border border-line bg-panel-2 px-3 py-2 text-body text-ink-2">
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
				<p class="text-body text-danger">{form.error}</p>
			{/if}
			{#if form?.action === 'merge' && form.intoLabel && form.movedCount !== undefined}
				<p class="text-body text-ink-2">
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
