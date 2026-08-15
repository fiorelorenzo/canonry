<script lang="ts">
	import { dateFormat, messages, numberFormat } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { PageHeader } from '$lib/components/ui/page-header';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).admin);

	type Kind = 'reading' | 'generation' | 'import';

	// Reading first: it is the free half of the story this page exists to tell,
	// generation and import are the two kinds that actually spend a user's quota.
	const KIND_ORDER: readonly Kind[] = ['reading', 'generation', 'import'];

	const groups = $derived(
		KIND_ORDER.map((kind) => ({
			kind,
			prices: data.prices.filter((price) => price.kind === kind)
		})).filter((group) => group.prices.length > 0)
	);

	const creditsFormat = $derived(numberFormat(data.locale, { maximumFractionDigits: 4 }));
	const changeDateFormat = $derived(
		dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' })
	);

	function formatCredits(value: number): string {
		return creditsFormat.format(value);
	}
</script>

<svelte:head>
	<title>{t.pricing.browserTitle}</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-8 py-10">
	<PageHeader title={t.pricing.title} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
	<p class="mt-6 max-w-measure text-sm text-ink-2">{@html t.pricing.intro1}</p>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		{t.pricing.intro2}
	</p>

	{#each groups as group (group.kind)}
		<section class="mt-8">
			<h2 class="text-lg font-semibold text-ink">{t.pricing.kindLabel[group.kind]}</h2>
			<div class="mt-3 overflow-x-auto rounded-lg border border-line">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr
							class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
						>
							<th class="px-3 py-2 font-normal">{t.pricing.table.label}</th>
							<th class="px-3 py-2 font-normal">{t.pricing.table.operation}</th>
							<th class="px-3 py-2 font-normal">{t.pricing.table.credits}</th>
							<th class="px-3 py-2 font-normal">{t.pricing.table.notes}</th>
							<th class="px-3 py-2 font-normal">{t.pricing.table.lastChange}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-line">
						{#each group.prices as price (price.operation)}
							{@const change = data.lastChangeByOperation.get(price.operation)}
							{@const failedHere = form?.operation === price.operation && !!form?.error}
							{@const savedHere = form?.operation === price.operation && !!form?.saved}
							{@const fieldId = `credits-${price.operation}`}
							<tr class="bg-panel align-top">
								<td class="px-3 py-3 text-ink">{price.label}</td>
								<td class="px-3 py-3"><code class="text-xs text-ink-2">{price.operation}</code></td>
								<td class="px-3 py-3">
									<form method="POST" class="flex flex-col gap-1">
										<input type="hidden" name="operation" value={price.operation} />
										<div class="flex items-center gap-2">
											<Label class="sr-only" for={fieldId}
												>{t.pricing.creditsFor(price.label)}</Label
											>
											<Input
												id={fieldId}
												type="number"
												name="credits"
												min="0"
												step="0.0001"
												value={failedHere ? form?.credits : price.credits}
												class="w-24 tabular-nums {failedHere ? 'border-danger' : ''}"
												aria-invalid={failedHere ? 'true' : undefined}
												aria-describedby={failedHere ? `${fieldId}-error` : undefined}
											/>
											<Button type="submit" size="sm">
												{t.save}
											</Button>
										</div>
										{#if failedHere}
											<p id="{fieldId}-error" class="text-xs text-danger">{form?.error}</p>
										{:else if savedHere}
											<p class="text-xs text-ok">{t.pricing.saved}</p>
										{/if}
									</form>
								</td>
								<td class="max-w-xs px-3 py-3 text-xs text-ink-2">{price.notes ?? ''}</td>
								<td class="px-3 py-3 text-xs text-ink-2">
									{#if change}
										{t.pricing.lastChangeSummary(
											formatCredits(change.oldCredits),
											formatCredits(change.newCredits),
											change.changedBy ?? t.unattributed,
											changeDateFormat.format(change.changedAt)
										)}
									{:else}
										{t.pricing.noChangesYet}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/each}
</div>
