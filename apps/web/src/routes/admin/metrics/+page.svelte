<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatPercent(rate: number | null): string {
		if (rate === null) return '-';
		return `${Math.round(rate * 100)}%`;
	}

	/** Illustrative only - SPEC.md §14 sets no numeric bar for "healthy", so this just
	 * gives the table a quick visual read, the same way the F5 artifact's own mock did. */
	function rateColorClass(rate: number | null): string {
		if (rate === null) return 'text-muted';
		if (rate >= 0.75) return 'text-ok';
		if (rate >= 0.5) return 'text-warn';
		return 'text-danger';
	}

	function formatDuration(seconds: number): string {
		const total = Math.round(seconds);
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const secs = total % 60;
		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${secs}s`;
		return `${secs}s`;
	}

	const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

	const hasAnyProposals = $derived(data.overallAcceptRate.produced > 0);
	const hasAnyImports = $derived(data.importsByUniverse.some((u) => u.imports.length > 0));
	const hasAnyUniverses = $derived(data.entropyByUniverse.length > 0);
</script>

<svelte:head>
	<title>Metrics, Canonry admin</title>
</svelte:head>

<main id="main" class="mx-auto max-w-4xl px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">&larr; Universes</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">Metrics</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		SPEC.md §14 and decision F5: the two numbers that decide whether the copilot works, plus the
		three that say whether the rest of the product does. Staff only, and deliberately not shown to
		the GM - a GM optimising their own accept rate is a strange incentive on both sides of the
		relationship.
	</p>

	<section class="mt-10">
		<h2 class="text-lg font-semibold text-ink">Accept rate</h2>
		<p class="mt-1 max-w-measure text-sm text-ink-2">
			Issue #100. <code class="text-xs">proposal.outcome</code>, `superseded` and `pending` excluded
			from the denominator - computed by <code class="text-xs">@canonry/eval</code>'s
			<code class="text-xs">acceptRate</code>, the same function the propagation corpus scores
			prompt and model changes against. Window: last {data.acceptRateWindowDays} days.
		</p>

		{#if !hasAnyProposals}
			<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
				No proposals have been produced yet. A 0% accept rate here would be a lie by omission, not
				an honest reading, so this panel shows nothing until there is something to show.
			</p>
		{:else}
			<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-lg border border-line bg-panel p-4">
					<div class="text-2xl font-semibold {rateColorClass(data.overallAcceptRate.acceptRate)}">
						{formatPercent(data.overallAcceptRate.acceptRate)}
					</div>
					<div class="mt-1 text-xs text-muted">Accept rate (decided proposals)</div>
				</div>
				<div class="rounded-lg border border-line bg-panel p-4">
					<div class="text-2xl font-semibold text-ink">{data.overallAcceptRate.produced}</div>
					<div class="mt-1 text-xs text-muted">Produced</div>
				</div>
				<div class="rounded-lg border border-line bg-panel p-4">
					<div class="text-2xl font-semibold text-ink">{data.overallAcceptRate.accepted}</div>
					<div class="mt-1 text-xs text-muted">Accepted</div>
				</div>
				<div class="rounded-lg border border-line bg-panel p-4">
					<div class="text-2xl font-semibold text-ink">{data.overallAcceptRate.rejected}</div>
					<div class="mt-1 text-xs text-muted">Rejected</div>
				</div>
			</div>

			{#if data.weeklyAcceptRate.length > 0}
				<div class="mt-5 overflow-x-auto rounded-lg border border-line">
					<table class="w-full border-collapse text-sm">
						<thead>
							<tr
								class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
							>
								<th class="px-3 py-2 font-normal">Week of</th>
								<th class="px-3 py-2 font-normal">Kind</th>
								<th class="px-3 py-2 font-normal">Model</th>
								<th class="px-3 py-2 font-normal">Produced</th>
								<th class="px-3 py-2 font-normal">Accepted</th>
								<th class="px-3 py-2 font-normal">Rejected</th>
								<th class="px-3 py-2 font-normal">Rate</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-line">
							{#each data.weeklyAcceptRate as row (row.weekStart + row.kind + row.modelId)}
								<tr class="bg-panel">
									<td class="px-3 py-2 text-ink-2 tabular-nums">{row.weekStart}</td>
									<td class="px-3 py-2 text-ink">{row.kind}</td>
									<td class="px-3 py-2"
										><code class="text-xs text-ink-2">{row.modelId ?? 'unattributed'}</code></td
									>
									<td class="px-3 py-2 text-ink tabular-nums">{row.produced}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{row.accepted}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{row.rejected}</td>
									<td class="px-3 py-2 font-semibold tabular-nums {rateColorClass(row.acceptRate)}">
										{formatPercent(row.acceptRate)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</section>

	<section class="mt-10">
		<h2 class="text-lg font-semibold text-ink">Time to first accepted proposal</h2>
		<p class="mt-1 max-w-measure text-sm text-ink-2">
			Issue #101. From an import's start to its first accepted proposal, per universe, as a
			distribution: one slow outlier is the churn event AGENTS.md worries about, and an average
			would hide exactly that outlier.
		</p>

		{#if !hasAnyImports}
			<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
				No imports have run yet.
			</p>
		{:else}
			{#each data.importsByUniverse as universe (universe.universeId)}
				<div class="mt-5">
					<h3 class="text-sm font-semibold text-ink">{universe.universeName}</h3>
					<p class="mt-1 text-xs text-muted">
						{#if universe.importsWithAccept === 0}
							{universe.imports.length} import(s), none with an accepted proposal yet.
						{:else}
							{universe.importsWithAccept} of {universe.imports.length} import(s) have a first accept,
							median {formatDuration(universe.medianSeconds ?? 0)}.
						{/if}
					</p>
					<div class="mt-2 overflow-x-auto rounded-lg border border-line">
						<table class="w-full border-collapse text-sm">
							<thead>
								<tr
									class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
								>
									<th class="px-3 py-2 font-normal">Import started</th>
									<th class="px-3 py-2 font-normal">Time to first accept</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-line">
								{#each universe.imports as importRow (importRow.importJobId)}
									<tr class="bg-panel">
										<td class="px-3 py-2 text-ink-2 tabular-nums"
											>{dateFormat.format(importRow.importCreatedAt)}</td
										>
										<td class="px-3 py-2 text-ink tabular-nums">
											{#if importRow.secondsToFirstAccept === null}
												<span class="text-muted">still waiting</span>
											{:else}
												{formatDuration(importRow.secondsToFirstAccept)}
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		{/if}
	</section>

	<section class="mt-10">
		<h2 class="text-lg font-semibold text-ink">Warm radius</h2>
		<p class="mt-1 max-w-measure text-sm text-ink-2">
			Issue #102. Warm hit rate - consumed artifacts over generated ones - governs the warm radius
			automatically: below {data.warmRadiusThresholdPercent}% it shrinks from ring 2 to ring 1. This
			is the same read <code class="text-xs">warmOnConsumption</code> uses to decide how far to reach,
			not a separate estimate.
		</p>

		{#if !hasAnyUniverses}
			<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
				No universes yet.
			</p>
		{:else}
			<div class="mt-4 overflow-x-auto rounded-lg border border-line">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr
							class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
						>
							<th class="px-3 py-2 font-normal">Universe</th>
							<th class="px-3 py-2 font-normal">Consumed</th>
							<th class="px-3 py-2 font-normal">Generated</th>
							<th class="px-3 py-2 font-normal">Hit rate</th>
							<th class="px-3 py-2 font-normal">Current radius</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-line">
						{#each data.warmRadiusByUniverse as row (row.universeId)}
							<tr class="bg-panel">
								<td class="px-3 py-2 text-ink">{row.universeName}</td>
								<td class="px-3 py-2 text-ink tabular-nums">{row.consumed}</td>
								<td class="px-3 py-2 text-ink tabular-nums">{row.generated}</td>
								<td class="px-3 py-2 text-ink tabular-nums">
									{#if row.hitRate === null}
										<span class="text-muted">no data yet</span>
									{:else}
										{formatPercent(row.hitRate)}
									{/if}
								</td>
								<td class="px-3 py-2 text-ink tabular-nums">
									<span
										class="rounded-full px-2 py-0.5 text-xs font-medium"
										class:bg-ok-bg={row.radius === 2}
										class:text-ok={row.radius === 2}
										class:bg-warn-bg={row.radius === 1}
										class:text-warn={row.radius === 1}
									>
										ring {row.radius}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="mt-10 mb-4">
		<h2 class="text-lg font-semibold text-ink">Canon entropy</h2>
		<p class="mt-1 max-w-measure text-sm text-ink-2">
			Issue #103. Entries updated after a session versus created in prep, per universe - the metric
			that says whether canon entropy was actually solved or whether this is just another place to
			write things down.
		</p>

		{#if !hasAnyUniverses}
			<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
				No universes yet.
			</p>
		{:else}
			<div class="mt-4 overflow-x-auto rounded-lg border border-line">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr
							class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
						>
							<th class="px-3 py-2 font-normal">Universe</th>
							<th class="px-3 py-2 font-normal">Created in prep</th>
							<th class="px-3 py-2 font-normal">Updated after a session</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-line">
						{#each data.entropyByUniverse as row (row.universeId)}
							<tr class="bg-panel">
								<td class="px-3 py-2 text-ink">{row.universeName}</td>
								<td class="px-3 py-2 text-ink tabular-nums">{row.entriesCreatedInPrep}</td>
								<td class="px-3 py-2 text-ink tabular-nums">{row.entriesUpdatedAfterSession}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>
