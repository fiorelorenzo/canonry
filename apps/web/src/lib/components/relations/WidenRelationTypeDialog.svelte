<script lang="ts">
	/**
	 * #192, the manual half of the resolver's `widen-proposed` (#189). Only ever adds
	 * entity types to `allowed_from`/`allowed_to` - already-admitted types render as a
	 * plain sentence, not disabled checkboxes, because a disabled checkbox does not
	 * submit its value at all and would silently drop an existing allowance the moment a
	 * GM touched the form. Checking a box here only ever means "add this", never "keep
	 * this".
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
	import type { EntityType } from '@canonry/db/schema';
	import { relationTypeDisplayLabel, type WidenActionResult } from './types.js';

	const ALL_ENTITY_TYPES: EntityType[] = [
		'character',
		'place',
		'faction',
		'item',
		'event',
		'session'
	];

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
		form?: WidenActionResult | undefined;
		onClose: () => void;
	} = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onClose();
	});

	const errorForThisType = $derived(
		form && form.action === 'widen' && form.typeId === type.id ? form.error : undefined
	);

	const addableFrom = $derived(ALL_ENTITY_TYPES.filter((et) => !type.allowedFrom.includes(et)));
	const addableTo = $derived(ALL_ENTITY_TYPES.filter((et) => !type.allowedTo.includes(et)));
</script>

<Dialog bind:open>
	<DialogContent closeLabel={t.close}>
		<DialogHeader>
			<DialogTitle
				>{t.widen.dialogTitle(
					relationTypeDisplayLabel(type, relationTypeLabel, locale)
				)}</DialogTitle
			>
			<DialogDescription>{t.widen.dialogDescription}</DialogDescription>
		</DialogHeader>
		<form
			method="POST"
			action="?/widenRelationType"
			class="flex flex-col gap-4"
			use:enhance={() => {
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') open = false;
				};
			}}
		>
			<input type="hidden" name="typeId" value={type.id} />

			<fieldset class="flex flex-col gap-2">
				<legend class="text-body font-medium text-ink">{t.widen.fromHeading}</legend>
				<p class="text-label text-muted">
					{t.widen.currentlyAdmits}: {type.allowedFrom
						.map((et) => t.entityTypeLabel(et))
						.join(', ')}
				</p>
				{#if addableFrom.length > 0}
					<div class="flex flex-wrap gap-3">
						{#each addableFrom as et (et)}
							<label class="flex items-center gap-1.5 text-body text-ink-2">
								<input type="checkbox" name="addFrom" value={et} class="size-4" />
								{t.widen.addOption(t.entityTypeLabel(et))}
							</label>
						{/each}
					</div>
				{/if}
			</fieldset>

			<fieldset class="flex flex-col gap-2">
				<legend class="text-body font-medium text-ink">{t.widen.toHeading}</legend>
				<p class="text-label text-muted">
					{t.widen.currentlyAdmits}: {type.allowedTo.map((et) => t.entityTypeLabel(et)).join(', ')}
				</p>
				{#if addableTo.length > 0}
					<div class="flex flex-wrap gap-3">
						{#each addableTo as et (et)}
							<label class="flex items-center gap-1.5 text-body text-ink-2">
								<input type="checkbox" name="addTo" value={et} class="size-4" />
								{t.widen.addOption(t.entityTypeLabel(et))}
							</label>
						{/each}
					</div>
				{/if}
			</fieldset>

			{#if addableFrom.length === 0 && addableTo.length === 0}
				<p class="text-body text-muted">{t.widen.noChangeError}</p>
			{/if}

			{#if errorForThisType}
				<p class="text-body text-danger">{errorForThisType}</p>
			{/if}

			<DialogFooter>
				<Button type="submit" disabled={addableFrom.length === 0 && addableTo.length === 0}>
					{t.widen.submit}
				</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
