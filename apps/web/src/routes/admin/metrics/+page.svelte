<script lang="ts">
	import { dateFormat, LOCALE_NAMES, messages, numberFormat } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).admin);

	const percentFormat = $derived(
		numberFormat(data.locale, { style: 'percent', maximumFractionDigits: 0 })
	);

	function formatPercent(rate: number | null): string {
		if (rate === null) return '-';
		return percentFormat.format(rate);
	}

	/** Illustrative only - SPEC.md §14 sets no numeric bar for "healthy", so this just
	 * gives the table a quick visual read, the same way the F5 artifact's own mock did. */
	function rateColorClass(rate: number | null): string {
		if (rate === null) return 'text-muted';
		if (rate >= 0.75) return 'text-ok';
		if (rate >= 0.5) return 'text-warn';
		return 'text-danger';
	}

	// 'h'/'m'/'s' are unit symbols, not natural-language words (like a stopwatch display) -
	// kept as-is in both locales rather than routed through the catalogue.
	function formatDuration(seconds: number): string {
		const total = Math.round(seconds);
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const secs = total % 60;
		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${secs}s`;
		return `${secs}s`;
	}

	const importDateFormat = $derived(
		dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' })
	);

	const hasAnyProposals = $derived(data.overallAcceptRate.produced > 0);
	const hasAnyImports = $derived(data.importsByUniverse.some((u) => u.imports.length > 0));
	const hasAnyUniverses = $derived(data.entropyByUniverse.length > 0);
</script>

<svelte:head>
	<title>{t.metrics.browserTitle}</title>
</svelte:head>

<Page width="wide" title={t.metrics.heading}>
	<div class="px-8 py-10">
		<p class="mt-6 max-w-measure text-body text-ink-2">
			{t.metrics.intro}
		</p>

		<section class="mt-10">
			<h2 class="text-title font-semibold text-ink">{t.metrics.accept.heading}</h2>
			<p class="mt-1 max-w-measure text-body text-ink-2">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
				{@html t.metrics.accept.intro(data.acceptRateWindowDays)}
			</p>

			{#if !hasAnyProposals}
				<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-body text-muted">
					{t.metrics.accept.noProposalsYet}
				</p>
			{:else}
				<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="rounded-lg border border-line bg-panel p-4">
						<div class="text-2xl font-semibold {rateColorClass(data.overallAcceptRate.acceptRate)}">
							{formatPercent(data.overallAcceptRate.acceptRate)}
						</div>
						<div class="mt-1 text-label text-muted">{t.metrics.accept.acceptRateLabel}</div>
					</div>
					<div class="rounded-lg border border-line bg-panel p-4">
						<div class="text-2xl font-semibold text-ink">{data.overallAcceptRate.produced}</div>
						<div class="mt-1 text-label text-muted">{t.metrics.table.produced}</div>
					</div>
					<div class="rounded-lg border border-line bg-panel p-4">
						<div class="text-2xl font-semibold text-ink">{data.overallAcceptRate.accepted}</div>
						<div class="mt-1 text-label text-muted">{t.metrics.table.accepted}</div>
					</div>
					<div class="rounded-lg border border-line bg-panel p-4">
						<div class="text-2xl font-semibold text-ink">{data.overallAcceptRate.rejected}</div>
						<div class="mt-1 text-label text-muted">{t.metrics.table.rejected}</div>
					</div>
				</div>

				{#if data.weeklyAcceptRate.length > 0}
					<div class="mt-5 overflow-x-auto rounded-lg border border-line">
						<table class="w-full border-collapse text-body">
							<thead>
								<tr
									class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
								>
									<th class="px-3 py-2 font-normal">{t.metrics.accept.table.weekOf}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.accept.table.kind}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.accept.table.model}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.produced}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.accepted}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.rejected}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.rate}</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-line">
								{#each data.weeklyAcceptRate as row (row.weekStart + row.kind + row.modelId)}
									<tr class="bg-panel">
										<td class="px-3 py-2 text-ink-2 tabular-nums">{row.weekStart}</td>
										<td class="px-3 py-2 text-ink">{row.kind}</td>
										<td class="px-3 py-2"
											><code class="text-label text-ink-2">{row.modelId ?? t.unattributed}</code></td
										>
										<td class="px-3 py-2 text-ink tabular-nums">{row.produced}</td>
										<td class="px-3 py-2 text-ink tabular-nums">{row.accepted}</td>
										<td class="px-3 py-2 text-ink tabular-nums">{row.rejected}</td>
										<td
											class="px-3 py-2 font-semibold tabular-nums {rateColorClass(row.acceptRate)}"
										>
											{formatPercent(row.acceptRate)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				<div class="mt-5">
					<h3 class="text-body font-semibold text-ink">{t.metrics.accept.byLocale.heading}</h3>
					<p class="mt-1 text-label text-muted">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
						{@html t.metrics.accept.byLocale.intro}
					</p>
					<div class="mt-2 overflow-x-auto rounded-lg border border-line">
						<table class="w-full border-collapse text-body">
							<thead>
								<tr
									class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
								>
									<th class="px-3 py-2 font-normal">{t.metrics.accept.byLocale.localeLabel}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.produced}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.accepted}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.rejected}</th>
									<th class="px-3 py-2 font-normal">{t.metrics.table.rate}</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-line">
								{#each data.acceptRateByLocale as row (row.locale)}
									<tr class="bg-panel">
										<td class="px-3 py-2 text-ink">{LOCALE_NAMES[row.locale]}</td>
										<td class="px-3 py-2 text-ink tabular-nums">{row.produced}</td>
										<td class="px-3 py-2 text-ink tabular-nums">{row.accepted}</td>
										<td class="px-3 py-2 text-ink tabular-nums">{row.rejected}</td>
										<td
											class="px-3 py-2 font-semibold tabular-nums {row.produced === 0
												? 'text-muted'
												: rateColorClass(row.acceptRate)}"
										>
											{#if row.produced === 0}
												<span class="text-label font-normal text-muted"
													>{t.metrics.table.noDataYet}</span
												>
											{:else}
												{formatPercent(row.acceptRate)}
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</section>

		<section class="mt-10">
			<h2 class="text-title font-semibold text-ink">{t.metrics.timeToFirstAccept.heading}</h2>
			<p class="mt-1 max-w-measure text-body text-ink-2">
				{t.metrics.timeToFirstAccept.intro}
			</p>

			{#if !hasAnyImports}
				<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-body text-muted">
					{t.metrics.timeToFirstAccept.noImportsYet}
				</p>
			{:else}
				{#each data.importsByUniverse as universe (universe.universeId)}
					<div class="mt-5">
						<h3 class="text-body font-semibold text-ink">{universe.universeName}</h3>
						<p class="mt-1 text-meta text-muted">
							{#if universe.importsWithAccept === 0}
								{t.metrics.timeToFirstAccept.noAcceptYet(universe.imports.length)}
							{:else}
								{t.metrics.timeToFirstAccept.summary(
									universe.importsWithAccept,
									universe.imports.length,
									formatDuration(universe.medianSeconds ?? 0)
								)}
							{/if}
						</p>
						<div class="mt-2 overflow-x-auto rounded-lg border border-line">
							<table class="w-full border-collapse text-body">
								<thead>
									<tr
										class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
									>
										<th class="px-3 py-2 font-normal"
											>{t.metrics.timeToFirstAccept.importStarted}</th
										>
										<th class="px-3 py-2 font-normal"
											>{t.metrics.timeToFirstAccept.timeToFirstAcceptLabel}</th
										>
									</tr>
								</thead>
								<tbody class="divide-y divide-line">
									{#each universe.imports as importRow (importRow.importJobId)}
										<tr class="bg-panel">
											<td class="px-3 py-2 text-ink-2 tabular-nums"
												>{importDateFormat.format(importRow.importCreatedAt)}</td
											>
											<td class="px-3 py-2 text-ink tabular-nums">
												{#if importRow.secondsToFirstAccept === null}
													<span class="text-muted">{t.metrics.timeToFirstAccept.stillWaiting}</span>
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
			<h2 class="text-title font-semibold text-ink">{t.metrics.warmRadius.heading}</h2>
			<p class="mt-1 max-w-measure text-body text-ink-2">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
				{@html t.metrics.warmRadius.intro(data.warmRadiusThresholdPercent)}
			</p>

			{#if !hasAnyUniverses}
				<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-body text-muted">
					{t.metrics.noUniversesYet}
				</p>
			{:else}
				<div class="mt-4 overflow-x-auto rounded-lg border border-line">
					<table class="w-full border-collapse text-body">
						<thead>
							<tr
								class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
							>
								<th class="px-3 py-2 font-normal">{t.metrics.table.universe}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.warmRadius.consumed}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.warmRadius.generated}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.warmRadius.hitRate}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.warmRadius.currentRadius}</th>
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
											<span class="text-muted">{t.metrics.table.noDataYet}</span>
										{:else}
											{formatPercent(row.hitRate)}
										{/if}
									</td>
									<td class="px-3 py-2 text-ink tabular-nums">
										<span
											class="rounded-full px-2 py-0.5 text-label font-medium"
											class:bg-ok-bg={row.radius === 2}
											class:text-ok={row.radius === 2}
											class:bg-warn-bg={row.radius === 1}
											class:text-warn={row.radius === 1}
										>
											{t.metrics.warmRadius.ring(row.radius)}
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="mt-10">
			<h2 class="text-title font-semibold text-ink">{t.metrics.entropy.heading}</h2>
			<p class="mt-1 max-w-measure text-body text-ink-2">
				{t.metrics.entropy.intro}
			</p>

			{#if !hasAnyUniverses}
				<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-body text-muted">
					{t.metrics.noUniversesYet}
				</p>
			{:else}
				<div class="mt-4 overflow-x-auto rounded-lg border border-line">
					<table class="w-full border-collapse text-body">
						<thead>
							<tr
								class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
							>
								<th class="px-3 py-2 font-normal">{t.metrics.table.universe}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.entropy.createdInPrep}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.entropy.updatedAfterSession}</th>
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

		<section class="mt-10 mb-4">
			<h2 class="text-title font-semibold text-ink">{t.metrics.auditFlags.heading}</h2>
			<p class="mt-1 max-w-measure text-body text-ink-2">
				{t.metrics.auditFlags.intro(data.auditPairCap)}
			</p>

			{#if data.auditFlagPositions.length === 0}
				<p class="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-body text-muted">
					{t.metrics.auditFlags.noFlagsYet}
				</p>
			{:else}
				<div class="mt-4 overflow-x-auto rounded-lg border border-line">
					<table class="w-full border-collapse text-body">
						<thead>
							<tr
								class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
							>
								<th class="px-3 py-2 font-normal">{t.metrics.auditFlags.position}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.auditFlags.produced}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.auditFlags.dismissed}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.auditFlags.stillOpen}</th>
								<th class="px-3 py-2 font-normal">{t.metrics.auditFlags.dismissalRate}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-line">
							{#each data.auditFlagPositions as row (row.position)}
								<tr class="bg-panel">
									<td class="px-3 py-2 text-ink tabular-nums">{row.position}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{row.produced}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{row.dismissed}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{row.stillOpen}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{formatPercent(row.dismissalRate)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</div>
</Page>
