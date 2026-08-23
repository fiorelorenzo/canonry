<script lang="ts">
	/**
	 * Issue R11, round thirteen: the door for a world that already exists. The upload ->
	 * confirm -> estimate flow below is D1/D2 verbatim from `/onboarding/import`'s own
	 * page (same components, same catalogue strings under `import.upload.*`) - this file
	 * only adds the "jobs already run" list underneath, which onboarding has no use for
	 * since a universe being created has none yet.
	 */
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
	const stage = $derived(form?.stage ?? 'upload');
	// Only one of the three stage forms below is ever rendered at once, so one flag
	// covers all three.
	let submitting = $state(false);

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
	<div class="flex flex-col gap-8 px-8 py-16">
		{#if form && 'error' in form && form.error}
			<p class="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.error}</p>
		{/if}

		{#if data.canStart}
			<div id="import-upload" class="flex flex-col gap-3">
				{#if stage === 'upload'}
					{#if data.fakeDriverSupported}
						<p class="text-sm text-muted">
							{t.upload.noLiveModelNotice}
						</p>
					{/if}

					<form
						method="POST"
						action="?/upload"
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
						<div class="rounded-lg border border-dashed border-line-2 bg-panel-2 p-8 text-center">
							<Label class="sr-only" for="import-file">{t.existing.fileInputLabel}</Label>
							<input
								id="import-file"
								type="file"
								name="file"
								accept={data.uploadAccept}
								required
								class="mx-auto block text-sm text-ink-2"
							/>
						</div>
						<Button type="submit" class="self-start" disabled={submitting}>
							{submitting ? t.upload.uploading : t.upload.uploadButton}
						</Button>
					</form>
				{:else if form && form.stage === 'confirm'}
					<div class="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
						<p class="text-sm font-medium text-ink">
							{t.upload.confirm.uploadedSummary(form.fileName, (form.fileBytes / 1024).toFixed(1))}
						</p>
						<div>
							<h2 class="text-sm font-semibold text-ink">
								{form.confident
									? t.upload.confirm.detected(data.playbookLabels[form.playbookId])
									: t.upload.confirm.notDetected(data.playbookLabels[form.playbookId])}
							</h2>
							{#if form.detail}
								<p class="mt-1 text-sm text-muted">{t.upload.confirm.detail(form.detail)}</p>
							{/if}
							{#each form.notices as notice (notice)}
								<p
									class="mt-2 rounded-md border border-line-2 bg-panel-2 p-3 text-sm text-ink"
									data-testid="import-detected-notice"
								>
									{t.upload.confirm.notice(notice)}
								</p>
							{/each}
						</div>

						<form
							method="POST"
							action="?/confirm"
							class="flex flex-col gap-3"
							use:enhance={() => {
								submitting = true;
								return async ({ update }) => {
									await update();
									submitting = false;
								};
							}}
						>
							<input type="hidden" name="tempId" value={form.tempId} />
							<input type="hidden" name="fileName" value={form.fileName} />
							<input type="hidden" name="fileBytes" value={form.fileBytes} />

							<Label for="playbookId" class="text-sm font-normal text-ink-2"
								>{t.upload.confirm.playbookLabel}</Label
							>
							<PlaybookSelect
								playbookId={form.playbookId}
								playbookIds={data.playbookIds}
								playbookLabels={data.playbookLabels}
							/>

							<Button type="submit" class="self-start" disabled={submitting}>
								{submitting ? t.upload.confirm.checking : t.upload.confirm.continueButton}
							</Button>
						</form>
					</div>
				{:else if form && form.stage === 'estimate'}
					<div class="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
						<h2 class="text-sm font-semibold text-ink">{t.upload.estimate.heading}</h2>
						<p class="text-sm text-muted">
							{t.upload.estimate.summary(form.fileName, data.playbookLabels[form.playbookId])}
						</p>

						<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							<dt class="text-muted">{t.upload.estimate.sizeLabel}</dt>
							<dd class="text-ink">{t.upload.estimate.documentCount(form.documentCount)}</dd>
							<dt class="text-muted">{t.upload.estimate.timeLabel}</dt>
							<dd class="text-ink">
								{t.upload.estimate.estimatedMinutes(form.estimatedMinutes)}
							</dd>
							<dt class="text-muted">{t.upload.estimate.costLabel}</dt>
							<dd class="text-ink">{t.upload.estimate.estimatedCredits(form.estimatedCredits)}</dd>
						</dl>

						<form
							method="POST"
							action="?/start"
							class="flex gap-3"
							use:enhance={() => {
								submitting = true;
								return async ({ update }) => {
									await update();
									submitting = false;
								};
							}}
						>
							<input type="hidden" name="tempId" value={form.tempId} />
							<input type="hidden" name="playbookId" value={form.playbookId} />
							<input type="hidden" name="fileName" value={form.fileName} />
							<input type="hidden" name="fileBytes" value={form.fileBytes} />
							<Button type="submit" disabled={submitting}>
								{submitting ? t.upload.estimate.starting : t.upload.estimate.startButton}
							</Button>
						</form>
					</div>
				{/if}
			</div>
		{:else}
			<p class="text-sm text-ink-2">{t.existing.viewerNotice}</p>
		{/if}

		<div>
			<h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
				{t.existing.jobsHeading}
			</h2>

			{#if data.jobs.length === 0}
				{#if data.canStart}
					<EmptyState kind="cold" message={t.existing.jobsEmpty}>
						{#snippet action()}
							<Button href="#import-upload">{t.existing.jobsEmptyAction}</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<EmptyState kind="cold" message={t.existing.jobsEmpty} />
				{/if}
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
									<p class="text-xs text-muted">
										{t.job.statusWord[job.status]} &middot; {t.upload.estimate.documentCount(
											job.documentCount
										)} &middot; {t.existing.proposals(job.proposalsEmitted)} &middot; {formatWhen(
											job.createdAt
										)}
									</p>
								</div>
								<span
									class="flex-none rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2"
								>
									{t.existing.reviewLink}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</Page>
