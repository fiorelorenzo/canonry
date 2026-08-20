<script lang="ts" module>
	export interface ExistingAsset {
		id: string;
		mimeType: string;
		generated: boolean;
	}

	/** What `MarkdownEditor.svelte` needs to open this dialog for a given entry - passed
	 * straight through from the edit route's `load`, since this dialog has no other way
	 * to know which entity it's placing an image into. */
	export interface ImageInsertContext {
		universeSlug: string;
		entrySlug: string;
		assets: ExistingAsset[];
		aiEnabled: boolean;
		/** #258: what one in-body image costs and which model draws it. `model` is null
		 * when `image_model_config` has no active `scene` row, which is the only state in
		 * which the generate button is withheld. */
		scene: { price: number; model: { provider: string; modelId: string } | null };
	}
</script>

<script lang="ts">
	/**
	 * Issue #253: the toolbar's "Image" button opens this. Three ways to leave it with a
	 * URL to hand back to `insertImage`: click one of the entry's existing images
	 * (`assets`, already attached - see `mediaAssetsForEntity`), upload a file, or generate
	 * a fresh one on the spot through the same `media/generate` endpoint the Images tab uses
	 * and attach it (`media/attach`) before handing it back, so a generated-from-here image
	 * is not an orphan invisible to the Images tab. Generation and attach stay two calls,
	 * same as `EntryMediaPanel.svelte`'s own two-step shape (#71) - this dialog does not
	 * reinvent that.
	 *
	 * **Upload is #366.** The editor's image button could offer a model's work and the
	 * entry's archive but not the GM's own file, which is the same hole in the same place
	 * `media/upload` was written for (#252): the endpoint existed and only the Images panel
	 * called it. The uploaded file is attached by that endpoint, so it lands in `assets` for
	 * next time as well as in the body now.
	 *
	 * Every path hands its URL to `onInsert`, which is `MarkdownEditor`'s
	 * `insertImageAtSelection`, so an insert lands where the caret was rather than at the
	 * end of the body.
	 *
	 * No price or model display for the generate path (unlike `GenerateDialog.svelte`): the
	 * Images tab already shows cost and lets a GM choose there before spending; duplicating
	 * that here would just be the same two numbers rendered a second time.
	 */
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog';

	// #258: a body image is a scene, not a portrait. This dialog used to offer the
	// `portrait`/`variants` pair because those were the only two features with an
	// `image_model_config` row, which meant an image about a place was drawn by a model
	// chosen for a face, at a portrait's aspect ratio. There is one feature here now, and
	// no radio to choose it with: the choice a GM makes on this surface is "an image of
	// this entry", and which feature that means is the product's answer, not theirs.
	const FEATURE = 'scene';

	interface Candidate {
		id: string;
		mimeType: string;
	}

	let {
		open = $bindable(false),
		universeSlug,
		entrySlug,
		assets,
		aiEnabled,
		scene,
		onInsert,
		locale
	}: {
		open?: boolean;
		universeSlug: string;
		entrySlug: string;
		assets: ExistingAsset[];
		aiEnabled: boolean;
		scene: ImageInsertContext['scene'];
		/** Called with the `/media/[id]` URL to write into the body; the dialog closes
		 * itself right after. */
		onInsert: (url: string) => void;
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));

	let base = $derived(resolve(`/w/${universeSlug}/e/${entrySlug}/media`));
	function imageUrl(id: string): string {
		return `${base}/${id}`;
	}

	let generating = $state(false);
	let inserting = $state(false);
	let error = $state<string | null>(null);
	let candidates = $state<Candidate[]>([]);
	let selectedCandidateId = $state<string | null>(null);
	// #366. Same plain-ref convention as `EntryMediaPanel.svelte`'s own upload input: it is
	// written by the DOM binding and read imperatively from the click handler, never read
	// reactively in the template.
	let uploadInput: HTMLInputElement | undefined;
	let uploading = $state(false);

	// Round thirteen R2 (#377): the vendored Dialog owns showModal/close, escape,
	// scrim-click and focus-return now, so this only has to track the closed-to-open
	// transition the way the old effect's `dialogEl.open` check did. Reset on every
	// open, not just at mount: this dialog persists across a navigation to a
	// different entry (`MarkdownEditor` stays mounted while the edit route's dynamic
	// `[slug]` changes body underneath it), so a leftover candidate or error from
	// the previous entry must not bleed into this one.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			error = null;
			candidates = [];
			selectedCandidateId = null;
		}
		wasOpen = open;
	});

	function close(): void {
		open = false;
	}

	function pickExisting(assetId: string): void {
		onInsert(imageUrl(assetId));
		close();
	}

	/** #366: the GM's own file, straight into the body. `media/upload` attaches it to this
	 * entry, so it needs no `media/attach` call the way a generated image does, and it
	 * carries no `generated` mark because no model made it. */
	async function uploadAndInsert(): Promise<void> {
		const chosen = uploadInput?.files?.[0];
		if (!chosen) return;
		error = null;
		uploading = true;
		try {
			const form = new FormData();
			form.set('file', chosen);
			const res = await fetch(`${base}/upload`, { method: 'POST', body: form });
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.upload.genericUploadFailedWithStatus(res.status));
			}
			const asset = (await res.json()) as { id: string };
			// Same as `useGenerated` below: bring the new row into `assets` for the next open,
			// then hand the URL back to the editor, which places it at the caret.
			await invalidateAll();
			onInsert(imageUrl(asset.id));
			close();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.upload.genericUploadFailed;
		} finally {
			uploading = false;
			if (uploadInput) uploadInput.value = '';
		}
	}

	async function generate(): Promise<void> {
		error = null;
		generating = true;
		try {
			const res = await fetch(`${base}/generate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ feature: FEATURE })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.inBody.generateFailedWithStatus(res.status));
			}
			const data = (await res.json()) as { assets: Candidate[] };
			candidates = data.assets;
			selectedCandidateId = data.assets[0]?.id ?? null;
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.inBody.generateFailed;
		} finally {
			generating = false;
		}
	}

	async function useGenerated(candidateId: string): Promise<void> {
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
			// Brings the freshly attached asset into `assets` for next time this dialog
			// opens, the same way `EntryMediaPanel.svelte`'s own `handleInsert` does -
			// `body`'s own state on the edit page survives this (it only seeds once, per
			// that component's `state_referenced_locally` comment).
			await invalidateAll();
			onInsert(url);
			close();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.inBody.attachFailed;
		} finally {
			inserting = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent
		closeLabel={t.entry.media.cancel}
		class="max-w-md rounded-lg border border-line bg-panel p-0 text-ink"
	>
		<div class="p-5">
			<DialogTitle class="text-base font-semibold text-ink"
				>{t.entry.media.inBody.dialogTitle}</DialogTitle
			>

			{#if error}
				<p class="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
					{error}
				</p>
			{/if}

			<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
				{t.entry.media.inBody.existingHeading}
			</h4>
			{#if assets.length === 0}
				<p class="mt-1 text-sm text-ink-2">{t.entry.media.inBody.emptyExisting}</p>
			{:else}
				<div class="mt-2 grid grid-cols-3 gap-2">
					{#each assets as asset (asset.id)}
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

			<!-- #366: above the generate block on purpose. Uploading is free, needs no model and
		     works with the AI switched off (guardrail 4), so it is not a fallback for when
		     generation is unavailable. -->
			<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
				{t.entry.media.inBody.uploadHeading}
			</h4>
			<input
				bind:this={uploadInput}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				class="hidden"
				onchange={uploadAndInsert}
			/>
			<Button
				type="button"
				size="sm"
				class="mt-2"
				disabled={uploading}
				onclick={() => uploadInput?.click()}
			>
				{uploading ? t.entry.media.upload.uploading : t.entry.media.upload.button}
			</Button>

			{#if !aiEnabled}
				<p class="mt-3 text-sm text-ink-2">{t.entry.media.aiOffBanner}</p>
			{:else}
				<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
					{t.entry.media.inBody.generateHeading}
				</h4>

				{#if candidates.length === 0}
					{#if scene.model}
						<p class="mt-2 text-sm text-ink-2">
							{t.entry.media.inBody.sceneCost(scene.price)}
						</p>
						<p class="text-xs text-muted">
							{scene.model.provider}/{scene.model.modelId}
						</p>
						<Button type="button" size="sm" class="mt-2" disabled={generating} onclick={generate}>
							{generating ? t.entry.media.generating : t.entry.media.inBody.generateButton}
						</Button>
					{:else}
						<p class="mt-2 text-sm text-ink-2">{t.entry.media.inBody.sceneNotConfigured}</p>
					{/if}
				{:else}
					<div class="mt-2 grid grid-cols-3 gap-2">
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
							onclick={() => selectedCandidateId && useGenerated(selectedCandidateId)}
						>
							{inserting ? t.entry.media.inserting : t.entry.media.inBody.useThisOne}
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onclick={() => {
								candidates = [];
								selectedCandidateId = null;
							}}
						>
							{t.entry.media.discard}
						</Button>
					</div>
				{/if}
			{/if}

			<div class="mt-4">
				<Button type="button" variant="secondary" size="sm" onclick={close}>
					{t.entry.media.cancel}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>
