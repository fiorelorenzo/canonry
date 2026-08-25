<script lang="ts">
	/**
	 * Issue #790: file-first, Notion-inspired. When there is nothing imported yet, the
	 * empty state is not a button that leads to a form - it IS the drop zone, the only
	 * surface on the page. Dropping or picking a file posts straight to `?/upload`,
	 * which detects the format and computes the estimate in the same round trip, before
	 * anything spends a credit; the result is one preview screen (`stage === 'preview'`)
	 * with a single explicit "Start import" button. `?/confirm` only exists to
	 * recompute that preview if the GM overrides the detected playbook.
	 *
	 * Drag-and-drop is layered on the same `<form>` a no-JS browser already posts on
	 * submit: `handleDrop` just fills the real `<input type=file>` and calls the same
	 * `requestSubmit()` a JS "onchange" already does. The visible file input and the
	 * "Upload" button below the zone are the no-JS fallback only: once the page is
	 * scripted (`scripted`, set on mount, the same signal `native-fallback.svelte`
	 * keys on) the input collapses to `sr-only` - it is still the form's value
	 * carrier, a drop writes into it - and the button goes away, because `onchange`
	 * already submits. SSR output, which is what a reader with scripting off gets,
	 * carries both.
	 */
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Page } from '$lib/components/ui/page';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import PlaybookSelect from '$lib/components/onboarding/PlaybookSelect.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let t = $derived(messages(data.locale).import);

	// Cancel (back to the drop zone) is purely local - nothing has reached the database
	// yet at the preview stage, so there is nothing server-side to undo. Cleared on the
	// next real submission below, so a fresh drop or an override always wins over a
	// stale cancel from a previous file.
	let stageOverride = $state<'upload' | null>(null);
	const stage = $derived(stageOverride ?? form?.stage ?? 'upload');

	// Every form on this page shares this shape, so one flag covers all of them - only
	// one is ever rendered at a time.
	let submitting = $state(false);
	let dragging = $state(false);
	let uploadFormEl: HTMLFormElement | undefined = $state();
	let fileInputEl: HTMLInputElement | undefined = $state();

	let scripted = $state(false);
	onMount(() => {
		scripted = true;
	});

	function submitChosenFile(): void {
		uploadFormEl?.requestSubmit();
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		dragging = true;
	}

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		dragging = false;
		const files = event.dataTransfer?.files;
		if (!files || files.length === 0 || !fileInputEl) return;
		fileInputEl.files = files;
		submitChosenFile();
	}

	function cancelPreview(): void {
		stageOverride = 'upload';
	}

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
</script>

<svelte:head>
	<title>{t.upload.headTitle(data.universe.name)}</title>
</svelte:head>

<Page
	width="working"
	eyebrow={data.universe.name}
	title={t.upload.heading}
	description={t.upload.description}
>
	<div class="flex flex-col gap-8 px-6 py-8">
		{#if form && 'error' in form && form.error}
			<p class="rounded-md bg-danger-bg px-3 py-2 text-body text-danger">{form.error}</p>
		{/if}

		{#if data.canStart}
			<div id="import-upload">
				{#if stage === 'upload'}
					{#if data.fakeDriverSupported}
						<p class="mb-3 text-body text-muted">{t.upload.noLiveModelNotice}</p>
					{/if}

					<form
						method="POST"
						action="?/upload"
						enctype="multipart/form-data"
						bind:this={uploadFormEl}
						class="flex flex-col gap-3"
						use:enhance={() => {
							submitting = true;
							return async ({ update }) => {
								await update();
								submitting = false;
								stageOverride = null;
							};
						}}
					>
						<label
							for="import-file"
							class={dragging
								? 'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-accent bg-accent-bg px-8 py-16 text-center transition-colors'
								: 'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line-2 bg-panel-2 px-8 py-16 text-center transition-colors'}
							ondragover={handleDragOver}
							ondragleave={() => (dragging = false)}
							ondrop={handleDrop}
						>
							<span class="text-title font-medium text-ink">{t.upload.dropzone.heading}</span>
							<span class="text-body text-ink-2">{t.upload.dropzone.hint}</span>
							<span class="max-w-md text-label text-ink-2">{t.upload.dropzone.formats}</span>
						</label>

						<Label class="sr-only" for="import-file">{t.existing.fileInputLabel}</Label>
						<input
							id="import-file"
							bind:this={fileInputEl}
							type="file"
							name="file"
							accept={data.uploadAccept}
							required
							class={scripted ? 'sr-only' : 'block text-body text-ink-2'}
							onchange={submitChosenFile}
						/>

						{#if !scripted}
							<Button type="submit" class="self-start" disabled={submitting}>
								{submitting ? t.upload.uploading : t.upload.uploadButton}
							</Button>
						{/if}
					</form>
				{:else if form && form.stage === 'preview'}
					<div class="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
						<p class="text-body font-medium text-ink">
							{t.upload.confirm.uploadedSummary(form.fileName, (form.fileBytes / 1024).toFixed(1))}
						</p>

						<div>
							<h2 class="text-title font-semibold text-ink">
								{form.confident
									? t.upload.confirm.detected(data.playbookLabels[form.playbookId])
									: t.upload.confirm.notDetected(data.playbookLabels[form.playbookId])}
							</h2>
							{#if form.detail}
								<p class="mt-1 text-body text-muted">{t.upload.confirm.detail(form.detail)}</p>
							{/if}
							{#each form.notices as notice (notice)}
								<p
									class="mt-2 rounded-md border border-line-2 bg-panel-2 p-3 text-body text-ink"
									data-testid="import-detected-notice"
								>
									{t.upload.confirm.notice(notice)}
								</p>
							{/each}
						</div>

						<form
							method="POST"
							action="?/confirm"
							class="flex flex-wrap items-end gap-3"
							use:enhance={() => {
								submitting = true;
								return async ({ update }) => {
									await update();
									submitting = false;
									stageOverride = null;
								};
							}}
						>
							<input type="hidden" name="tempId" value={form.tempId} />
							<input type="hidden" name="fileName" value={form.fileName} />
							<input type="hidden" name="fileBytes" value={form.fileBytes} />

							<div class="flex flex-col gap-1">
								<Label for="playbookId" class="text-label font-normal text-ink-2"
									>{t.upload.confirm.playbookLabel}</Label
								>
								<PlaybookSelect
									playbookId={form.playbookId}
									playbookIds={data.playbookIds}
									playbookLabels={data.playbookLabels}
								/>
							</div>

							<Button type="submit" variant="secondary" size="sm" disabled={submitting}>
								{submitting ? t.upload.confirm.checking : t.upload.preview.useFormat}
							</Button>
						</form>

						{#if form.blocked !== 'no_documents'}
							<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
								<dt class="text-muted">{t.upload.estimate.sizeLabel}</dt>
								<dd class="text-ink">{t.upload.estimate.documentCount(form.documentCount)}</dd>
								<dt class="text-muted">{t.upload.estimate.timeLabel}</dt>
								<dd class="text-ink">
									{t.upload.estimate.estimatedMinutes(form.estimatedMinutes)}
								</dd>
								<dt class="text-muted">{t.upload.estimate.costLabel}</dt>
								<dd class="text-ink">
									{t.upload.estimate.estimatedCredits(form.estimatedCredits)}
								</dd>
							</dl>
						{/if}

						{#if form.blocked === 'needs_live_model' && !form.error}
							<p class="rounded-md bg-warn-bg px-3 py-2 text-body text-warn">
								{t.upload.errors.needsLiveModel(data.playbookLabels[form.playbookId])}
							</p>
						{:else if form.blocked === 'no_documents' && !form.error}
							<p class="rounded-md bg-danger-bg px-3 py-2 text-body text-danger">
								{t.upload.errors.noDocumentsFound}
							</p>
						{/if}

						<div class="flex gap-3">
							<form
								method="POST"
								action="?/start"
								use:enhance={() => {
									submitting = true;
									return async ({ update }) => {
										await update();
										submitting = false;
										stageOverride = null;
									};
								}}
							>
								<input type="hidden" name="tempId" value={form.tempId} />
								<input type="hidden" name="playbookId" value={form.playbookId} />
								<input type="hidden" name="fileName" value={form.fileName} />
								<input type="hidden" name="fileBytes" value={form.fileBytes} />
								<Button type="submit" disabled={submitting || form.blocked !== null}>
									{submitting ? t.upload.estimate.starting : t.upload.estimate.startButton}
								</Button>
							</form>
							<Button type="button" variant="ghost" onclick={cancelPreview}>
								{t.upload.preview.cancel}
							</Button>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<p class="text-body text-ink-2">{t.existing.viewerNotice}</p>
		{/if}

		{#if data.jobs.length > 0 || !data.canStart}
			<div>
				<h2 class="mb-3 text-label font-semibold tracking-wide text-muted uppercase">
					{t.existing.jobsHeading}
				</h2>

				{#if data.jobs.length === 0}
					<EmptyState kind="cold" message={t.existing.jobsEmpty} />
				{:else}
					<ul class="flex flex-col gap-2">
						{#each data.jobs as job (job.id)}
							<li>
								<a
									href={resolve(`/w/${data.universe.slug}/import/${job.id}/review`)}
									class="flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3 transition-colors hover:border-line-2"
								>
									<div class="min-w-0">
										<p class="font-medium text-ink">{job.playbookLabel}</p>
										<p class="text-label text-muted">
											{t.job.statusWord[job.status]} &middot; {t.upload.estimate.documentCount(
												job.documentCount
											)} &middot; {t.existing.proposals(job.proposalsEmitted)} &middot; {formatWhen(
												job.createdAt
											)}
										</p>
									</div>
									<span
										class="flex-none rounded-md border border-line-2 px-2 py-1 text-label text-ink-2"
									>
										{t.existing.reviewLink}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
</Page>
