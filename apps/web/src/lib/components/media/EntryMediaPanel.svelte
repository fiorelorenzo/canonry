<script lang="ts">
	/**
	 * The Images tab's real content (#65, #66, #71 - the handoff issue #66's own docstring
	 * in the old entry/ImagesPanel.svelte pointed at, now replaced by this component).
	 *
	 * Two steps, always: generate produces one image or four to choose from, all
	 * unattached; insert is a separate click that attaches the picked one to this entry.
	 * Guardrail 6 (#71, #254): attaching, generating and uploading never touch
	 * `published_to_players` - the only thing that does is the per-asset publish/unpublish
	 * button below, a GM's own deliberate click, never a side effect of anything else on
	 * this panel.
	 */
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { ImageFeature } from '@canonry/db/schema';
	import GenerateDialog from './GenerateDialog.svelte';

	type ModelSummary = { provider: string; modelId: string } | null;
	interface MediaAssetView {
		id: string;
		mimeType: string;
		generated: boolean;
		publishedToPlayers: boolean;
		credits: number;
		createdAt: string | Date;
	}

	let {
		universeSlug,
		entitySlug,
		entityName,
		entityType,
		aiEnabled,
		canWrite,
		assets: initialAssets,
		styleModifier,
		entityImagePromptModifier,
		portraitPrice,
		variantsPrice,
		portraitModel,
		variantsModel,
		locale
	}: {
		universeSlug: string;
		entitySlug: string;
		entityName: string;
		entityType: string;
		aiEnabled: boolean;
		canWrite: boolean;
		assets: MediaAssetView[];
		styleModifier: string | null;
		entityImagePromptModifier: string | null;
		portraitPrice: number;
		variantsPrice: number;
		portraitModel: ModelSummary;
		variantsModel: ModelSummary;
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));

	let base = $derived(resolve(`/w/${universeSlug}/e/${entitySlug}/media`));

	let assets = $derived(initialAssets);
	let dialogOpen = $state(false);
	let generating = $state(false);
	let error = $state<string | null>(null);

	interface Candidate {
		id: string;
		mimeType: string;
	}
	let candidates = $state<Candidate[]>([]);
	let selectedCandidateId = $state<string | null>(null);
	// #255: the candidate being refined when the dialog is opened in regenerate mode -
	// null means the next `dialogOpen = true` is a fresh generation. Set by the "Refine"
	// button below, cleared on a fresh "Generate image" click and after a successful
	// generation of either kind.
	let regenerateSourceId = $state<string | null>(null);
	let reusedFromCache = $state(false);
	let inserting = $state(false);

	let styleEditorOpen = $state(false);
	// Seeded fresh each time the editor opens (see the "edit" closure below), not read
	// here at mount, since EntryMediaPanel is reused across a navigation to a different
	// entry (SvelteKit does not remount on a route param change alone) and a bare
	// `$state(entityImagePromptModifier)` would otherwise keep showing the previous
	// entry's override text.
	let styleDraft = $state('');
	let savingStyle = $state(false);

	function imageUrl(id: string): string {
		return `${base}/${id}`;
	}

	async function handleGenerate(feature: ImageFeature, instruction?: string): Promise<void> {
		error = null;
		generating = true;
		const fromAssetId = regenerateSourceId;
		try {
			const res = await fetch(`${base}/generate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					feature,
					...(instruction ? { instruction } : {}),
					...(fromAssetId ? { fromAssetId } : {})
				})
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.genericGenerationFailedWithStatus(res.status));
			}
			const data = (await res.json()) as {
				reusedFromCache: boolean;
				assets: Candidate[];
			};
			// #255: a regeneration's result joins the candidate it refined instead of
			// replacing the whole batch, so the user can compare and keep either; a fresh
			// "Generate image" always starts a clean batch.
			if (fromAssetId) {
				candidates = [...candidates, ...data.assets];
				selectedCandidateId = data.assets[0]?.id ?? selectedCandidateId;
			} else {
				candidates = data.assets;
				selectedCandidateId = data.assets[0]?.id ?? null;
			}
			reusedFromCache = data.reusedFromCache;
			dialogOpen = false;
			regenerateSourceId = null;
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.genericGenerationFailed;
		} finally {
			generating = false;
		}
	}

	async function handleInsert(): Promise<void> {
		if (!selectedCandidateId) return;
		error = null;
		inserting = true;
		try {
			const res = await fetch(`${base}/attach`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mediaAssetId: selectedCandidateId })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.genericInsertFailedWithStatus(res.status));
			}
			// `assets` is derived from the `assets` prop (see its declaration above), so
			// there is nothing to push locally here - awaiting `invalidateAll()` below is
			// what brings the newly attached image into view, with the real row the server
			// just wrote (real credits, real createdAt) rather than a guessed one.
			candidates = [];
			selectedCandidateId = null;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.genericInsertFailed;
		} finally {
			inserting = false;
		}
	}

	function discardCandidates(): void {
		candidates = [];
		selectedCandidateId = null;
	}

	async function saveStyle(): Promise<void> {
		savingStyle = true;
		error = null;
		try {
			const res = await fetch(`${base}/style`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ modifier: styleDraft })
			});
			if (!res.ok) throw new Error(t.entry.media.styleSaveFailedWithStatus(res.status));
			styleEditorOpen = false;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.genericStyleSaveFailed;
		} finally {
			savingStyle = false;
		}
	}

	// #252: nothing here calls a model, so this control stays enabled even with
	// `aiEnabled` false (guardrail 4 - the wiki, including a GM's own pictures, keeps
	// working with the AI switched off). `uploadInput` is a plain ref, not `$state`,
	// same convention as `LanguageControl.svelte`'s `formEl`: it is only ever written by
	// the DOM binding and read imperatively from the click handler below, never read
	// reactively in the template.
	let uploadInput: HTMLInputElement | undefined;
	let uploading = $state(false);

	async function handleUpload(): Promise<void> {
		const chosen = uploadInput?.files?.[0];
		if (!chosen) return;
		error = null;
		uploading = true;
		try {
			const body = new FormData();
			body.set('file', chosen);
			const res = await fetch(`${base}/upload`, { method: 'POST', body });
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.upload.genericUploadFailedWithStatus(res.status));
			}
			// Same reasoning as handleInsert above: `assets` only ever changes through the
			// `assets` prop, so invalidateAll() is what brings the new row into the grid,
			// with the server's own id/createdAt rather than a locally guessed one.
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.upload.genericUploadFailed;
		} finally {
			uploading = false;
			if (uploadInput) uploadInput.value = '';
		}
	}

	// #254: which asset's publish/unpublish request is in flight, if any - one button at
	// a time makes sense (an asset can only be mid-toggle once), a shared `publishing`
	// boolean does not, since a GM might reasonably click a second asset's button while
	// the first request is still in the air.
	let publishingId = $state<string | null>(null);

	async function handleTogglePublish(asset: MediaAssetView): Promise<void> {
		error = null;
		publishingId = asset.id;
		try {
			const res = await fetch(`${base}/publish`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mediaAssetId: asset.id, published: !asset.publishedToPlayers })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.publish.genericPublishFailedWithStatus(res.status));
			}
			// Same reasoning as handleInsert/handleUpload above: `assets` only ever changes
			// through the `assets` prop, so invalidateAll() is what brings the real row's
			// new `publishedToPlayers` value into the grid.
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.publish.genericPublishFailed;
		} finally {
			publishingId = null;
		}
	}
</script>

{#if !aiEnabled}
	<p class="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink-2">
		{t.entry.media.aiOffBanner}
	</p>
{/if}

{#if error}
	<p class="mt-2 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
		{error}
	</p>
{/if}

{#if candidates.length > 0}
	<div class="mt-3 rounded-md border border-line bg-panel-2 p-3">
		<p class="text-xs text-ink-2">
			{t.entry.media.candidatesSummary(reusedFromCache, candidates.length > 1)}
		</p>
		<div class="mt-2 grid grid-cols-2 gap-2">
			{#each candidates as candidate (candidate.id)}
				<button
					type="button"
					class="overflow-hidden rounded-md border-2"
					class:border-accent={selectedCandidateId === candidate.id}
					class:border-transparent={selectedCandidateId !== candidate.id}
					onclick={() => (selectedCandidateId = candidate.id)}
				>
					<img src={imageUrl(candidate.id)} alt="Generated candidate" class="block h-auto w-full" />
				</button>
			{/each}
		</div>
		<div class="mt-2 flex gap-2">
			<Button
				type="button"
				size="sm"
				disabled={!selectedCandidateId || inserting}
				onclick={handleInsert}
			>
				{inserting ? t.entry.media.inserting : t.entry.media.insert}
			</Button>
			<Button type="button" variant="secondary" size="sm" onclick={discardCandidates}>
				{t.entry.media.discard}
			</Button>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={!selectedCandidateId || !aiEnabled}
				onclick={() => {
					regenerateSourceId = selectedCandidateId;
					dialogOpen = true;
				}}
			>
				{t.entry.media.regenerate.trigger}
			</Button>
		</div>
	</div>
{/if}

{#if assets.length === 0 && candidates.length === 0}
	<EmptyState
		kind="derived"
		message={t.entry.media.empty}
		explanation={t.entry.media.explanation}
	/>
{:else if assets.length > 0}
	<div class="mt-2 grid grid-cols-2 gap-2">
		{#each assets as asset (asset.id)}
			<div class="overflow-hidden rounded-md border border-line">
				<div class="relative">
					<img src={imageUrl(asset.id)} alt={entityName} class="block h-auto w-full" />
					{#if asset.generated}
						<span
							class="absolute top-1 left-1 rounded-full border border-ai-line bg-ai-bg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ai uppercase"
						>
							{t.entry.media.generatedBadge}
						</span>
					{:else}
						<span
							class="absolute top-1 left-1 rounded-full border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-2 uppercase"
						>
							{t.entry.media.upload.uploadedBadge}
						</span>
					{/if}
					{#if asset.publishedToPlayers}
						<span
							class="absolute top-1 right-1 rounded-full border border-accent bg-accent-bg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent-ink uppercase"
						>
							{t.entry.media.publish.publishedBadge}
						</span>
					{/if}
				</div>
				<!-- #254: per-asset publish state has to be legible on the asset itself, not
				     only in a summary sentence below the grid, since the grid is a mix of
				     published and private pictures once publishing is a real action. -->
				<div
					class="flex items-center justify-between gap-2 border-t border-line bg-panel-2 px-2 py-1"
				>
					<span class="text-[11px] text-ink-2">
						{asset.publishedToPlayers
							? t.entry.media.publish.publishedNote
							: t.entry.media.publish.privateNote}
					</span>
					{#if canWrite}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={publishingId === asset.id}
							onclick={() => handleTogglePublish(asset)}
						>
							{#if publishingId === asset.id}
								{asset.publishedToPlayers
									? t.entry.media.publish.unpublishing
									: t.entry.media.publish.publishing}
							{:else}
								{asset.publishedToPlayers
									? t.entry.media.publish.unpublishLabel
									: t.entry.media.publish.publishLabel}
							{/if}
						</Button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
	<p class="mt-1 text-xs text-muted">{t.entry.media.publish.explanation}</p>
{/if}

{#if canWrite}
	<Button
		type="button"
		class="mt-3"
		disabled={!aiEnabled}
		onclick={() => {
			regenerateSourceId = null;
			dialogOpen = true;
		}}
	>
		{t.entry.media.generateButton}
	</Button>

	<input
		bind:this={uploadInput}
		type="file"
		accept="image/png,image/jpeg,image/webp"
		class="hidden"
		onchange={handleUpload}
	/>
	<Button
		type="button"
		variant="secondary"
		class="mt-3 ml-2"
		disabled={uploading}
		onclick={() => uploadInput?.click()}
	>
		{uploading ? t.entry.media.upload.uploading : t.entry.media.upload.button}
	</Button>

	{#if styleEditorOpen}
		<div class="mt-3 rounded-md border border-line bg-panel-2 p-3">
			<label class="block text-xs font-medium text-ink-2" for="style-override">
				{t.entry.media.styleOverrideLabel}
			</label>
			<Textarea id="style-override" bind:value={styleDraft} rows={2} class="mt-1" />
			<div class="mt-2 flex gap-2">
				<Button type="button" size="sm" disabled={savingStyle} onclick={saveStyle}>
					{t.entry.media.save}
				</Button>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onclick={() => (styleEditorOpen = false)}
				>
					{t.entry.media.cancel}
				</Button>
			</div>
		</div>
	{/if}

	<GenerateDialog
		bind:open={dialogOpen}
		{entityName}
		{entityType}
		{styleModifier}
		{portraitPrice}
		{variantsPrice}
		{portraitModel}
		{variantsModel}
		busy={generating}
		regenerateSource={regenerateSourceId
			? { id: regenerateSourceId, imageUrl: imageUrl(regenerateSourceId) }
			: null}
		onGenerate={handleGenerate}
		onEditStyle={() => {
			styleDraft = entityImagePromptModifier ?? '';
			styleEditorOpen = true;
		}}
		{locale}
	/>
{/if}
