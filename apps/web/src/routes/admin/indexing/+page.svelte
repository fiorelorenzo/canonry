<script lang="ts">
	/**
	 * #768. Three bands, in the order the question is actually asked: what the mechanism is
	 * doing right now, how often it has had to give up, and then the per-universe history with
	 * the individual catch-ups behind it.
	 *
	 * The middle band is the signature of the page and the reason it exists. "Two universes are
	 * failed right now" is worth much less than "four gave up in the last week and three came
	 * back on their own", because the decision this surface feeds is whether the GM-facing half
	 * of #768 is worth building, and that is a question about frequency.
	 *
	 * No action anywhere: recovery is the sweep's job since #765, and a control here would be a
	 * second trigger for it. The empty state is I8's `cold` for the same reason - there is
	 * nothing an operator can do to make a catch-up happen, so nothing invites them to try.
	 */
	import { dateFormat, messages } from '$lib/i18n';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Page } from '$lib/components/ui/page';
	import { TableScroll } from '$lib/components/ui/table';
	import type { UniverseIndexBackfillStatus } from '@canonry/db/schema';
	import type { BackfillAttemptView } from './+page.server';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).admin);
	const stamp = $derived(dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }));

	/** Gave up is the one state worth colouring, and `destructive` is the palette's own pale
	 * surface plus saturated text rather than a shout. `done` gets `ok` because a catch-up that
	 * finished is the good outcome; queued and running are furniture. */
	const STATUS_VARIANT: Record<UniverseIndexBackfillStatus, BadgeVariant> = {
		pending: 'secondary',
		claimed: 'accent',
		done: 'ok',
		failed: 'destructive'
	};

	function reasonLabel(attempt: BackfillAttemptView): string {
		return attempt.reasonKey === null ? attempt.reason : t.indexing.reasonLabel[attempt.reasonKey];
	}
</script>

<svelte:head>
	<title>{t.indexing.browserTitle}</title>
</svelte:head>

<Page width="wide" title={t.indexing.title}>
	<div class="px-8 py-10">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
		<p class="mt-6 max-w-measure text-body text-ink-2">{@html t.indexing.intro1}</p>
		<p class="mt-2 max-w-measure text-body text-ink-2">{t.indexing.intro2}</p>

		{#if data.attemptsTotal === 0}
			<div class="mt-8">
				<EmptyState kind="cold" message={t.indexing.noneYet} />
			</div>
		{:else}
			<section class="mt-10">
				<h2 class="text-title font-semibold text-ink">{t.indexing.now.heading}</h2>
				<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="rounded-lg border border-line bg-panel p-4">
						<div
							class="text-2xl font-semibold tabular-nums {data.now.universesGivenUp > 0
								? 'text-danger'
								: 'text-ink'}"
						>
							{data.now.universesGivenUp}
						</div>
						<div class="mt-1 text-label text-muted">{t.indexing.now.universesGivenUp}</div>
					</div>
					<div class="rounded-lg border border-line bg-panel p-4">
						<div class="text-2xl font-semibold text-ink tabular-nums">
							{data.now.entriesMissingNow}
						</div>
						<div class="mt-1 text-label text-muted">{t.indexing.now.entriesMissing}</div>
					</div>
					<div class="rounded-lg border border-line bg-panel p-4">
						<div class="text-2xl font-semibold text-ink tabular-nums">{data.now.inFlight}</div>
						<div class="mt-1 text-label text-muted">{t.indexing.now.inFlight}</div>
					</div>
					<div class="rounded-lg border border-line bg-panel p-4">
						<div class="text-2xl font-semibold text-ink tabular-nums">
							{data.now.universesEverBackfilled}
						</div>
						<div class="mt-1 text-label text-muted">{t.indexing.now.universesEver}</div>
					</div>
				</div>
				<p class="mt-2 max-w-measure text-meta text-muted">{t.indexing.now.entriesMissingNote}</p>
			</section>

			<section class="mt-10">
				<h2 class="text-title font-semibold text-ink">{t.indexing.frequency.heading}</h2>
				<p class="mt-1 max-w-measure text-body text-ink-2">{t.indexing.frequency.intro}</p>
				<TableScroll class="mt-4" label={t.indexing.frequency.heading}>
					<table class="w-full border-collapse text-body">
						<thead>
							<tr
								class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
							>
								<th class="px-3 py-2 font-normal">{t.indexing.frequency.window}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.frequency.deadLetters}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.frequency.universesAffected}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.frequency.retries}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.frequency.recoveries}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-line">
							{#each data.windows as period (period.windowDays ?? 'all')}
								<tr class="bg-panel">
									<td class="px-3 py-2 text-ink">
										{period.windowDays === null
											? t.indexing.frequency.allTime
											: t.indexing.frequency.windowLabel(period.windowDays)}
									</td>
									<td
										class="px-3 py-2 font-semibold tabular-nums {period.deadLetters > 0
											? 'text-danger'
											: 'text-ink'}">{period.deadLetters}</td
									>
									<td class="px-3 py-2 text-ink tabular-nums">{period.universesDeadLettered}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{period.retriesEnqueued}</td>
									<td
										class="px-3 py-2 font-semibold tabular-nums {period.recoveries > 0
											? 'text-ok'
											: 'text-ink'}">{period.recoveries}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</TableScroll>
			</section>

			<section class="mt-10">
				<h2 class="text-title font-semibold text-ink">{t.indexing.byUniverse.heading}</h2>
				<p class="mt-1 max-w-measure text-body text-ink-2">{t.indexing.byUniverse.intro}</p>
				<TableScroll class="mt-4" label={t.indexing.byUniverse.heading}>
					<table class="w-full border-collapse text-body">
						<thead>
							<tr
								class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
							>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.universe}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.state}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.attempts.reason}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.lastActivity}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.shortfall}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.passes}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.deadLetters}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.inEpisode}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.recoveries}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-line">
							{#each data.universes as row (row.universeId)}
								<tr class="bg-panel">
									<td class="px-3 py-2 text-ink">{row.universeName}</td>
									<td class="px-3 py-2">
										<Badge variant={STATUS_VARIANT[row.latest.status]}>
											{t.indexing.statusLabel[row.latest.status]}
										</Badge>
									</td>
									<td class="px-3 py-2 text-ink-2">{reasonLabel(row.latest)}</td>
									<td class="px-3 py-2 text-ink-2 tabular-nums">
										{stamp.format(row.latest.finishedAt ?? row.latest.requestedAt)}
									</td>
									<td class="px-3 py-2 text-ink tabular-nums">
										{#if row.latest.entitiesMissing === null || row.latest.entitiesTotal === null}
											<span class="text-muted">{t.indexing.unknownValue}</span>
										{:else}
											{t.indexing.shortfallValue(
												row.latest.entitiesMissing,
												row.latest.entitiesTotal
											)}
										{/if}
									</td>
									<td class="px-3 py-2 text-ink tabular-nums">{row.latest.attemptCount}</td>
									<td class="px-3 py-2 text-ink tabular-nums">{row.deadLetters}</td>
									<td
										class="px-3 py-2 font-semibold tabular-nums {row.deadLettersInEpisode > 0
											? 'text-danger'
											: 'text-ink'}">{row.deadLettersInEpisode}</td
									>
									<td class="px-3 py-2 text-ink tabular-nums">{row.recoveries}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</TableScroll>
			</section>

			<section class="mt-10">
				<h2 class="text-title font-semibold text-ink">{t.indexing.attempts.heading}</h2>
				<p class="mt-1 max-w-measure text-body text-ink-2">
					{t.indexing.attempts.intro(data.attempts.length, data.attemptsTotal)}
				</p>
				<TableScroll class="mt-4" label={t.indexing.attempts.heading}>
					<table class="w-full border-collapse text-body">
						<thead>
							<tr
								class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
							>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.universe}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.attempts.reason}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.state}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.attempts.requested}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.attempts.finished}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.byUniverse.passes}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.attempts.entries}</th>
								<th class="px-3 py-2 font-normal">{t.indexing.attempts.lastError}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-line">
							{#each data.attempts as attempt (attempt.id)}
								<tr class="bg-panel">
									<td class="px-3 py-2 text-ink">{attempt.universeName}</td>
									<td class="px-3 py-2 text-ink-2">{reasonLabel(attempt)}</td>
									<td class="px-3 py-2">
										<Badge variant={STATUS_VARIANT[attempt.status]}>
											{t.indexing.statusLabel[attempt.status]}
										</Badge>
									</td>
									<td class="px-3 py-2 text-ink-2 tabular-nums"
										>{stamp.format(attempt.requestedAt)}</td
									>
									<td class="px-3 py-2 text-ink-2 tabular-nums">
										{#if attempt.finishedAt === null}
											<span class="text-muted">-</span>
										{:else}
											{stamp.format(attempt.finishedAt)}
										{/if}
									</td>
									<td class="px-3 py-2 text-ink tabular-nums">{attempt.attemptCount}</td>
									<td class="px-3 py-2 text-ink tabular-nums">
										{attempt.entitiesTotal ?? '-'} / {attempt.entitiesMissing ?? '-'} / {attempt.entitiesScheduled}
									</td>
									<td class="px-3 py-2">
										{#if attempt.lastError === null}
											<span class="text-muted">-</span>
										{:else}
											<code class="text-label text-ink-2">{attempt.lastError}</code>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</TableScroll>
			</section>
		{/if}
	</div>
</Page>
