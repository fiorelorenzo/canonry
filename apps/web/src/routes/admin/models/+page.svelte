<script lang="ts">
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).admin);

	const activeDateFormat = $derived(
		dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' })
	);

	function paramsEurPerImage(params: unknown): string {
		if (typeof params !== 'object' || params === null) return '';
		const value = (params as { eurPerImage?: unknown }).eurPerImage;
		return typeof value === 'number' ? String(value) : '';
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

<main id="main" class="mx-auto max-w-4xl px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">{t.backToUniverses}</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">{t.models.textHeading}</h1>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
	<p class="mt-2 max-w-measure text-sm text-ink-2">{@html t.models.textIntro1}</p>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
	<p class="mt-2 max-w-measure text-sm text-ink-2">{@html t.models.textIntro2}</p>

	<div class="mt-8 overflow-x-auto rounded-lg border border-line">
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr
					class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
				>
					<th class="px-3 py-2 font-normal">{t.models.table.purpose}</th>
					<th class="px-3 py-2 font-normal">{t.models.table.currentlyActive}</th>
					<th class="px-3 py-2 font-normal">{t.models.table.provider}</th>
					<th class="px-3 py-2 font-normal">{t.models.table.modelId}</th>
					<th class="px-3 py-2 font-normal"></th>
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
						!!row.active && data.knownProviders.includes(row.active.provider)}
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
						<td class="px-3 py-3 text-xs">
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
							<form method="POST" action="?/text" class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="purpose" value={row.purpose} />
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={providerId}>{t.models.table.provider}</label>
									<select
										id={providerId}
										name="provider"
										class="w-32 rounded border border-line-2 bg-panel px-2 py-1 text-ink"
										class:border-danger={!!errorHere}
									>
										{#each data.knownProviders as provider (provider)}
											<option value={provider} selected={providerValue === provider}>
												{provider}
											</option>
										{/each}
									</select>
								</div>
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={modelIdId}>{t.models.table.modelId}</label>
									<input
										id={modelIdId}
										name="modelId"
										value={modelIdValue}
										class="w-64 rounded border border-line-2 bg-panel px-2 py-1 font-mono text-xs text-ink"
										class:border-danger={!!errorHere}
									/>
								</div>
								<button
									type="submit"
									class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-panel hover:bg-accent-ink"
								>
									{t.save}
								</button>
								{#if errorHere}
									<p class="w-full text-xs text-danger">{errorHere}</p>
								{:else if savedHere}
									<p class="w-full text-xs text-ok">{t.models.saved}</p>
								{/if}
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h1 class="mt-12 text-2xl font-semibold text-ink">{t.models.imageHeading}</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">{t.models.imageIntro1}</p>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, hand-written catalogue copy, never user input -->
		{@html t.models.imageIntro2Pre}
		<a href={resolve('/admin/pricing')} class="text-accent-ink hover:underline">{t.pricing.title}</a
		>.
	</p>

	<div class="mt-8 overflow-x-auto rounded-lg border border-line">
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr
					class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
				>
					<th class="px-3 py-2 font-normal">{t.models.imageTable.feature}</th>
					<th class="px-3 py-2 font-normal">{t.models.table.provider}</th>
					<th class="px-3 py-2 font-normal">{t.models.table.modelId}</th>
					<th class="px-3 py-2 font-normal">{t.models.imageTable.eurPerImage}</th>
					<th class="px-3 py-2 font-normal"></th>
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
					{@const eurValue =
						(errorHere ? (fieldOf(forThisRow, 'eurPerImage') as string | undefined) : undefined) ??
						paramsEurPerImage(model.params)}
					{@const providerId = `provider-${model.feature}`}
					{@const modelIdId = `modelId-${model.feature}`}
					{@const eurId = `eur-${model.feature}`}
					<tr class="bg-panel align-top">
						<td class="px-3 py-3 text-ink">
							{t.models.featureLabel[model.feature as keyof typeof t.models.featureLabel]}
							<div class="text-xs text-muted">
								{model.active ? t.models.imageTable.active : t.models.imageTable.inactive}
							</div>
						</td>
						<td colspan="3" class="px-3 py-3">
							<form method="POST" action="?/image" class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="feature" value={model.feature} />
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={providerId}>{t.models.table.provider}</label>
									<input
										id={providerId}
										name="provider"
										value={providerValue}
										class="w-28 rounded border border-line-2 bg-panel px-2 py-1 text-ink"
									/>
								</div>
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={modelIdId}>{t.models.table.modelId}</label>
									<input
										id={modelIdId}
										name="modelId"
										value={modelIdValue}
										class="w-64 rounded border border-line-2 bg-panel px-2 py-1 font-mono text-xs text-ink"
									/>
								</div>
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={eurId}>{t.models.imageTable.eurPerImage}</label>
									<input
										id={eurId}
										type="number"
										name="eurPerImage"
										min="0"
										step="0.000001"
										value={eurValue}
										class="w-24 rounded border border-line-2 bg-panel px-2 py-1 text-ink tabular-nums"
										class:border-danger={!!errorHere}
									/>
								</div>
								<button
									type="submit"
									class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-panel hover:bg-accent-ink"
								>
									{t.save}
								</button>
								{#if errorHere}
									<p class="w-full text-xs text-danger">{errorHere}</p>
								{:else if savedHere}
									<p class="w-full text-xs text-ok">{t.models.saved}</p>
								{/if}
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
