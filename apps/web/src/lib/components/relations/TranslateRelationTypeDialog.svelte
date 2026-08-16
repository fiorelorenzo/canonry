<script lang="ts">
	/**
	 * Issue #198's whole interactive path: a GM's own type's per-locale reading, one
	 * field pair per locale the product ships (`LOCALES`, currently English and
	 * Italian). One submit writes every locale at once - `+page.server.ts`'s
	 * `translateRelationType` action loops over `LOCALES` and calls
	 * `setRelationTypeLabel`/`clearRelationTypeLabel` per locale, same as
	 * `RenameRelationTypeDialog`'s one-form-both-labels shape but widened to one row per
	 * locale instead of one row per direction.
	 *
	 * A field pair starts prefilled with whatever `type.labels[locale]` already holds,
	 * empty when nothing has been saved for that locale yet - never the authored label,
	 * because leaving a locale blank means "no translation here, fall back", not "same
	 * as authored". Submitting both fields of a locale blank clears that locale's
	 * translation back to fallback; the action rejects one filled and one blank as an
	 * incomplete pair, matching rename's own label/inverseLabel-together rule.
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
	import { LOCALES, LOCALE_NAMES, type Locale, type Messages } from '$lib/i18n';
	import type { RelationTypeCatalogueRow } from '@canonry/db';
	import { relationTypeDisplayLabel, type TranslateActionResult } from './types.js';

	let {
		type,
		t,
		relationTypeLabel,
		locale,
		form,
		onClose
	}: {
		type: RelationTypeCatalogueRow;
		t: Messages['universe']['settings']['relations'];
		relationTypeLabel: Messages['relationTypeLabel'];
		locale: Locale;
		form?: TranslateActionResult | undefined;
		onClose: () => void;
	} = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onClose();
	});

	const errorForThisType = $derived(
		form && form.action === 'translate' && form.typeId === type.id ? form.error : undefined
	);
</script>

<Dialog bind:open>
	<DialogContent closeLabel={t.close}>
		<DialogHeader>
			<DialogTitle
				>{t.translate.dialogTitle(
					relationTypeDisplayLabel(type, relationTypeLabel, locale)
				)}</DialogTitle
			>
			<DialogDescription>{t.translate.dialogDescription}</DialogDescription>
		</DialogHeader>
		<form
			method="POST"
			action="?/translateRelationType"
			class="flex flex-col gap-5"
			use:enhance={() => {
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') open = false;
				};
			}}
		>
			<input type="hidden" name="typeId" value={type.id} />
			{#each LOCALES as loc (loc)}
				<fieldset class="flex flex-col gap-2">
					<legend class="text-sm font-medium text-ink">{LOCALE_NAMES[loc]}</legend>
					<div class="flex flex-col gap-1.5">
						<Label for="translate-label-{loc}">{t.translate.labelField}</Label>
						<Input
							id="translate-label-{loc}"
							name="label_{loc}"
							value={type.labels?.[loc]?.label ?? ''}
						/>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="translate-inverse-label-{loc}">{t.translate.inverseLabelField}</Label>
						<Input
							id="translate-inverse-label-{loc}"
							name="inverseLabel_{loc}"
							value={type.labels?.[loc]?.inverseLabel ?? ''}
						/>
					</div>
				</fieldset>
			{/each}
			{#if errorForThisType}
				<p class="text-sm text-danger">{errorForThisType}</p>
			{/if}
			<DialogFooter>
				<Button type="submit">{t.translate.submit}</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
