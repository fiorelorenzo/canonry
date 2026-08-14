<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const FEATURE_LABEL: Record<string, string> = {
		portrait: 'Portrait - one image per request',
		variants: 'Variants - up to four to choose from',
		scene: 'Scene'
	};

	function paramsEurPerImage(params: unknown): string {
		if (typeof params !== 'object' || params === null) return '';
		const value = (params as { eurPerImage?: unknown }).eurPerImage;
		return typeof value === 'number' ? String(value) : '';
	}
</script>

<svelte:head>
	<title>Image models, Canonry admin</title>
</svelte:head>

<main id="main" class="mx-auto max-w-4xl px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">&larr; Universes</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">Image models</h1>
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
				{#each data.models as model (model.id)}
					{@const failedHere = form?.feature === model.feature && !!form?.error}
					{@const savedHere = form?.feature === model.feature && !!form?.saved}
					{@const providerId = `provider-${model.feature}`}
					{@const modelIdId = `modelId-${model.feature}`}
					{@const eurId = `eur-${model.feature}`}
					<tr class="bg-panel align-top">
						<td class="px-3 py-3 text-ink">
							{FEATURE_LABEL[model.feature] ?? model.feature}
							<div class="text-xs text-muted">{model.active ? 'active' : 'inactive'}</div>
						</td>
						<td colspan="3" class="px-3 py-3">
							<form method="POST" class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="feature" value={model.feature} />
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={providerId}>Provider</label>
									<input
										id={providerId}
										name="provider"
										value={failedHere ? form?.provider : model.provider}
										class="w-28 rounded border border-line-2 bg-panel px-2 py-1 text-ink"
									/>
								</div>
								<div class="flex flex-col gap-1">
									<label class="sr-only" for={modelIdId}>Model id</label>
									<input
										id={modelIdId}
										name="modelId"
										value={failedHere ? form?.modelId : model.modelId}
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
										value={failedHere ? form?.eurPerImage : paramsEurPerImage(model.params)}
										class="w-24 rounded border border-line-2 bg-panel px-2 py-1 text-ink tabular-nums"
										class:border-danger={failedHere}
									/>
								</div>
								<button
									type="submit"
									class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-panel hover:bg-accent-ink"
								>
									Save
								</button>
								{#if failedHere}
									<p class="w-full text-xs text-danger">{form?.error}</p>
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
