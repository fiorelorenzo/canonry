<script lang="ts">
	/**
	 * #192: one row shape shared by a universe's own types and the shipped ten, driven
	 * by `shipped`. `summary` is the one function that turns a row into its line of
	 * prose (inverse label, what it connects, cardinality when it is not the unmarked
	 * `many_to_many` case), so the shipped list and the own list can never describe the
	 * same fact two different ways - only how much room a row gets and whether it
	 * carries actions differs between the two branches below.
	 *
	 * Issue #450 (U1, DECISIONS.md "Round sixteen"): a universe's own types get a
	 * two-line cell (label, then the summary prose) and every action; the shipped ten
	 * stay a compact one-line reference, with no badge repeating the section heading
	 * it already sits under.
	 *
	 * Issue #795 (DECISIONS.md "Round twenty-one"): both are now a real `<table>` -
	 * the product's own convention for a list with counts and per-row actions (compare
	 * `admin/models`, `admin/pricing`, `EntryTable`) - rather than the `<ul>`/`<li>`
	 * list U1 built, so a `Uses` column lines every row's count up under one header
	 * instead of it trailing the prose at whatever width that prose happened to wrap
	 * to. `usageCount`'s old sentence is gone with it: a bare, right-aligned, tabular
	 * number under a header already named `Uses` says the same thing a table's numbers
	 * always do.
	 */
	import { Button } from '$lib/components/ui/button';
	import { TableScroll } from '$lib/components/ui/table';
	import type { RelationTypeCatalogueRow } from '@canonry/db';
	import type { Locale, Messages } from '$lib/i18n';
	import { relationTypeDisplayLabel, relationTypeDisplayInverseLabel } from './types.js';

	let {
		types,
		t,
		relationTypeLabel,
		locale,
		shipped,
		canManage = false,
		onRename,
		onWiden,
		onTranslate,
		onMerge,
		onFork
	}: {
		types: RelationTypeCatalogueRow[];
		t: Messages['universe']['relations'];
		relationTypeLabel: Messages['relationTypeLabel'];
		locale: Locale;
		shipped: boolean;
		canManage?: boolean;
		onRename?: (row: RelationTypeCatalogueRow) => void;
		onWiden?: (row: RelationTypeCatalogueRow) => void;
		onTranslate?: (row: RelationTypeCatalogueRow) => void;
		/** Unlike the other three, this never carries a row: `MergeRelationTypesDialog`
		 * (kept byte-for-byte, per this issue's own invariant) always opens with blank
		 * `fromTypeId`/`intoTypeId` state, so a row's own trigger cannot pre-select
		 * itself as the losing side - it only opens the same dialog every other own row
		 * already can. */
		onMerge?: () => void;
		/** Issue #648: the shipped half's only action. A shipped row is read-only, and this
		 * does not change that: it creates a *copy* under this universe's id, which is the
		 * one thing #192's own "a universe can add its own types" always allowed and never
		 * built a control for. */
		onFork?: (row: RelationTypeCatalogueRow) => void;
	} = $props();

	function summary(row: RelationTypeCatalogueRow): string {
		const inverseLabel = relationTypeDisplayInverseLabel(row, relationTypeLabel, locale);
		const from = row.allowedFrom.map((type) => t.entityTypeLabel(type)).join(', ');
		const to = row.allowedTo.map((type) => t.entityTypeLabel(type)).join(', ');
		const cardinality =
			row.cardinality === 'many_to_many' ? null : t.cardinalityLabel(row.cardinality);
		return t.summary(inverseLabel, from, to, cardinality);
	}
</script>

{#if shipped}
	<TableScroll class="mt-3" label={t.shippedHeading}>
		<table class="w-full border-collapse text-body">
			<thead>
				<tr
					class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
				>
					<th class="px-3 py-2 font-normal">{t.table.label}</th>
					<th class="px-3 py-2 text-right font-normal">{t.table.uses}</th>
					{#if canManage}
						<th class="px-3 py-2 font-normal"><span class="sr-only">{t.table.actions}</span></th>
					{/if}
				</tr>
			</thead>
			<tbody class="divide-y divide-line">
				{#each types as row (row.id)}
					<tr class="bg-panel">
						<td class="px-3 py-2 text-ink-2">
							<span class="font-medium text-ink"
								>{relationTypeDisplayLabel(row, relationTypeLabel, locale)}</span
							>
							{summary(row)}
						</td>
						<td class="px-3 py-2 text-right text-ink-2 tabular-nums">{row.usageCount}</td>
						{#if canManage}
							<td class="px-3 py-2 text-right">
								{#if onFork}
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-label"
										onclick={() => onFork?.(row)}
									>
										{t.fork.trigger}
									</Button>
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</TableScroll>
{:else}
	<TableScroll class="mt-3" label={t.ownHeading}>
		<table class="w-full border-collapse text-body">
			<thead>
				<tr
					class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
				>
					<th class="px-3 py-2 font-normal">{t.table.label}</th>
					<th class="px-3 py-2 text-right font-normal">{t.table.uses}</th>
					{#if canManage}
						<th class="px-3 py-2 font-normal"><span class="sr-only">{t.table.actions}</span></th>
					{/if}
				</tr>
			</thead>
			<tbody class="divide-y divide-line">
				{#each types as row (row.id)}
					<tr class="bg-panel align-top">
						<td class="px-3 py-3 align-top">
							<p class="font-medium text-ink">
								{relationTypeDisplayLabel(row, relationTypeLabel, locale)}
							</p>
							<p class="mt-1 max-w-measure text-body text-ink-2">{summary(row)}</p>
						</td>
						<td class="px-3 py-3 text-right align-top text-ink-2 tabular-nums">{row.usageCount}</td>
						{#if canManage}
							<td class="px-3 py-3 align-top">
								<div class="flex flex-wrap justify-end gap-3">
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-label"
										onclick={() => onRename?.(row)}
									>
										{t.rename.trigger}
									</Button>
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-label"
										onclick={() => onWiden?.(row)}
									>
										{t.widen.trigger}
									</Button>
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-label"
										onclick={() => onTranslate?.(row)}
									>
										{t.translate.trigger}
									</Button>
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-label"
										onclick={() => onMerge?.()}
									>
										{t.merge.trigger}
									</Button>
								</div>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</TableScroll>
{/if}
