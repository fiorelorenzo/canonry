<script lang="ts">
	/**
	 * C3 = A: flat checklist, ranked, each row a candidate with its reason and its own cost.
	 * Dropping a row is immediate (`?/drop`) - decision C3: "the GM can drop entries from
	 * the plan before any diff is generated," free, no premium-model spend yet. "Generate
	 * diffs" is the one explicit, priced action that moves the plan into #51's queue.
	 */
	import { enhance } from '$app/forms';

	interface ChecklistRow {
		id: string;
		name: string;
		rationale: string;
		credits: number;
	}

	let {
		rows,
		estimatedCredits,
		candidateCap
	}: {
		rows: ChecklistRow[];
		estimatedCredits: number;
		candidateCap: number;
	} = $props();

	let kept = $state(rows.map((r) => ({ ...r })));
	let generating = $state(false);

	function dropRow(id: string): void {
		kept = kept.filter((r) => r.id !== id);
	}
</script>

<div class="rounded-lg border border-line bg-panel p-4">
	<div class="mb-3 flex items-center justify-between text-xs text-muted">
		<span
			><b class="text-ink">{kept.length}</b> of {rows.length} kept &middot; cap {candidateCap}</span
		>
		<span>Est. <b class="text-ink">{estimatedCredits.toFixed(2)}</b> credits to generate diffs</span
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
					<span class="font-mono text-xs text-muted">{row.credits.toFixed(2)} cr</span>
					<form
						method="POST"
						action="?/drop"
						use:enhance={() => {
							dropRow(row.id);
							return async () => {};
						}}
					>
						<input type="hidden" name="proposalId" value={row.id} />
						<button type="submit" class="text-xs text-muted underline hover:text-danger">
							Drop
						</button>
					</form>
				</div>
			</li>
		{/each}
	</ul>

	{#if kept.length === 0}
		<p class="py-3 text-sm text-muted">Nothing left in this plan.</p>
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
			<button
				type="submit"
				disabled={generating}
				class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:brightness-110 disabled:opacity-50"
			>
				{generating ? 'Generating\u2026' : `Generate diffs (${kept.length})`}
			</button>
		</form>
	{/if}
</div>
