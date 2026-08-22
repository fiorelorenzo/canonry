<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { dateFormat, messages, numberFormat } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Keyed by plan id - more than one non-free plan can render its own checkout form.
	let redirecting = $state<Record<string, boolean>>({});

	const t = $derived(messages(data.locale).settings.billing);
	// SPEC.md §17's own example lives on this page: Italian wants a decimal comma and a
	// different digit grouping, not just translated labels around the same digits.
	// `useGrouping: 'always'` because the locale default ("auto") only groups it-IT from
	// 10,000 up under real CLDR data - a warm-budget ratio in the low thousands must
	// still group consistently with the English rendering at the same magnitude.
	const creditsFormat = $derived(
		numberFormat(data.locale, { maximumFractionDigits: 0, useGrouping: 'always' })
	);
	const eurFormat = $derived(numberFormat(data.locale, { style: 'currency', currency: 'EUR' }));
	const periodFormat = $derived(dateFormat(data.locale, { dateStyle: 'medium' }));
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

{#if !data.signedIn}
	<p class="mt-6 text-sm text-ink-2">
		<a
			href={resolve('/auth/sign-in')}
			class="text-accent underline decoration-line-2 underline-offset-2">{t.signInLink}</a
		>
		{t.signInPrompt}
	</p>
{:else}
	{#if data.checkout === 'cancelled'}
		<p class="mt-4 rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink-2">
			{t.checkoutCancelled}
		</p>
	{/if}

	<section class="mt-6 rounded-lg border border-line bg-panel p-4">
		<h2 class="text-base font-semibold text-ink">
			{t.currentPlan(data.plan?.name ?? data.balance.plan)}
		</h2>
		<p class="mt-1 text-sm text-ink-2">
			{#if data.balance.periodEnd}
				{t.renews(periodFormat.format(new Date(data.balance.periodEnd)))}
			{:else}
				{t.noRenewalDate}
			{/if}
		</p>

		<dl class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div>
				<dt class="text-xs text-muted uppercase">{t.includedThisPeriod}</dt>
				<dd class="text-lg font-semibold text-ink tabular-nums">
					{t.creditsCount(data.balance.subscriptionCredits)}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-muted uppercase">{t.purchased}</dt>
				<dd class="text-lg font-semibold text-ink tabular-nums">
					{t.creditsCount(data.balance.purchasedCredits)}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-muted uppercase">{t.warmBudget}</dt>
				<dd class="text-lg font-semibold text-ink tabular-nums">
					{creditsFormat.format(data.balance.warmBudgetRemaining)} / {creditsFormat.format(
						data.balance.warmBudgetCredits
					)}
				</dd>
			</div>
		</dl>
	</section>

	<section class="mt-8">
		<h2 class="text-lg font-semibold text-ink">{t.plansHeading}</h2>
		<div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
			{#each data.plans as plan (plan.id)}
				{@const current = plan.id === data.balance.plan}
				<div
					class="flex flex-col rounded-lg border p-4"
					class:border-accent={current}
					class:border-line={!current}
					class:bg-accent-bg={current}
					class:bg-panel={!current}
				>
					<h3 class="text-base font-semibold text-ink">{plan.name}</h3>
					<p class="mt-1 text-2xl font-semibold text-ink">
						{eurFormat.format(plan.priceEurPerMonth)}<span class="text-sm font-normal text-ink-2"
							>{t.perMonth}</span
						>
					</p>
					<p class="mt-2 flex-1 text-xs text-ink-2">{plan.ceiling}</p>

					{#if current}
						<span class="mt-4 text-xs font-medium text-accent-ink">{t.currentPlanBadge}</span>
					{:else if plan.id !== 'free'}
						<form
							method="POST"
							action="?/checkout"
							class="mt-4"
							use:enhance={() => {
								redirecting = { ...redirecting, [plan.id]: true };
								return async ({ result, update }) => {
									if (result.type !== 'redirect')
										redirecting = { ...redirecting, [plan.id]: false };
									await update();
								};
							}}
						>
							<input type="hidden" name="planId" value={plan.id} />
							<Button type="submit" class="w-full" disabled={redirecting[plan.id]}>
								{redirecting[plan.id] ? t.redirecting : t.switchTo(plan.name)}
							</Button>
						</form>
					{/if}
				</div>
			{/each}
		</div>

		{#if form?.error}
			<p class="mt-3 text-sm text-danger">{form.error}</p>
		{/if}
	</section>
{/if}
