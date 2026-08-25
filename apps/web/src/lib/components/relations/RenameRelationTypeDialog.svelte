<script lang="ts">
	/**
	 * #192, SPEC.md §4.2: one row holds both labels, so renaming is one form for both
	 * sides rather than two edits that could drift. Opened for exactly one row at a time
	 * by the parent (`RelationCatalogue.svelte`), which owns which row is being renamed;
	 * this component only renders the form and closes itself on a successful submit.
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
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { Locale, Messages } from '$lib/i18n';
	import type { RelationTypeCatalogueRow } from '@canonry/db';
	import { relationTypeDisplayLabel, type RenameActionResult } from './types.js';

	let {
		type,
		t,
		relationTypeLabel,
		locale,
		form,
		onClose
	}: {
		type: RelationTypeCatalogueRow;
		t: Messages['universe']['relations'];
		relationTypeLabel: Messages['relationTypeLabel'];
		locale: Locale;
		form?: RenameActionResult | undefined;
		onClose: () => void;
	} = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onClose();
	});

	const errorForThisType = $derived(
		form && form.action === 'rename' && form.typeId === type.id ? form.error : undefined
	);
</script>

<Dialog bind:open>
	<DialogContent closeLabel={t.close}>
		<DialogHeader>
			<DialogTitle
				>{t.rename.dialogTitle(
					relationTypeDisplayLabel(type, relationTypeLabel, locale)
				)}</DialogTitle
			>
			<DialogDescription>{t.rename.dialogDescription}</DialogDescription>
		</DialogHeader>
		<form
			method="POST"
			action="?/renameRelationType"
			class="flex flex-col gap-4"
			use:enhance={() => {
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') open = false;
				};
			}}
		>
			<input type="hidden" name="typeId" value={type.id} />
			<div class="flex flex-col gap-1.5">
				<Label for="rename-label">{t.rename.labelField}</Label>
				<Input id="rename-label" name="label" required value={type.label} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="rename-inverse-label">{t.rename.inverseLabelField}</Label>
				<Input id="rename-inverse-label" name="inverseLabel" required value={type.inverseLabel} />
			</div>
			{#if errorForThisType}
				<p class="text-body text-danger">{errorForThisType}</p>
			{/if}
			<DialogFooter>
				<Button type="submit">{t.rename.submit}</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
