<script lang="ts">
	/**
	 * C3 = A: flat checklist, ranked, each row a candidate with its reason and its own cost.
	 * Dropping a row is immediate (`?/drop`) - decision C3: "the GM can drop entries from
	 * the plan before any diff is generated," free, no premium-model spend yet. "Generate
	 * diffs" is the one explicit, priced action that moves the plan into #51's queue.
	 */
	import { enhance } from '$app/forms';
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import ModelRunning from '$lib/components/copilot/ModelRunning.svelte';

	interface ChecklistRow {
		id: string;
		name: string;
		rationale: string;
		credits: number;
	}

	let {
		rows,
		estimatedCredits,
		candidateCap,
		locale
	}: {
		rows: ChecklistRow[];
		estimatedCredits: number;
		candidateCap: number | null;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale).proposals.checklist);
	let creditsLabel = $derived(t.estimatedCredits(estimatedCredits));

	let kept = $state(rows.map((r) => ({ ...r })));
	let generating = $state(false);

	function dropRow(id: string): void {
		kept = kept.filter((r) => r.id !== id);
	}
</script>

<div class="rounded-lg border border-line bg-panel p-4">
	<div class="mb-3 flex items-center justify-between text-xs text-muted">
		<span><b class="text-ink">{kept.length}</b>{t.keptSuffix(rows.length, candidateCap)}</span>
		<span
			>{creditsLabel.prefix}<b class="text-ink">{estimatedCredits.toFixed(2)}</b
			>{creditsLabel.suffix}</span
		>
	</div>

	<ul class="divide-y divide-line">
		{#each kept as row (row.id)}
			<li class="flex items-center justify-between gap-3 py-2 text-sm">
				<div class="min-w-0">
					<p class="truncate font-medium text-ink">{row.name}</p>
					<p class="truncate text-xs text-muted">{row.rationale}</p>
				</div>
				<div class="flex flex-none items-center gap-2">
					<span class="font-mono text-xs text-muted">{row.credits.toFixed(2)} {t.creditsUnit}</span>
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
							variant="link"
							size="sm"
							class="h-auto p-0 text-muted hover:text-danger"
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
