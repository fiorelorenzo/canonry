<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Page } from '$lib/components/ui/page';
	import ProviderSelect from '$lib/components/admin/ProviderSelect.svelte';
	import CurrencySelect from '$lib/components/admin/CurrencySelect.svelte';
	import { COVER_ASPECT_RATIOS } from '$lib/components/media/cover-crop';
	import { InlineLink } from '$lib/components/ui/link';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Keyed by row identity (text purpose / image feature) - the same per-row pending
	// map AuditFlagsPanel.svelte and LiveProposalFeed.svelte already use, since several
	// of these rows can be mid-save independently.
	let saving = $state<Record<string, boolean>>({});

	const t = $derived(messages(data.locale).admin);

	const activeDateFormat = $derived(
		dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' })
	);

	function paramsPricePerImage(params: unknown): string {
		if (typeof params !== 'object' || params === null) return '';
		const value = (params as { pricePerImage?: unknown }).pricePerImage;
		return typeof value === 'number' ? String(value) : '';
	}

	function paramsCurrency(params: unknown): string | undefined {
		if (typeof params !== 'object' || params === null) return undefined;
		const value = (params as { currency?: unknown }).currency;
		return typeof value === 'string' ? value : undefined;
	}

	/** #332: read-only, unlike the two fields above. The shape a feature generates at is a
	 * product decision that lives on the row so a model swap cannot drop it, and the save
	 * refuses a model whose own schema does not offer it, so an admin choosing a model needs
	 * to see the constraint they are being held to. */
	function paramsAspectRatio(params: unknown): string | undefined {
		if (typeof params !== 'object' || params === null) return undefined;
		const value = (params as { aspectRatio?: unknown }).aspectRatio;
		return typeof value === 'string' ? value : undefined;
	}

	/** SvelteKit's `ActionData` is a union across both named actions' fail()/success shapes
	 * (`text` and `image`), and they share no discriminant TypeScript can narrow on cleanly -
	 * same problem and same fix as /settings/keys/+page.svelte's own doc comment. */
	function fieldOf(candidate: unknown, key: string): unknown {
		return candidate && typeof candidate === 'object' && key in candidate
			? (candidate as Record<string, unknown>)[key]
			: undefined;
	}
</script>

<svelte:head>
	<title>{t.models.browserTitle}</title>
</svelte:head>

<Page width="wide" title={t.models.textHeading}>
	<div class="px-8 py-10">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
		<p class="mt-6 max-w-measure text-body text-ink-2">{@html t.models.textIntro1}</p>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
		<p class="mt-2 max-w-measure text-body text-ink-2">{@html t.models.textIntro2}</p>

		<div class="mt-8 overflow-x-auto rounded-lg border border-line">
			<table class="w-full border-collapse text-body">
				<thead>
					<tr
						class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
					>
						<th class="px-3 py-2 font-normal">{t.models.table.purpose}</th>
						<th class="px-3 py-2 font-normal">{t.models.table.currentlyActive}</th>
						<th class="px-3 py-2 font-normal">{t.models.table.provider}</th>
						<th class="px-3 py-2 font-normal">{t.models.table.modelId}</th>
						<th class="px-3 py-2 font-normal"
							><span class="sr-only">{t.models.table.actions}</span></th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-line">
					{#each data.textModels as row (row.purpose)}
						{@const forThisRow = form && fieldOf(form, 'purpose') === row.purpose ? form : null}
						{@const errorHere = forThisRow
							? (fieldOf(forThisRow, 'error') as string | undefined)
							: undefined}
						{@const savedHere = forThisRow
							? (fieldOf(forThisRow, 'saved') as boolean | undefined)
							: undefined}
						{@const activeProviderKnown =
							!!row.active &&
							(data.knownProviders as readonly string[]).includes(row.active.provider)}
						{@const providerValue =
							(errorHere ? (fieldOf(forThisRow, 'provider') as string | undefined) : undefined) ??
							(activeProviderKnown ? row.active?.provider : undefined)}
						{@const modelIdValue =
							(errorHere ? (fieldOf(forThisRow, 'modelId') as string | undefined) : undefined) ??
							row.active?.modelId ??
							''}
						{@const providerId = `text-provider-${row.purpose}`}
						{@const modelIdId = `text-modelId-${row.purpose}`}
						<tr class="bg-panel align-top">
							<td class="px-3 py-3 text-ink">
								{t.models.purposeLabel[row.purpose as keyof typeof t.models.purposeLabel] ??
									row.purpose}
							</td>
							<td class="px-3 py-3 text-label">
								{#if row.active}
									<div class="font-mono text-ink">
										{row.active.provider} / {row.active.modelId}
									</div>
									<div class="mt-1 text-muted">{activeDateFormat.format(row.active.updatedAt)}</div>
									{#if !activeProviderKnown}
										<div class="mt-1 text-danger">
											{t.models.table.providerUnknown(row.active.provider)}
										</div>
									{/if}
								{:else}
									<span class="text-muted">{t.models.table.notConfigured}</span>
								{/if}
							</td>
							<td colspan="2" class="px-3 py-3">
								<form
									method="POST"
									action="?/text"
									class="flex flex-wrap items-center gap-2"
									use:enhance={() => {
										saving = { ...saving, [row.purpose]: true };
										return async ({ update }) => {
											await update();
											saving = { ...saving, [row.purpose]: false };
										};
									}}
								>
									<input type="hidden" name="purpose" value={row.purpose} />
									<div class="flex flex-col gap-1">
										<Label class="sr-only" for={providerId}>{t.models.table.provider}</Label>
										<ProviderSelect
											id={providerId}
											providers={data.knownProviders}
											value={providerValue}
											invalid={!!errorHere}
										/>
									</div>
									<div class="flex flex-col gap-1">
										<Label class="sr-only" for={modelIdId}>{t.models.table.modelId}</Label>
										<Input
											id={modelIdId}
											name="modelId"
											value={modelIdValue}
											class="w-64 font-mono text-label {errorHere ? 'border-danger' : ''}"
										/>
									</div>
									<Button type="submit" size="sm" disabled={saving[row.purpose]}>
										{saving[row.purpose] ? t.saving : t.save}
									</Button>
									{#if errorHere}
										<p class="w-full text-label text-danger">{errorHere}</p>
									{:else if savedHere}
										<p class="w-full text-label text-ok">{t.models.saved}</p>
									{/if}
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<h2 class="mt-12 text-title font-semibold text-ink">{t.models.imageHeading}</h2>
		<p class="mt-2 max-w-measure text-body text-ink-2">{t.models.imageIntro1}</p>
		<p class="mt-2 max-w-measure text-body text-ink-2">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
			{@html t.models.imageIntro2Pre}
			<InlineLink href={resolve('/admin/pricing')}>{t.pricing.title}</InlineLink>.
		</p>

		<div class="mt-8 overflow-x-auto rounded-lg border border-line">
			<table class="w-full border-collapse text-body">
				<thead>
					<tr
						class="border-b border-line bg-panel-2 text-left text-label tracking-wide text-muted uppercase"
					>
						<th class="px-3 py-2 font-normal">{t.models.imageTable.feature}</th>
						<th class="px-3 py-2 font-normal">{t.models.table.provider}</th>
						<th class="px-3 py-2 font-normal">{t.models.table.modelId}</th>
						<th class="px-3 py-2 font-normal">{t.models.imageTable.pricePerImage}</th>
						<th class="px-3 py-2 font-normal"
							><span class="sr-only">{t.models.imageTable.actions}</span></th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-line">
					{#each data.images as model (model.id)}
						{@const forThisRow = form && fieldOf(form, 'feature') === model.feature ? form : null}
						{@const errorHere = forThisRow
							? (fieldOf(forThisRow, 'error') as string | undefined)
							: undefined}
						{@const savedHere = forThisRow
							? (fieldOf(forThisRow, 'saved') as boolean | undefined)
							: undefined}
						{@const providerValue =
							(errorHere ? (fieldOf(forThisRow, 'provider') as string | undefined) : undefined) ??
							model.provider}
						{@const modelIdValue =
							(errorHere ? (fieldOf(forThisRow, 'modelId') as string | undefined) : undefined) ??
							model.modelId}
						{@const priceValue =
							(errorHere
								? (fieldOf(forThisRow, 'pricePerImage') as string | undefined)
								: undefined) ?? paramsPricePerImage(model.params)}
						{@const currencyValue =
							(errorHere ? (fieldOf(forThisRow, 'currency') as string | undefined) : undefined) ??
							paramsCurrency(model.params)}
						{@const providerId = `provider-${model.feature}`}
						{@const modelIdId = `modelId-${model.feature}`}
						{@const priceId = `price-${model.feature}`}
						{@const currencyId = `currency-${model.feature}`}
						<tr class="bg-panel align-top">
							<td class="px-3 py-3 text-ink">
								{t.models.featureLabel[model.feature as keyof typeof t.models.featureLabel]}
								<div class="text-label text-muted">
									{model.active ? t.models.imageTable.active : t.models.imageTable.inactive}
								</div>
								<div class="text-label text-muted">
									{t.models.imageTable.aspectRatio}:
									<span class="font-mono"
										>{paramsAspectRatio(model.params) ??
											t.models.imageTable.aspectRatioNotSet}</span
									>
								</div>
								{#if model.feature === 'portrait' || model.feature === 'variants'}
									<!-- #366: a cover's shape comes from the entity type, so the row's own value is
								     only the default for a caller with no entity. Saying so here stops the row
								     reading as the whole answer, and the save checks every shape in this list. -->
									<div class="text-label text-muted">
										{t.models.imageTable.coverAspectRatios(COVER_ASPECT_RATIOS.join(', '))}
									</div>
								{/if}
							</td>
							<td colspan="3" class="px-3 py-3">
								<form
									method="POST"
									action="?/image"
									class="flex flex-wrap items-center gap-2"
									use:enhance={() => {
										saving = { ...saving, [model.feature]: true };
										return async ({ update }) => {
											await update();
											saving = { ...saving, [model.feature]: false };
										};
									}}
								>
									<input type="hidden" name="feature" value={model.feature} />
									<div class="flex flex-col gap-1">
										<Label class="sr-only" for={providerId}>{t.models.table.provider}</Label>
										<Input id={providerId} name="provider" value={providerValue} class="w-28" />
									</div>
									<div class="flex flex-col gap-1">
										<Label class="sr-only" for={modelIdId}>{t.models.table.modelId}</Label>
										<Input
											id={modelIdId}
											name="modelId"
											value={modelIdValue}
											class="w-64 font-mono text-label"
										/>
									</div>
									<div class="flex flex-col gap-1">
										<Label class="sr-only" for={priceId}>{t.models.imageTable.pricePerImage}</Label>
										<Input
											id={priceId}
											type="number"
											name="pricePerImage"
											min="0"
											step="0.000001"
											value={priceValue}
											class="w-24 tabular-nums"
										/>
									</div>
									<div class="flex flex-col gap-1">
										<Label class="sr-only" for={currencyId}>{t.models.imageTable.currency}</Label>
										<CurrencySelect
											id={currencyId}
											currencies={data.currencies}
											value={currencyValue}
											invalid={!!errorHere}
										/>
									</div>
									<Button type="submit" size="sm" disabled={saving[model.feature]}>
										{saving[model.feature] ? t.saving : t.save}
									</Button>
									{#if errorHere}
										<p class="w-full text-label text-danger">{errorHere}</p>
									{:else if savedHere}
										<p class="w-full text-label text-ok">{t.models.saved}</p>
									{/if}
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</Page>
