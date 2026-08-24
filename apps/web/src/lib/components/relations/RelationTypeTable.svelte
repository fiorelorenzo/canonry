<script lang="ts">
	/**
	 * #192: one row shape shared by a universe's own types and the shipped ten, driven
	 * by `shipped`. Issue #450 (U1, DECISIONS.md "Round sixteen"): what used to be a
	 * six-column table is a list either way now - a spacious card per own type (its
	 * label, a line of prose for its inverse and what it connects, then rename/widen/
	 * translate/merge), or one compact reference line per shipped type, with no badge
	 * repeating the section heading it already sits under. `summary` is the one
	 * function that turns a row into that line of prose for both halves, so the shipped
	 * list and the own list can never describe the same fact two different ways - only
	 * how much room a row gets and whether it carries actions differs between the two
	 * branches below.
	 *
	 * Cardinality only ever appears inside that prose, and only when it is not
	 * `many_to_many`: the shipped ten are five one-to-many, two many-to-one and three
	 * many-to-many, so the old dedicated column spent a whole width saying the least
	 * surprising value most of the way down. A relation between two entries reads as
	 * many-to-many by default; only a narrower cardinality is worth a word.
	 */
	import { Button } from '$lib/components/ui/button';
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
		t: Messages['universe']['settings']['relations'];
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
	<ul
		class="mt-3 flex flex-col divide-y divide-line rounded-lg border border-line bg-panel text-body"
	>
		{#each types as row (row.id)}
			<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
				<p class="min-w-0 text-ink-2">
					<span class="font-medium text-ink"
						>{relationTypeDisplayLabel(row, relationTypeLabel, locale)}</span
					>
					{summary(row)}
				</p>
				<span class="flex shrink-0 items-baseline gap-3">
					{#if canManage && onFork}
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
					<span class="text-meta text-muted tabular-nums">{t.usageCount(row.usageCount)}</span>
				</span>
			</li>
		{/each}
	</ul>
{:else}
	<ul class="mt-3 flex flex-col gap-3">
		{#each types as row (row.id)}
			<li
				class="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 sm:flex-row sm:items-start sm:justify-between"
			>
				<div class="min-w-0">
					<p class="text-title font-semibold text-ink">
						{relationTypeDisplayLabel(row, relationTypeLabel, locale)}
					</p>
					<p class="mt-1 max-w-measure text-body text-ink-2">{summary(row)}</p>
					<p class="mt-1 text-meta text-muted tabular-nums">{t.usageCount(row.usageCount)}</p>
				</div>
				{#if canManage}
					<div class="flex shrink-0 flex-wrap gap-3 sm:pl-4">
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
				{/if}
			</li>
		{/each}
	</ul>
{/if}
