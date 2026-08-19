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
	}
</script>

<script lang="ts">
	/**
	 * Issue #253: the toolbar's "Image" button opens this. Two ways to leave it with a
	 * URL to hand back to `insertImage`: click one of the entry's existing images
	 * (`assets`, already attached - see `mediaAssetsForEntity`), or generate a fresh one
	 * on the spot through the same `media/generate` endpoint the Images tab uses and
	 * attach it (`media/attach`) before handing it back, so a generated-from-here image
	 * is not an orphan invisible to the Images tab. Generation and attach stay two calls,
	 * same as `EntryMediaPanel.svelte`'s own two-step shape (#71) - this dialog does not
	 * reinvent that.
	 *
	 * No price or model display here (unlike `GenerateDialog.svelte`): the Images tab
	 * already shows cost and lets a GM choose there before spending; duplicating that
	 * here would just be the same two numbers rendered a second time.
	 */
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';

	// Deliberately narrower than `@canonry/db/schema`'s `ImageFeature`: `scene` has no
	// `image_model_config` row yet (issue #258 owns seeding it), so it is never offered
	// here, same restriction `media/generate/+server.ts`'s own `isImageFeature` guard
	// enforces server-side.
	type InsertableFeature = 'portrait' | 'variants';

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
		onInsert,
		locale
	}: {
		open?: boolean;
		universeSlug: string;
		entrySlug: string;
		assets: ExistingAsset[];
		aiEnabled: boolean;
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

	let dialogEl: HTMLDialogElement | undefined;
	let feature = $state<InsertableFeature>('portrait');
	let generating = $state(false);
	let inserting = $state(false);
	let error = $state<string | null>(null);
	let candidates = $state<Candidate[]>([]);
	let selectedCandidateId = $state<string | null>(null);

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			dialogEl.showModal();
			// Reset on every open, not just at mount: this dialog persists across a
			// navigation to a different entry (`MarkdownEditor` stays mounted while the
			// edit route's dynamic `[slug]` changes body underneath it), so a leftover
			// candidate or error from the previous entry must not bleed into this one.
			error = null;
			candidates = [];
			selectedCandidateId = null;
		}
		if (!open && dialogEl.open) dialogEl.close();
	});

	function close(): void {
		open = false;
	}

	function pickExisting(assetId: string): void {
		onInsert(imageUrl(assetId));
		close();
	}

	async function generate(): Promise<void> {
		error = null;
		generating = true;
		try {
			const res = await fetch(`${base}/generate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ feature })
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

<dialog
	bind:this={dialogEl}
	onclose={close}
	onclick={(e) => {
		if (e.target === dialogEl) close();
	}}
	class="max-w-md rounded-lg border border-line bg-panel p-0 text-ink backdrop:bg-ink/40"
>
	<div class="p-5">
		<h3 class="text-base font-semibold text-ink">{t.entry.media.inBody.dialogTitle}</h3>

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

		{#if !aiEnabled}
			<p class="mt-3 text-sm text-ink-2">{t.entry.media.aiOffBanner}</p>
		{:else}
			<h4 class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
				{t.entry.media.inBody.generateHeading}
			</h4>

			{#if candidates.length === 0}
				<div
					class="mt-2 flex items-center gap-3"
					role="radiogroup"
					aria-label={t.entry.media.inBody.featureAriaLabel}
				>
					<label class="flex items-center gap-1.5 text-sm text-ink-2">
						<input type="radio" name="in-body-feature" value="portrait" bind:group={feature} />
						{t.entry.media.inBody.portraitOption}
					</label>
					<label class="flex items-center gap-1.5 text-sm text-ink-2">
						<input type="radio" name="in-body-feature" value="variants" bind:group={feature} />
						{t.entry.media.inBody.variantsOption}
					</label>
				</div>
				<Button type="button" size="sm" class="mt-2" disabled={generating} onclick={generate}>
					{generating ? t.entry.media.generating : t.entry.media.inBody.generateButton}
				</Button>
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
</dialog>
