<script lang="ts">
	/**
	 * #192: one table shape shared by the shipped catalogue and a universe's own types.
	 * `shipped` drives two differences, not one component per half: a "shipped" badge next
	 * to the label (K1's "a shipped type looks different from one this world invented",
	 * DECISIONS.md "Round six"), and no actions column at all - the shipped ten are
	 * read-only from this page structurally, not just by hiding buttons over an editable
	 * row. G2's tabular figures apply to the one numeric column, usage count.
	 */
	import { Badge } from '$lib/components/ui/badge';
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
		onTranslate
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
	} = $props();
</script>

<div class="mt-3 overflow-x-auto rounded-lg border border-line">
	<table class="w-full border-collapse text-sm">
		<thead>
			<tr
				class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
			>
				<th class="px-3 py-2 font-normal">{t.table.label}</th>
				<th class="px-3 py-2 font-normal">{t.table.inverseLabel}</th>
				<th class="px-3 py-2 font-normal">{t.table.cardinality}</th>
				<th class="px-3 py-2 font-normal">{t.table.allowedFrom}</th>
				<th class="px-3 py-2 font-normal">{t.table.allowedTo}</th>
				<th class="px-3 py-2 text-right font-normal">{t.table.usage}</th>
				{#if !shipped}
					<th class="px-3 py-2 font-normal">{t.table.actions}</th>
				{/if}
			</tr>
		</thead>
		<tbody class="divide-y divide-line">
			{#each types as row (row.id)}
				<tr class="bg-panel">
					<td class="px-3 py-2 text-ink">
						{relationTypeDisplayLabel(row, relationTypeLabel, locale)}
						{#if shipped}
							<Badge variant="secondary" class="ml-2 text-muted uppercase">
								{t.shippedBadge}
							</Badge>
						{/if}
					</td>
					<td class="px-3 py-2 text-ink-2">
						{relationTypeDisplayInverseLabel(row, relationTypeLabel, locale)}
					</td>
					<td class="px-3 py-2 text-ink-2">{t.cardinalityLabel(row.cardinality)}</td>
					<td class="px-3 py-2 text-ink-2">
						{row.allowedFrom.map((type) => t.entityTypeLabel(type)).join(', ')}
					</td>
					<td class="px-3 py-2 text-ink-2">
						{row.allowedTo.map((type) => t.entityTypeLabel(type)).join(', ')}
					</td>
					<td class="px-3 py-2 text-right text-ink tabular-nums">{row.usageCount}</td>
					{#if !shipped}
						<td class="px-3 py-2">
							{#if canManage}
								<div class="flex gap-3">
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-xs"
										onclick={() => onRename?.(row)}
									>
										{t.rename.trigger}
									</Button>
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-xs"
										onclick={() => onWiden?.(row)}
									>
										{t.widen.trigger}
									</Button>
									<Button
										type="button"
										variant="link"
										size="sm"
										class="h-auto p-0 text-xs"
										onclick={() => onTranslate?.(row)}
									>
										{t.translate.trigger}
									</Button>
								</div>
							{/if}
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
