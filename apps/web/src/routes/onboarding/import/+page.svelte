<script lang="ts">
	/**
	 * Three states on one screen: D1 = C ("detect then confirm", docs/ux/DECISIONS.md,
	 * d1-source-selection.html) for upload -> confirm, then D2 = B's estimate card
	 * (d2-estimate-and-progress.html) for confirm -> start. The live feed itself lives on
	 * /onboarding/import/[job], reached only after the explicit "Start import" consent
	 * click below - guardrail 1 extended to spend: no auto-start the instant a file lands.
	 */
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const stage = $derived(form?.stage ?? 'upload');
</script>

<svelte:head>
	<title>Import into {data.universe.name} &middot; Canonry</title>
</svelte:head>

<main id="main" class="mx-auto flex max-w-measure flex-col gap-6 px-8 py-16">
	<p class="text-xs tracking-wide text-muted uppercase">{data.universe.name}</p>
	<h1 class="text-2xl font-semibold text-ink">Import your world</h1>

	{#if form && 'error' in form && form.error}
		<p class="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.error}</p>
	{/if}

	{#if stage === 'upload'}
		<p class="text-sm text-ink-2">
			Drop an export from Obsidian, Kanka or World Anvil, or a PDF or DOCX file. Canonry guesses the
			source and shows you what it found before anything runs.
		</p>
		{#if data.fakeDriverSupported}
			<p class="text-sm text-muted">
				This deployment has no live model configured, so only Obsidian, Kanka and generic-text
				exports can actually run right now (detection still works for everything).
			</p>
		{/if}

		<form
			method="POST"
			action="?universe={data.universe.slug}&/upload"
			enctype="multipart/form-data"
			class="flex flex-col gap-3"
		>
			<input type="hidden" name="universe" value={data.universe.slug} />
			<div class="rounded-lg border border-dashed border-line-2 bg-panel-2 p-8 text-center">
				<input
					type="file"
					name="file"
					accept=".zip,.pdf,.docx,.md,.txt"
					required
					class="mx-auto block text-sm text-ink-2"
				/>
			</div>
			<button
				type="submit"
				class="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
			>
				Upload
			</button>
		</form>
	{:else if form && form.stage === 'confirm'}
		<div class="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
			<p class="text-sm font-medium text-ink">
				<strong>{form.fileName}</strong> uploaded, {(form.fileBytes / 1024).toFixed(1)} KB
			</p>
			<div>
				<h2 class="text-sm font-semibold text-ink">
					{form.confident ? 'Detected' : "Couldn't confidently detect a format"}: {data
						.playbookLabels[form.playbookId]}
				</h2>
				{#if form.detail}
					<p class="mt-1 text-sm text-muted">{form.detail}</p>
				{/if}
			</div>

			<form
				method="POST"
				action="?universe={data.universe.slug}&/confirm"
				class="flex flex-col gap-3"
			>
				<input type="hidden" name="universe" value={data.universe.slug} />
				<input type="hidden" name="tempId" value={form.tempId} />
				<input type="hidden" name="fileName" value={form.fileName} />
				<input type="hidden" name="fileBytes" value={form.fileBytes} />

				<label for="playbookId" class="text-sm text-ink-2">Playbook to run</label>
				<select
					id="playbookId"
					name="playbookId"
					class="w-60 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
				>
					{#each data.playbookIds as id (id)}
						<option value={id} selected={id === form.playbookId}>{data.playbookLabels[id]}</option>
					{/each}
				</select>

				<button
					type="submit"
					class="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
				>
					Confirm and continue
				</button>
			</form>
		</div>
	{:else if form && form.stage === 'estimate'}
		<div class="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
			<h2 class="text-sm font-semibold text-ink">Import estimate</h2>
			<p class="text-sm text-muted">
				{form.fileName}, {data.playbookLabels[form.playbookId]} playbook
			</p>

			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				<dt class="text-muted">Size</dt>
				<dd class="text-ink">{form.documentCount} document{form.documentCount === 1 ? '' : 's'}</dd>
				<dt class="text-muted">Time</dt>
				<dd class="text-ink">
					about {form.estimatedMinutes} minute{form.estimatedMinutes === 1 ? '' : 's'}
				</dd>
				<dt class="text-muted">Cost</dt>
				<dd class="text-ink">{form.estimatedCredits} credits</dd>
			</dl>

			<form method="POST" action="?universe={data.universe.slug}&/start" class="flex gap-3">
				<input type="hidden" name="universe" value={data.universe.slug} />
				<input type="hidden" name="tempId" value={form.tempId} />
				<input type="hidden" name="playbookId" value={form.playbookId} />
				<input type="hidden" name="fileName" value={form.fileName} />
				<input type="hidden" name="fileBytes" value={form.fileBytes} />
				<button
					type="submit"
					class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
				>
					Start import
				</button>
			</form>
		</div>
	{/if}
</main>
