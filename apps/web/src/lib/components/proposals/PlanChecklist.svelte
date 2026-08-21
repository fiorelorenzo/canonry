<script lang="ts">
	/**
	 * C3 = A: flat checklist, ranked, each row a candidate with its reason and its own cost.
	 * Dropping a row is immediate (`?/drop`) - decision C3: "the GM can drop entries from
	 * the plan before any diff is generated," free, no premium-model spend yet. "Generate
	 * diffs" is the one explicit, priced action that moves the plan into #51's queue.
	 */
	import { enhance } from '$app/forms';
	import { messages, numberFormat, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import ModelRunning from '$lib/components/copilot/ModelRunning.svelte';

	interface ChecklistRow {
		id: string;
		name: string;
		rationale: string;
		/** issue #489: propagation's uniform, not-yet-spent `propagate.diff` price for every
		 * row while `pricing.kind === 'perDiff'`, or the candidate's own already-spent cost
		 * otherwise - see `+page.server.ts`'s own comment on the same field. */
		credits: number;
	}

	let {
		rows,
		pricing,
		candidateCap,
		locale
	}: {
		rows: ChecklistRow[];
		/** issue #489: `propagate.diff` prices per candidate (docs/ux/DECISIONS.md G11), so a
		 * plan that still has a real "generate diffs" step ahead of it shows the reconciling
		 * count x price = total, plus the plan-level ranking charge as its own separate
		 * already-spent figure - never one number that quietly bundles both. Every other
		 * trigger this checklist still renders for (an audit plan, whose flags are fully
		 * priced the moment they are written) keeps the single combined total this component
		 * always showed. */
		pricing:
			| { kind: 'perDiff'; diffPriceCredits: number; alreadySpentCredits: number }
			| { kind: 'total'; estimatedCredits: number };
		candidateCap: number | null;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale).proposals.checklist);
	// issue #489: 4 decimal places is the column's own scale (numeric(12,4)), not what a
	// credit is ever priced to - `maximumFractionDigits: 4` shows exactly as much precision
	// as a price actually has and no more, so a 1.0000 catalogue row reads "1", not "1.00".
	let creditsFormat = $derived(numberFormat(locale, { maximumFractionDigits: 4 }));
	function fmt(value: number): string {
		return creditsFormat.format(value);
	}

	let kept = $state(rows.map((r) => ({ ...r })));
	let generating = $state(false);

	// The bold total next to "to generate" - kept.length x each row's own (uniform) price,
	// recomputed as rows drop rather than frozen at the page's first render, so the number a
	// GM confirms against never lags what the button beside it is actually about to spend.
	let toGenerateCredits = $derived(kept.reduce((sum, row) => sum + row.credits, 0));

	function dropRow(id: string): void {
		kept = kept.filter((r) => r.id !== id);
	}
</script>

<div class="rounded-lg border border-line bg-panel p-4">
	<div class="mb-1 flex items-center justify-between text-xs text-muted">
		<span><b class="text-ink">{kept.length}</b>{t.keptSuffix(rows.length, candidateCap)}</span>
		{#if pricing.kind === 'perDiff'}
			{@const toGenerate = t.toGenerate(kept.length, fmt(pricing.diffPriceCredits))}
			<span
				>{toGenerate.prefix}<b class="text-ink">{fmt(toGenerateCredits)}</b
				>{toGenerate.suffix}</span
			>
		{:else}
			{@const estimate = t.estimatedCredits(pricing.estimatedCredits)}
			<span
				>{estimate.prefix}<b class="text-ink">{fmt(pricing.estimatedCredits)}</b
				>{estimate.suffix}</span
			>
		{/if}
	</div>
	{#if pricing.kind === 'perDiff'}
		{@const alreadySpent = t.alreadySpent()}
		<div class="mb-3 text-xs text-muted">
			{alreadySpent.prefix}<b class="text-ink">{fmt(pricing.alreadySpentCredits)}</b
			>{alreadySpent.suffix}
		</div>
	{/if}

	<ul class="divide-y divide-line">
		{#each kept as row (row.id)}
			<li class="flex items-center justify-between gap-3 py-2 text-sm">
				<div class="min-w-0">
					<p class="truncate font-medium text-ink">{row.name}</p>
					<p class="truncate text-xs text-muted">{row.rationale}</p>
				</div>
				<div class="flex flex-none items-center gap-2">
					<span class="font-mono text-xs text-muted">{fmt(row.credits)} {t.creditsUnit}</span>
					<form
						method="POST"
						action="?/drop"
						use:enhance={() => {
							dropRow(row.id);
							return async () => {};
						}}
					>
						<input type="hidden" name="proposalId" value={row.id} />
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							class="h-7 px-2 text-xs font-normal text-muted hover:text-foreground"
						>
							{t.drop}
						</Button>
					</form>
				</div>
			</li>
		{/each}
	</ul>

	{#if kept.length === 0}
		<EmptyState kind="settled" message={t.empty} />
	{:else}
		<form
			method="POST"
			action="?/generateDiffs"
			use:enhance={() => {
				generating = true;
				return async ({ update }) => {
					await update();
					generating = false;
				};
			}}
			class="mt-3"
		>
			<Button type="submit" disabled={generating}>{t.generateDiffs(kept.length)}</Button>
			{#if generating}
				<!-- #345: the premium model writes one diff per kept row inside this request, so
				     this is the longest wait in the product. The button used to relabel itself
				     and nothing else. -->
				<div class="mt-2">
					<ModelRunning label={t.generating} {locale} />
				</div>
			{/if}
		</form>
	{/if}
</div>
