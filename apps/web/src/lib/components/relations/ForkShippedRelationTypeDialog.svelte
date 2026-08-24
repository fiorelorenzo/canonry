<script lang="ts">
	/**
	 * Issue #648: the shipped half of the resolver's admission gap, taken by hand.
	 *
	 * `WidenRelationTypeDialog` next to this one cannot serve a shipped type and never
	 * will: `widenRelationType` filters on `universe_id = universeId`, so a
	 * `universe_id`-null row structurally cannot match, because a shipped key is API
	 * surface (decision L1, #195) and the ten only change through a migration. What a GM
	 * can have instead is their own copy of that type, wider than the shipped one, which
	 * is exactly what `resolveAdmissionGap` already proposes when it meets the same gap at
	 * propose time: the fork keeps the shipped type's own label, inverse label and
	 * cardinality rather than inventing a fourth synonym.
	 *
	 * Same checkbox rule as the widen dialog, for the same reason: a box only ever means
	 * "the copy also joins this", never "keep this", so the types the shipped row already
	 * joins render as a sentence rather than as pre-checked boxes a submit could drop.
	 * The pair a refused accept named arrives pre-checked through `addFrom`/`addTo`, which
	 * is what makes the review queue's link a route rather than a page to re-derive the
	 * question on.
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
	import { relationTypeDisplayLabel, type ForkActionResult } from './types.js';

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
		addFrom = [],
		addTo = [],
		onClose
	}: {
		type: RelationTypeCatalogueRow;
		t: Messages['universe']['settings']['relations'];
		relationTypeLabel: Messages['relationTypeLabel'];
		locale: Locale;
		form?: ForkActionResult | undefined;
		/** The end types a refused accept named, pre-checked. Empty when the GM opened the
		 * dialog from the catalogue itself rather than from the review queue's link. */
		addFrom?: EntityType[];
		addTo?: EntityType[];
		onClose: () => void;
	} = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onClose();
	});

	const errorForThisType = $derived(
		form && form.action === 'fork' && form.typeId === type.id ? form.error : undefined
	);

	const addableFrom = $derived(ALL_ENTITY_TYPES.filter((et) => !type.allowedFrom.includes(et)));
	const addableTo = $derived(ALL_ENTITY_TYPES.filter((et) => !type.allowedTo.includes(et)));
</script>

<Dialog bind:open>
	<DialogContent closeLabel={t.close}>
		<DialogHeader>
			<DialogTitle
				>{t.fork.dialogTitle(
					relationTypeDisplayLabel(type, relationTypeLabel, locale)
				)}</DialogTitle
			>
			<DialogDescription>{t.fork.dialogDescription}</DialogDescription>
		</DialogHeader>
		<form
			method="POST"
			action="?/forkShippedRelationType"
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
				<legend class="text-body font-medium text-ink">{t.fork.fromHeading}</legend>
				<p class="text-label text-muted">
					{t.fork.shippedAdmits}: {type.allowedFrom.map((et) => t.entityTypeLabel(et)).join(', ')}
				</p>
				{#if addableFrom.length > 0}
					<div class="flex flex-wrap gap-3">
						{#each addableFrom as et (et)}
							<label class="flex items-center gap-1.5 text-body text-ink-2">
								<input
									type="checkbox"
									name="addFrom"
									value={et}
									checked={addFrom.includes(et)}
									class="size-4"
								/>
								{t.fork.addOption(t.entityTypeLabel(et))}
							</label>
						{/each}
					</div>
				{/if}
			</fieldset>

			<fieldset class="flex flex-col gap-2">
				<legend class="text-body font-medium text-ink">{t.fork.toHeading}</legend>
				<p class="text-label text-muted">
					{t.fork.shippedAdmits}: {type.allowedTo.map((et) => t.entityTypeLabel(et)).join(', ')}
				</p>
				{#if addableTo.length > 0}
					<div class="flex flex-wrap gap-3">
						{#each addableTo as et (et)}
							<label class="flex items-center gap-1.5 text-body text-ink-2">
								<input
									type="checkbox"
									name="addTo"
									value={et}
									checked={addTo.includes(et)}
									class="size-4"
								/>
								{t.fork.addOption(t.entityTypeLabel(et))}
							</label>
						{/each}
					</div>
				{/if}
			</fieldset>

			{#if addableFrom.length === 0 && addableTo.length === 0}
				<p class="text-body text-muted">{t.fork.noChangeError}</p>
			{/if}

			{#if errorForThisType}
				<p class="text-body text-danger">{errorForThisType}</p>
			{/if}

			<DialogFooter>
				<Button type="submit" disabled={addableFrom.length === 0 && addableTo.length === 0}>
					{t.fork.submit}
				</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
