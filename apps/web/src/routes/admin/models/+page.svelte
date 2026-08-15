<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const PURPOSE_LABEL: Record<string, string> = {
		cheap: 'Cheap - candidate generation, quick actions',
		premium: 'Premium - diffs, ask, propagation',
		multimodal: 'Multimodal',
		embedding:
			'Embedding - similarity search, warm cache dedup, retrieval (must be multilingual - see note below)',
		image: 'Image (text purpose; see Image models below for the generator itself)'
	};

	const FEATURE_LABEL: Record<string, string> = {
		portrait: 'Portrait - one image per request',
		variants: 'Variants - up to four to choose from',
		scene: 'Scene'
	};

	const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

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
	<title>Models, Canonry admin</title>
</svelte:head>

<main id="main" class="mx-auto max-w-4xl px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">&larr; Universes</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">Text models</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		SPEC.md §11.1: the active model per purpose lives in <code class="text-xs">model_config</code>,
		not in code, and every flow - the Loremaster's four modes, propagation, warm generation,
		indexing, embedding - reads it through <code class="text-xs">resolveModel</code>. A change here
		takes effect on the very next call, no deploy, no restart. Provider is constrained to what
		<code class="text-xs">createLanguageModel</code> can actually build; a provider outside that list
		is not offered.
	</p>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		SPEC.md §17, issue #125: an Italian question against an English canon has to find the English
		chunk, so the <strong>embedding</strong> purpose is a deliberate multilingual choice, not a free
		one. Candidates were compared on published multilingual retrieval benchmarks (MIRACL, MTEB
		Multilingual) restricted to providers this build can construct - full reasoning and the
		disqualified/fallback candidates are in
		<code class="text-xs">packages/indexing/src/models.ts</code>'s
		<code class="text-xs">RECOMMENDED_EMBEDDING_MODEL</code>. Recommended:
		<code class="text-xs">google</code> / <code class="text-xs">gemini-embedding-001</code>
		(#1 on the MTEB Multilingual leaderboard, ~100 languages). Gap this box cannot close: no live embedding
		credential exists here to confirm en/it recall specifically - neither MIRACL nor MTEB publish an isolated
		English&harr;Italian score, so that is a live benchmark still owed once a real credential exists,
		not a settled number.
	</p>

	<div class="mt-8 overflow-x-auto rounded-lg border border-line">
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr
					class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
				>
					<th class="px-3 py-2 font-normal">Purpose</th>
					<th class="px-3 py-2 font-normal">Currently active</th>
					<th class="px-3 py-2 font-normal">Provider</th>
					<th class="px-3 py-2 font-normal">Model id</th>
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
							{PURPOSE_LABEL[row.purpose] ?? row.purpose}
						</td>
						<td class="px-3 py-3 text-xs">
							{#if row.active}
								<div class="font-mono text-ink">
									{row.active.provider} / {row.active.modelId}
								</div>
								<div class="mt-1 text-muted">{dateFormat.format(row.active.updatedAt)}</div>
								{#if !activeProviderKnown}
									<div class="mt-1 text-danger">
										provider "{row.active.provider}" is not one of this app's known providers - no
										call can be built for it until this is changed.
									</div>
								{/if}
							{:else}
								<span class="text-muted">not configured</span>
							{/if}
						</td>
						<td colspan="2" class="px-3 py-3">
							<form method="POST" action="?/text" class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="purpose" value={row.purpose} />
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={providerId}>Provider</label>
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
									<label class="sr-only" for={modelIdId}>Model id</label>
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
									Save
								</button>
								{#if errorHere}
									<p class="w-full text-xs text-danger">{errorHere}</p>
								{:else if savedHere}
									<p class="w-full text-xs text-ok">Saved. Takes effect immediately.</p>
								{/if}
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h1 class="mt-12 text-2xl font-semibold text-ink">Image models</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		SPEC.md §9, issue #64: the active model per feature lives here, not in code, and a change here
		takes effect on the very next "Generate image" request - no deploy, no restart.
	</p>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		Seeded default: <code class="text-xs">prunaai/p-image</code> for a single portrait,
		<code class="text-xs">black-forest-labs/flux-schnell</code> for the four-variant batch (SPEC.md
		§9). EUR per image is our own cost bookkeeping, never the credit price a GM sees - that lives in
		<a href={resolve('/admin/pricing')} class="text-accent-ink hover:underline">Operation pricing</a
		>.
	</p>

	<div class="mt-8 overflow-x-auto rounded-lg border border-line">
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr
					class="border-b border-line bg-panel-2 text-left text-xs tracking-wide text-muted uppercase"
				>
					<th class="px-3 py-2 font-normal">Feature</th>
					<th class="px-3 py-2 font-normal">Provider</th>
					<th class="px-3 py-2 font-normal">Model id</th>
					<th class="px-3 py-2 font-normal">EUR / image</th>
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
							{FEATURE_LABEL[model.feature] ?? model.feature}
							<div class="text-xs text-muted">{model.active ? 'active' : 'inactive'}</div>
						</td>
						<td colspan="3" class="px-3 py-3">
							<form method="POST" action="?/image" class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="feature" value={model.feature} />
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={providerId}>Provider</label>
									<input
										id={providerId}
										name="provider"
										value={providerValue}
										class="w-28 rounded border border-line-2 bg-panel px-2 py-1 text-ink"
									/>
								</div>
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={modelIdId}>Model id</label>
									<input
										id={modelIdId}
										name="modelId"
										value={modelIdValue}
										class="w-64 rounded border border-line-2 bg-panel px-2 py-1 font-mono text-xs text-ink"
									/>
								</div>
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={eurId}>EUR per image</label>
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
									Save
								</button>
								{#if errorHere}
									<p class="w-full text-xs text-danger">{errorHere}</p>
								{:else if savedHere}
									<p class="w-full text-xs text-ok">Saved. Takes effect immediately.</p>
								{/if}
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
