<script lang="ts">
	/**
	 * Three states on one screen: D1 = C ("detect then confirm", docs/ux/DECISIONS.md,
	 * d1-source-selection.html) for upload -> confirm, then D2 = B's estimate card
	 * (d2-estimate-and-progress.html) for confirm -> start. The live feed itself lives on
	 * /onboarding/import/[job], reached only after the explicit "Start import" consent
	 * click below - guardrail 1 extended to spend: no auto-start the instant a file lands.
	 */
	import { enhance } from '$app/forms';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import PlaybookSelect from '$lib/components/onboarding/PlaybookSelect.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let t = $derived(messages(data.locale).import.upload);
	const stage = $derived(form?.stage ?? 'upload');
	// Only one of the three stage forms below is ever rendered at once, so one flag
	// covers all three.
	let submitting = $state(false);
</script>

<svelte:head>
	<title>{t.headTitle(data.universe.name)}</title>
</svelte:head>

<PageHeader eyebrow={data.universe.name} title={t.heading} />
<PageBody width="working">
	<div class="flex flex-col gap-6 px-8 py-16">
		{#if form && 'error' in form && form.error}
			<p class="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.error}</p>
		{/if}

		{#if stage === 'upload'}
			<p class="text-sm text-ink-2">
				{t.description}
			</p>
			{#if data.fakeDriverSupported}
				<p class="text-sm text-muted">
					{t.noLiveModelNotice}
				</p>
			{/if}

			<form
				method="POST"
				action="?universe={data.universe.slug}&/upload"
				enctype="multipart/form-data"
				class="flex flex-col gap-3"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
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
				<Button type="submit" class="self-start" disabled={submitting}>
					{submitting ? t.uploading : t.uploadButton}
				</Button>
			</form>
		{:else if form && form.stage === 'confirm'}
			<div class="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
				<p class="text-sm font-medium text-ink">
					{t.confirm.uploadedSummary(form.fileName, (form.fileBytes / 1024).toFixed(1))}
				</p>
				<div>
					<h2 class="text-sm font-semibold text-ink">
						{form.confident
							? t.confirm.detected(data.playbookLabels[form.playbookId])
							: t.confirm.notDetected(data.playbookLabels[form.playbookId])}
					</h2>
					{#if form.detail}
						<p class="mt-1 text-sm text-muted">{t.confirm.detail(form.detail)}</p>
					{/if}
					{#if form.notice}
						<p
							class="mt-2 rounded-md border border-line-2 bg-panel-2 p-3 text-sm text-ink"
							data-testid="import-detected-notice"
						>
							{t.confirm.notice(form.notice)}
						</p>
					{/if}
				</div>

				<form
					method="POST"
					action="?universe={data.universe.slug}&/confirm"
					class="flex flex-col gap-3"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update();
							submitting = false;
						};
					}}
				>
					<input type="hidden" name="universe" value={data.universe.slug} />
					<input type="hidden" name="tempId" value={form.tempId} />
					<input type="hidden" name="fileName" value={form.fileName} />
					<input type="hidden" name="fileBytes" value={form.fileBytes} />

					<Label for="playbookId" class="text-sm font-normal text-ink-2"
						>{t.confirm.playbookLabel}</Label
					>
					<PlaybookSelect
						playbookId={form.playbookId}
						playbookIds={data.playbookIds}
						playbookLabels={data.playbookLabels}
					/>

					<Button type="submit" class="self-start" disabled={submitting}>
						{submitting ? t.confirm.checking : t.confirm.continueButton}
					</Button>
				</form>
			</div>
		{:else if form && form.stage === 'estimate'}
			<div class="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
				<h2 class="text-sm font-semibold text-ink">{t.estimate.heading}</h2>
				<p class="text-sm text-muted">
					{t.estimate.summary(form.fileName, data.playbookLabels[form.playbookId])}
				</p>

				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
					<dt class="text-muted">{t.estimate.sizeLabel}</dt>
					<dd class="text-ink">{t.estimate.documentCount(form.documentCount)}</dd>
					<dt class="text-muted">{t.estimate.timeLabel}</dt>
					<dd class="text-ink">
						{t.estimate.estimatedMinutes(form.estimatedMinutes)}
					</dd>
					<dt class="text-muted">{t.estimate.costLabel}</dt>
					<dd class="text-ink">{t.estimate.estimatedCredits(form.estimatedCredits)}</dd>
				</dl>

				<form
					method="POST"
					action="?universe={data.universe.slug}&/start"
					class="flex gap-3"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update();
							submitting = false;
						};
					}}
				>
					<input type="hidden" name="universe" value={data.universe.slug} />
					<input type="hidden" name="tempId" value={form.tempId} />
					<input type="hidden" name="playbookId" value={form.playbookId} />
					<input type="hidden" name="fileName" value={form.fileName} />
					<input type="hidden" name="fileBytes" value={form.fileBytes} />
					<Button type="submit" disabled={submitting}>
						{submitting ? t.estimate.starting : t.estimate.startButton}
					</Button>
				</form>
			</div>
		{/if}
	</div>
</PageBody>
