<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Kind = 'reading' | 'generation' | 'import';

	// Reading first: it is the free half of the story this page exists to tell,
	// generation and import are the two kinds that actually spend a user's quota.
	const KIND_ORDER: readonly Kind[] = ['reading', 'generation', 'import'];
	const KIND_LABEL: Record<Kind, string> = {
		reading: 'Reading, always free',
		generation: 'Generation, charged',
		import: 'Import, charged per document'
	};

	const groups = $derived(
		KIND_ORDER.map((kind) => ({
			kind,
			prices: data.prices.filter((price) => price.kind === kind)
		})).filter((group) => group.prices.length > 0)
	);

	const creditsFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
	const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

	function formatCredits(value: number): string {
		return creditsFormat.format(value);
	}
</script>

<svelte:head>
	<title>Operation pricing, Canonry admin</title>
</svelte:head>

<main id="main" class="mx-auto max-w-4xl px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">&larr; Universes</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">Operation pricing</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		SPEC.md §15, issue #113: the credit price of every chargeable operation lives here, not in code,
		and a change here takes effect immediately, not after a cache expiry. A price of
		<b class="text-ink">zero</b> means the operation is free to the user: that is the whole mechanism
		behind reading staying free, not a special case bolted on elsewhere.
	</p>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		Free to the user is not free to us: every call, priced or not, is still recorded in full with
		its real tokens and euro cost, because the margin question is answered from those rows and
		nowhere else.
	</p>

	{#each groups as group (group.kind)}
		<section class="mt-8">
			<h2 class="text-lg font-semibold text-ink">{KIND_LABEL[group.kind]}</h2>
			<div class="mt-3 overflow-x-auto rounded-lg border border-line">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr
							class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
						>
							<th class="px-3 py-2 font-normal">Label</th>
							<th class="px-3 py-2 font-normal">Operation</th>
							<th class="px-3 py-2 font-normal">Credits</th>
							<th class="px-3 py-2 font-normal">Notes</th>
							<th class="px-3 py-2 font-normal">Last change</th>
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
											<label class="sr-only" for={fieldId}>Credits for {price.label}</label>
											<input
												id={fieldId}
												type="number"
												name="credits"
												min="0"
												step="0.0001"
												value={failedHere ? form?.credits : price.credits}
												class="w-24 rounded border border-line-2 bg-panel px-2 py-1 text-ink tabular-nums"
												class:border-danger={failedHere}
												aria-invalid={failedHere ? 'true' : undefined}
												aria-describedby={failedHere ? `${fieldId}-error` : undefined}
											/>
											<button
												type="submit"
												class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-panel hover:bg-accent-ink"
											>
												Save
											</button>
										</div>
										{#if failedHere}
											<p id="{fieldId}-error" class="text-xs text-danger">{form?.error}</p>
										{:else if savedHere}
											<p class="text-xs text-ok">Saved.</p>
										{/if}
									</form>
								</td>
								<td class="max-w-xs px-3 py-3 text-xs text-ink-2">{price.notes ?? ''}</td>
								<td class="px-3 py-3 text-xs text-ink-2">
									{#if change}
										{formatCredits(change.oldCredits)} &rarr; {formatCredits(change.newCredits)} credits,
										{change.changedBy ?? 'no admin identity yet (#86)'}, {dateFormat.format(
											change.changedAt
										)}
									{:else}
										No changes since it was seeded.
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/each}
</main>
