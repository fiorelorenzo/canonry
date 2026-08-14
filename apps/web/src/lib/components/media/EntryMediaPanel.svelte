<script lang="ts">
	/**
	 * The Images tab's real content (#65, #66, #71 - the handoff issue #66's own docstring
	 * in the old entry/ImagesPanel.svelte pointed at, now replaced by this component).
	 *
	 * Two steps, always: generate produces one image or four to choose from, all
	 * unattached; insert is a separate click that attaches the picked one to this entry.
	 * Guardrail 6 (#71): nothing here, or anywhere behind it, ever sets
	 * published_to_players - every image shown here carries a permanent "Private" note,
	 * not because a flag says so on this specific asset, but because there is no code
	 * path that could have made it otherwise.
	 */
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
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
		variantsModel
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
	} = $props();

	let base = $derived(resolve(`/u/${universeSlug}/e/${entitySlug}/media`));

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

	async function handleGenerate(feature: ImageFeature): Promise<void> {
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
				throw new Error(text || `Generation failed (${res.status})`);
			}
			const data = (await res.json()) as {
				reusedFromCache: boolean;
				assets: Candidate[];
			};
			candidates = data.assets;
			reusedFromCache = data.reusedFromCache;
			selectedCandidateId = data.assets[0]?.id ?? null;
			dialogOpen = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Generation failed';
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
				throw new Error(text || `Insert failed (${res.status})`);
			}
			// `assets` is derived from the `assets` prop (see its declaration above), so
			// there is nothing to push locally here - awaiting `invalidateAll()` below is
			// what brings the newly attached image into view, with the real row the server
			// just wrote (real credits, real createdAt) rather than a guessed one.
			candidates = [];
			selectedCandidateId = null;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Insert failed';
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
			if (!res.ok) throw new Error(`Saving the style override failed (${res.status})`);
			styleEditorOpen = false;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Saving the style override failed';
		} finally {
			savingStyle = false;
		}
	}
</script>

{#if !aiEnabled}
	<p class="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink-2">
		Generation is switched off for this universe. Existing images below still show, but nothing new
		can be generated until it is turned back on.
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
			{reusedFromCache ? 'Reused from the similarity cache - not charged.' : 'Generated:'}
			{candidates.length > 1 ? 'pick one to insert.' : ''}
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
			<button
				type="button"
				class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:opacity-50"
				disabled={!selectedCandidateId || inserting}
				onclick={handleInsert}
			>
				{inserting ? 'Inserting…' : 'Insert'}
			</button>
			<button
				type="button"
				class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				onclick={discardCandidates}
			>
				Discard
			</button>
		</div>
	</div>
{/if}

{#if assets.length === 0 && candidates.length === 0}
	<p class="text-sm text-muted">No images yet.</p>
{:else if assets.length > 0}
	<div class="mt-2 grid grid-cols-2 gap-2">
		{#each assets as asset (asset.id)}
			<div class="relative overflow-hidden rounded-md border border-line">
				<img src={imageUrl(asset.id)} alt={entityName} class="block h-auto w-full" />
				{#if asset.generated}
					<span
						class="absolute top-1 left-1 rounded-full border border-ai-line bg-ai-bg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ai uppercase"
					>
						Generated
					</span>
				{/if}
			</div>
		{/each}
	</div>
	<p class="mt-1 text-xs text-muted">Private - not shown to players until you reveal this entry.</p>
{/if}

{#if canWrite}
	<button
		type="button"
		class="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:opacity-50"
		disabled={!aiEnabled}
		onclick={() => (dialogOpen = true)}
	>
		Generate image
	</button>

	{#if styleEditorOpen}
		<div class="mt-3 rounded-md border border-line bg-panel-2 p-3">
			<label class="block text-xs font-medium text-ink-2" for="style-override">
				Style override for this entry (leave blank to use the universe style)
			</label>
			<textarea
				id="style-override"
				bind:value={styleDraft}
				rows="2"
				class="mt-1 w-full rounded-md border border-line-2 bg-panel px-2 py-1 text-sm text-ink"
			></textarea>
			<div class="mt-2 flex gap-2">
				<button
					type="button"
					class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-panel hover:bg-accent-ink disabled:opacity-50"
					disabled={savingStyle}
					onclick={saveStyle}
				>
					Save
				</button>
				<button
					type="button"
					class="rounded-md border border-line-2 px-2.5 py-1 text-xs text-ink-2 hover:bg-panel-2"
					onclick={() => (styleEditorOpen = false)}
				>
					Cancel
				</button>
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
		onGenerate={handleGenerate}
		onEditStyle={() => {
			styleDraft = entityImagePromptModifier ?? '';
			styleEditorOpen = true;
		}}
	/>
{/if}
