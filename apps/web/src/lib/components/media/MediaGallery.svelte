<script lang="ts" module>
	export interface MediaGalleryAsset {
		id: string;
		mimeType: string;
		generated: boolean;
		gmOnly: boolean;
		credits: number;
		createdAt: string | Date;
	}

	type ModelSummary = { provider: string; modelId: string } | null;

	/** Everything the gallery needs about one entry's images, in one shape three call
	 * sites share (issue #385): the rail's compact preview (`EntryMediaPanel.svelte`),
	 * the cover placeholder (`EntryCoverPlaceholder.svelte`), both "full" mode, and the
	 * editor's own image button (`MarkdownEditor.svelte`, "pick" mode, `onPick` set).
	 * The five full-mode-only fields are optional because pick mode never reads them -
	 * the edit page has no reason to fetch a cover id or portrait/variants pricing it
	 * never shows. */
	export interface MediaGalleryData {
		universeSlug: string;
		entitySlug: string;
		entityName: string;
		entityType: string;
		aiEnabled: boolean;
		canWrite: boolean;
		assets: MediaGalleryAsset[];
		coverAssetId?: string | null;
		styleModifier?: string | null;
		entityImagePromptModifier?: string | null;
		portraitPrice?: number;
		variantsPrice?: number;
		portraitModel?: ModelSummary;
		variantsModel?: ModelSummary;
	}
</script>

<script lang="ts">
	/**
	 * Issue #385, decision R10: one media surface per entry instead of three that
	 * disagreed. `EntryMediaPanel.svelte`'s 256px rail could generate, upload, set a
	 * per-image `gm_only` and a cover, and edit the style override, but not insert into
	 * the body. `EntryCoverDialog.svelte` did one image for one purpose.
	 * `ImageInsertDialog.svelte`'s 448px thumbnail column could insert and generate but
	 * knew nothing about covers or visibility. None of the three could delete an image,
	 * because none of them owned "every action on the image it applies to" - this does.
	 *
	 * Full mode (`onPick` absent - the rail and the placeholder): use as cover, hide
	 * from the party (the Solo GM switch, R7/#382), refine (regenerate from any
	 * existing generated asset's stored prompt, not only a just-generated candidate -
	 * refining a picture from a previous session had nowhere to happen before this),
	 * delete. Two ways in at the top, upload and generate (portrait/variants, the same
	 * confirm-first `GenerateDialog` the rail always used).
	 *
	 * Pick mode (`onPick` set - the editor's own image button): the surface trims down
	 * to picking a width and an image and handing both back to the caret, R9's other
	 * end (#384) - nothing here to manage, that stays in full mode. Upload and generate
	 * still work, but generate asks for `scene` (a body illustration, not a cover) with
	 * no radio, and every existing asset is a single "use this image" button rather
	 * than something with a cover/hide/delete row of its own.
	 *
	 * A `Dialog`, not a `Sheet`: a `Sheet`'s own left/right width caps at `sm:max-w-sm`
	 * (this needs to be wider, not narrower), and its one wide shape is the bottom
	 * sheet, which #148 already reserves for the whole aside on small screens. The
	 * vendored `Dialog` centres reliably since R2 (#377) and already supports a wider
	 * override the same way the two dialogs this replaces did - `sm:max-w-3xl` here is
	 * that override, wide enough for a real grid instead of one column.
	 */
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog';
	import { Segmented, type SegmentedOption } from '$lib/components/ui/segmented';
	import type { ImageFeature } from '@canonry/db/schema';
	import { IMAGE_WIDTH_PERCENTS, type ImageWidthPercent } from '$lib/markdown';
	import GenerateDialog from './GenerateDialog.svelte';

	interface Candidate {
		id: string;
		mimeType: string;
	}

	let {
		open = $bindable(false),
		data,
		scene,
		locale,
		onPick
	}: {
		open?: boolean;
		data: MediaGalleryData;
		/** Pick mode only: what one in-body image costs and which model draws it - the
		 * `scene` feature, never portrait/variants, since a body image is a scene and
		 * not a cover (#258). */
		scene?: { price: number; model: ModelSummary };
		locale: Locale;
		/** Present only for the editor's own picker: every existing image becomes a
		 * single "use this image" button, and upload or a freshly generated candidate
		 * both hand their result straight back instead of settling into the grid. */
		onPick?: (url: string, widthPercent: ImageWidthPercent) => void;
	} = $props();
	let t = $derived(messages(locale));
	let pickMode = $derived(onPick !== undefined);
	// EntryMediaPanel mounts this component twice (#148's desktop/mobile-sheet pair),
	// so a bare literal id would collide across both copies - same fix
	// EntryProseWithSecrets.svelte's own player-preview switch already uses.
	const instanceUid = $props.id();

	let base = $derived(resolve(`/w/${data.universeSlug}/e/${data.entitySlug}/media`));
	function imageUrl(id: string): string {
		return `${base}/${id}`;
	}

	let error = $state<string | null>(null);
	let candidates = $state<Candidate[]>([]);
	let selectedCandidateId = $state<string | null>(null);
	let inserting = $state(false);

	// Full mode only: the nested confirm-first generate dialog (portrait/variants), and
	// the style override editor beside it.
	let dialogOpen = $state(false);
	let generating = $state(false);
	let regenerateSourceId = $state<string | null>(null);
	let reusedFromCache = $state(false);
	let styleEditorOpen = $state(false);
	let styleDraft = $state('');
	let savingStyle = $state(false);

	// Pick mode only: the width chosen up top, shared by every way to leave with a URL.
	let widthChoice = $state<`${ImageWidthPercent}`>('100');
	let widthOptions = $derived<SegmentedOption[]>(
		IMAGE_WIDTH_PERCENTS.map((percent) => ({
			value: `${percent}`,
			label:
				percent === 33
					? t.entry.media.inBody.width.third
					: percent === 67
						? t.entry.media.inBody.width.twoThirds
						: t.entry.media.inBody.width.full
		}))
	);

	let uploadInput: HTMLInputElement | undefined;
	let uploading = $state(false);

	let updatingGmOnlyId = $state<string | null>(null);
	let coveringId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let confirmingDeleteId = $state<string | null>(null);

	// This component persists across repeated opens (the rail and the placeholder each
	// keep their own mount alive across a navigation to a different entry, same as
	// EntryMediaPanel always has), so nothing from a previous open should bleed into
	// the next one.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			error = null;
			candidates = [];
			selectedCandidateId = null;
			confirmingDeleteId = null;
			widthChoice = '100';
		}
		wasOpen = open;
	});

	function close(): void {
		open = false;
	}

	function discardCandidates(): void {
		candidates = [];
		selectedCandidateId = null;
	}

	/** Full mode: portrait/variants, from `GenerateDialog`, including a regeneration
	 * sourced from any existing asset id (attached or a fresh candidate alike). */
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
			const responseData = (await res.json()) as { reusedFromCache: boolean; assets: Candidate[] };
			if (fromAssetId) {
				candidates = [...candidates, ...responseData.assets];
				selectedCandidateId = responseData.assets[0]?.id ?? selectedCandidateId;
			} else {
				candidates = responseData.assets;
				selectedCandidateId = responseData.assets[0]?.id ?? null;
			}
			reusedFromCache = responseData.reusedFromCache;
			dialogOpen = false;
			regenerateSourceId = null;
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.genericGenerationFailed;
		} finally {
			generating = false;
		}
	}

	/** Pick mode: always `scene`, never a radio - a body image is a scene, not a cover. */
	async function generateScene(): Promise<void> {
		error = null;
		generating = true;
		try {
			const res = await fetch(`${base}/generate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ feature: 'scene' })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.inBody.generateFailedWithStatus(res.status));
			}
			const responseData = (await res.json()) as { assets: Candidate[] };
			candidates = responseData.assets;
			selectedCandidateId = responseData.assets[0]?.id ?? null;
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.inBody.generateFailed;
		} finally {
			generating = false;
		}
	}

	function startRefine(assetId: string): void {
		regenerateSourceId = assetId;
		dialogOpen = true;
	}

	/** Full mode: attaches the selected candidate into the main grid, no `onPick` call. */
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
			candidates = [];
			selectedCandidateId = null;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.genericInsertFailed;
		} finally {
			inserting = false;
		}
	}

	/** Pick mode: attaches the chosen candidate, then hands its URL and the chosen
	 * width straight back to the caret and closes. */
	async function useCandidateForPick(candidateId: string): Promise<void> {
		error = null;
		inserting = true;
		try {
			const res = await fetch(`${base}/attach`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mediaAssetId: candidateId })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.inBody.attachFailedWithStatus(res.status));
			}
			const url = imageUrl(candidateId);
			await invalidateAll();
			onPick?.(url, Number(widthChoice) as ImageWidthPercent);
			close();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.inBody.attachFailed;
		} finally {
			inserting = false;
		}
	}

	function pickExisting(assetId: string): void {
		onPick?.(imageUrl(assetId), Number(widthChoice) as ImageWidthPercent);
		close();
	}

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
			const asset = (await res.json()) as { id: string };
			await invalidateAll();
			if (pickMode) {
				onPick?.(imageUrl(asset.id), Number(widthChoice) as ImageWidthPercent);
				close();
			}
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.upload.genericUploadFailed;
		} finally {
			uploading = false;
			if (uploadInput) uploadInput.value = '';
		}
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

	async function handleToggleGmOnly(asset: MediaGalleryAsset, gmOnly: boolean): Promise<void> {
		error = null;
		updatingGmOnlyId = asset.id;
		try {
			const res = await fetch(`${base}/publish`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mediaAssetId: asset.id, gmOnly })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.publish.genericUpdateFailedWithStatus(res.status));
			}
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.publish.genericUpdateFailed;
		} finally {
			updatingGmOnlyId = null;
		}
	}

	async function handleToggleCover(asset: MediaGalleryAsset): Promise<void> {
		error = null;
		coveringId = asset.id;
		try {
			const res = await fetch(`${base}/cover`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mediaAssetId: data.coverAssetId === asset.id ? null : asset.id })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.cover.genericCoverFailedWithStatus(res.status));
			}
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.cover.genericCoverFailed;
		} finally {
			coveringId = null;
		}
	}

	/** The delete button is a two-click confirm rather than a native `confirm()`, same
	 * translated, themed control set as everything else here. The server's own refusal
	 * (cover, in-body reference) is what actually protects `entity.cover_asset_id` and
	 * the body - the client-side disable below is only a head start on the cover case,
	 * the one this component already knows the answer to without asking. */
	async function handleDelete(asset: MediaGalleryAsset): Promise<void> {
		if (confirmingDeleteId !== asset.id) {
			confirmingDeleteId = asset.id;
			return;
		}
		error = null;
		deletingId = asset.id;
		try {
			const res = await fetch(`${base}/${asset.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.delete.genericDeleteFailedWithStatus(res.status));
			}
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.delete.genericDeleteFailed;
		} finally {
			deletingId = null;
			confirmingDeleteId = null;
		}
	}
</script>

<Dialog bind:open>
	<!-- `sm:max-w-3xl`, not `max-w-3xl`: `DialogContent`'s own base class ends in
	     `sm:max-w-md`, and tailwind-merge treats a responsive variant as a different group
	     from the bare utility, so both survived the merge and the `sm` one won at every
	     viewport above 640px. The gallery rendered at 448px, the width of the dialog this
	     decision exists to replace, with the cover button's own label clipped by the edge.
	     Measured after the change: 768px at 1440. -->
	<DialogContent
		closeLabel={t.entry.media.gallery.closeLabel}
		class="flex max-h-[85vh] w-[min(56rem,calc(100vw-2rem))] flex-col overflow-y-auto rounded-lg border border-line bg-panel p-0 text-ink sm:max-w-3xl"
	>
		<div class="p-5">
			<DialogTitle class="text-base font-semibold text-ink">
				{pickMode
					? t.entry.media.inBody.dialogTitle
					: t.entry.media.gallery.dialogTitle(data.entityName)}
			</DialogTitle>

			{#if !data.aiEnabled}
				<p class="mt-3 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink-2">
					{t.entry.media.aiOffBanner}
				</p>
			{/if}

			{#if error}
				<p class="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
					{error}
				</p>
			{/if}

			{#if pickMode}
				<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
					{t.entry.media.inBody.width.heading}
				</h4>
				<Segmented
					name={`gallery-image-width-${instanceUid}`}
					bind:value={widthChoice}
					options={widthOptions}
					ariaLabel={t.entry.media.inBody.width.ariaLabel}
					class="mt-2"
				/>
			{/if}

			{#if candidates.length > 0}
				{#if pickMode}
					<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
						{t.entry.media.inBody.generateHeading}
					</h4>
					<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
						{#each candidates as candidate (candidate.id)}
							<button
								type="button"
								class="overflow-hidden rounded-md border-2"
								class:border-accent={selectedCandidateId === candidate.id}
								class:border-transparent={selectedCandidateId !== candidate.id}
								aria-pressed={selectedCandidateId === candidate.id}
								aria-label={t.entry.media.inBody.insertThisImage}
								onclick={() => (selectedCandidateId = candidate.id)}
							>
								<img src={imageUrl(candidate.id)} alt="" class="block h-auto w-full" />
							</button>
						{/each}
					</div>
					<div class="mt-2 flex gap-2">
						<Button
							type="button"
							size="sm"
							disabled={!selectedCandidateId || inserting}
							onclick={() => selectedCandidateId && useCandidateForPick(selectedCandidateId)}
						>
							{inserting ? t.entry.media.inserting : t.entry.media.inBody.useThisOne}
						</Button>
						<Button type="button" variant="secondary" size="sm" onclick={discardCandidates}>
							{t.entry.media.discard}
						</Button>
					</div>
				{:else}
					<div class="mt-3 rounded-md border border-line bg-panel-2 p-3">
						<p class="text-xs text-ink-2">
							{t.entry.media.candidatesSummary(reusedFromCache, candidates.length > 1)}
						</p>
						<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
							{#each candidates as candidate (candidate.id)}
								<button
									type="button"
									class="overflow-hidden rounded-md border-2"
									class:border-accent={selectedCandidateId === candidate.id}
									class:border-transparent={selectedCandidateId !== candidate.id}
									onclick={() => (selectedCandidateId = candidate.id)}
								>
									<img
										src={imageUrl(candidate.id)}
										alt="Generated candidate"
										class="block h-auto w-full"
									/>
								</button>
							{/each}
						</div>
						<div class="mt-2 flex flex-wrap gap-2">
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
								disabled={!selectedCandidateId || !data.aiEnabled}
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
			{/if}

			{#if pickMode}
				<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
					{t.entry.media.inBody.existingHeading}
				</h4>
				{#if data.assets.length === 0}
					<p class="mt-1 text-sm text-ink-2">{t.entry.media.inBody.emptyExisting}</p>
				{:else}
					<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
						{#each data.assets as asset (asset.id)}
							<button
								type="button"
								class="relative overflow-hidden rounded-md border border-line hover:border-accent"
								aria-label={t.entry.media.inBody.insertThisImage}
								onclick={() => pickExisting(asset.id)}
							>
								<img src={imageUrl(asset.id)} alt="" class="block h-auto w-full" />
								{#if asset.generated}
									<span
										class="absolute top-1 left-1 rounded-full border border-ai-line bg-ai-bg px-1 py-0.5 text-[9px] font-semibold tracking-wide text-ai uppercase"
									>
										{t.entry.media.generatedBadge}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			{:else if data.assets.length === 0 && candidates.length === 0}
				<div class="mt-3">
					<EmptyState
						kind="derived"
						message={t.entry.media.empty}
						explanation={t.entry.media.explanation}
					/>
				</div>
			{:else if data.assets.length > 0}
				<div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each data.assets as asset (asset.id)}
						<div class="overflow-hidden rounded-md border border-line">
							<div class="relative">
								<img src={imageUrl(asset.id)} alt={data.entityName} class="block h-auto w-full" />
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
								{#if asset.gmOnly}
									<span
										class="absolute top-1 right-1 rounded-full border border-warn bg-warn-bg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-warn uppercase"
									>
										{t.entry.media.publish.gmOnlyBadge}
									</span>
								{/if}
								{#if data.coverAssetId === asset.id}
									<span
										class="absolute bottom-1 left-1 rounded-full border border-line-2 bg-panel px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink uppercase"
									>
										{t.entry.media.cover.badge}
									</span>
								{/if}
							</div>
							{#if data.canWrite}
								<div class="flex flex-col gap-1.5 border-t border-line bg-panel-2 px-2 py-1.5">
									<div class="flex items-center gap-1.5">
										<Switch
											id={`gallery-gm-only-${instanceUid}-${asset.id}`}
											checked={asset.gmOnly}
											disabled={updatingGmOnlyId === asset.id}
											aria-label={t.entry.media.publish.ariaLabel}
											onCheckedChange={(checked) => handleToggleGmOnly(asset, checked)}
										/>
										<Label
											for={`gallery-gm-only-${instanceUid}-${asset.id}`}
											class="text-xs text-ink-2"
										>
											{t.entry.media.publish.label}
										</Label>
									</div>
									<div class="flex flex-wrap gap-1.5">
										<Button
											type="button"
											variant="secondary"
											size="sm"
											disabled={coveringId === asset.id}
											onclick={() => handleToggleCover(asset)}
										>
											{#if coveringId === asset.id}
												{t.entry.media.cover.saving}
											{:else}
												{data.coverAssetId === asset.id
													? t.entry.media.cover.removeLabel
													: t.entry.media.cover.useLabel}
											{/if}
										</Button>
										{#if asset.generated}
											<Button
												type="button"
												variant="secondary"
												size="sm"
												disabled={!data.aiEnabled}
												onclick={() => startRefine(asset.id)}
											>
												{t.entry.media.regenerate.trigger}
											</Button>
										{/if}
										<Button
											type="button"
											variant="destructive"
											size="sm"
											disabled={deletingId === asset.id || data.coverAssetId === asset.id}
											title={data.coverAssetId === asset.id
												? t.entry.media.delete.refusedCover
												: undefined}
											onclick={() => handleDelete(asset)}
										>
											{#if deletingId === asset.id}
												{t.entry.media.delete.deleting}
											{:else if confirmingDeleteId === asset.id}
												{t.entry.media.delete.confirmLabel}
											{:else}
												{t.entry.media.delete.label}
											{/if}
										</Button>
										{#if confirmingDeleteId === asset.id}
											<Button
												type="button"
												variant="secondary"
												size="sm"
												onclick={() => (confirmingDeleteId = null)}
											>
												{t.entry.media.cancel}
											</Button>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<p class="mt-2 text-xs text-muted">{t.entry.media.publish.explanation}</p>
				<p class="mt-1 text-xs text-muted">{t.entry.media.cover.explanation}</p>
			{/if}

			{#if data.canWrite}
				<div class="mt-4 border-t border-line pt-4">
					<input
						bind:this={uploadInput}
						type="file"
						accept="image/png,image/jpeg,image/webp"
						class="hidden"
						onchange={handleUpload}
					/>
					<div class="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="secondary"
							disabled={uploading}
							onclick={() => uploadInput?.click()}
						>
							{uploading ? t.entry.media.upload.uploading : t.entry.media.upload.button}
						</Button>
						{#if !pickMode}
							<Button
								type="button"
								disabled={!data.aiEnabled}
								onclick={() => {
									regenerateSourceId = null;
									dialogOpen = true;
								}}
							>
								{t.entry.media.generateButton}
							</Button>
						{/if}
					</div>

					{#if pickMode && data.aiEnabled}
						<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
							{t.entry.media.inBody.generateHeading}
						</h4>
						{#if candidates.length === 0}
							{#if scene?.model}
								<p class="mt-2 text-sm text-ink-2">
									{t.entry.media.inBody.sceneCost(scene.price)}
								</p>
								<p class="text-xs text-muted">
									{scene.model.provider}/{scene.model.modelId}
								</p>
								<Button
									type="button"
									size="sm"
									class="mt-2"
									disabled={generating}
									onclick={generateScene}
								>
									{generating ? t.entry.media.generating : t.entry.media.inBody.generateButton}
								</Button>
							{:else}
								<p class="mt-2 text-sm text-ink-2">{t.entry.media.inBody.sceneNotConfigured}</p>
							{/if}
						{/if}
					{/if}

					{#if !pickMode && styleEditorOpen}
						<div class="mt-3 rounded-md border border-line bg-panel-2 p-3">
							<label
								class="block text-xs font-medium text-ink-2"
								for={`gallery-style-override-${instanceUid}`}
							>
								{t.entry.media.styleOverrideLabel}
							</label>
							<Textarea
								id={`gallery-style-override-${instanceUid}`}
								bind:value={styleDraft}
								rows={2}
								class="mt-1"
							/>
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
				</div>
			{/if}

			<div class="mt-4">
				<Button type="button" variant="secondary" size="sm" onclick={close}>
					{t.entry.media.cancel}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>

{#if !pickMode}
	<GenerateDialog
		bind:open={dialogOpen}
		entityName={data.entityName}
		entityType={data.entityType}
		styleModifier={data.styleModifier ?? null}
		portraitPrice={data.portraitPrice ?? 0}
		variantsPrice={data.variantsPrice ?? 0}
		portraitModel={data.portraitModel ?? null}
		variantsModel={data.variantsModel ?? null}
		busy={generating}
		regenerateSource={regenerateSourceId
			? { id: regenerateSourceId, imageUrl: imageUrl(regenerateSourceId) }
			: null}
		onGenerate={handleGenerate}
		onEditStyle={() => {
			styleDraft = data.entityImagePromptModifier ?? '';
			styleEditorOpen = true;
		}}
		{locale}
	/>
{/if}
