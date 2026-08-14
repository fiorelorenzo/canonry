<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });
	const creditsFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
	const eurFormat = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
</script>

<svelte:head>
	<title>Billing: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-measure px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">&larr; Universes</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">Billing</h1>
	<p class="mt-2 max-w-xl text-sm text-ink-2">
		Included quota with routing between cheap and premium models. No opaque credits, and no plan
		here is ever called "unlimited" - every plan states a real ceiling (SPEC.md §15).
	</p>

	{#if !data.signedIn}
		<p class="mt-6 text-sm text-ink-2">
			<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">Sign in</a> to see your plan
			and balance.
		</p>
	{:else}
		{#if data.checkout === 'cancelled'}
			<p class="mt-4 rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink-2">
				Checkout was cancelled - your plan has not changed.
			</p>
		{/if}

		<section class="mt-6 rounded-lg border border-line bg-panel p-4">
			<h2 class="text-base font-semibold text-ink">
				Current plan: {data.plan?.name ?? data.balance.plan}
			</h2>
			<p class="mt-1 text-sm text-ink-2">
				{#if data.balance.periodEnd}
					Renews {dateFormat.format(new Date(data.balance.periodEnd))}
				{:else}
					No renewal date on record yet.
				{/if}
			</p>

			<dl class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
				<div>
					<dt class="text-xs text-muted uppercase">Included this period</dt>
					<dd class="text-lg font-semibold text-ink tabular-nums">
						{creditsFormat.format(data.balance.subscriptionCredits)} credits
					</dd>
				</div>
				<div>
					<dt class="text-xs text-muted uppercase">Purchased (never expires)</dt>
					<dd class="text-lg font-semibold text-ink tabular-nums">
						{creditsFormat.format(data.balance.purchasedCredits)} credits
					</dd>
				</div>
				<div>
					<dt class="text-xs text-muted uppercase">Warm budget</dt>
					<dd class="text-lg font-semibold text-ink tabular-nums">
						{creditsFormat.format(data.balance.warmBudgetRemaining)} / {creditsFormat.format(
							data.balance.warmBudgetCredits
						)}
					</dd>
				</div>
			</dl>
		</section>

		<section class="mt-8">
			<h2 class="text-lg font-semibold text-ink">Plans</h2>
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
							{eurFormat.format(plan.priceEurPerMonth)}<span class="text-sm font-normal text-muted"
								>/month</span
							>
						</p>
						<p class="mt-2 flex-1 text-xs text-ink-2">{plan.ceiling}</p>

						{#if current}
							<span class="mt-4 text-xs font-medium text-accent-ink">Current plan</span>
						{:else if plan.id !== 'free'}
							<form method="POST" action="?/checkout" class="mt-4">
								<input type="hidden" name="planId" value={plan.id} />
								<button
									type="submit"
									class="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:bg-accent-ink"
								>
									Switch to {plan.name}
								</button>
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
</main>
