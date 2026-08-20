<script lang="ts">
	/**
	 * The Images section's own content (#65, #66, #382), reduced by issue #385
	 * (decision R10) to a compact preview: a count, a few thumbnails, and a button
	 * that opens `MediaGallery.svelte` - the one surface generate, upload, cover,
	 * visibility, refine and delete all live on now. This component used to be that
	 * surface itself, in a 256px rail with its own rule set; the rail is not wide
	 * enough to hold five per-image actions legibly, so it points at the gallery
	 * instead of trying to be it.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { resolve } from '$app/paths';
	import MediaGallery, { type MediaGalleryData } from './MediaGallery.svelte';

	let {
		universeSlug,
		entitySlug,
		entityName,
		entityType,
		aiEnabled,
		hasImageStyle,
		canWrite,
		assets,
		coverAssetId,
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
		/** Issue #408, decision S3: threaded straight through into `galleryData` below -
		 * the actual generate-control gating lives in `MediaGallery.svelte` itself. */
		hasImageStyle: boolean;
		canWrite: boolean;
		assets: MediaGalleryData['assets'];
		coverAssetId: string | null;
		styleModifier: string | null;
		entityImagePromptModifier: string | null;
		portraitPrice: number;
		variantsPrice: number;
		portraitModel: MediaGalleryData['portraitModel'];
		variantsModel: MediaGalleryData['variantsModel'];
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));

	let galleryOpen = $state(false);

	let galleryData = $derived<MediaGalleryData>({
		universeSlug,
		entitySlug,
		entityName,
		entityType,
		aiEnabled,
		hasImageStyle,
		canWrite,
		assets,
		coverAssetId,
		styleModifier,
		entityImagePromptModifier,
		portraitPrice,
		variantsPrice,
		portraitModel,
		variantsModel
	});

	// A handful of thumbnails, most recent first (`assets` itself is oldest-first, the
	// gallery's own reading order) - enough to recognise at a glance that there are
	// pictures here, not a second gallery in miniature.
	const PREVIEW_COUNT = 4;
	let preview = $derived([...assets].reverse().slice(0, PREVIEW_COUNT));

	function imageUrl(id: string): string {
		return resolve(`/w/${universeSlug}/e/${entitySlug}/media/${id}`);
	}
</script>

{#if assets.length === 0}
	<EmptyState
		kind="derived"
		message={t.entry.media.empty}
		explanation={t.entry.media.explanation}
	/>
{:else}
	<div class="grid grid-cols-4 gap-1">
		{#each preview as asset (asset.id)}
			<div class="aspect-square overflow-hidden rounded-md border border-line">
				<img src={imageUrl(asset.id)} alt={entityName} class="h-full w-full object-cover" />
			</div>
		{/each}
	</div>
	<p class="mt-2 text-xs text-muted">{t.entry.media.gallery.count(assets.length)}</p>
{/if}

<Button
	type="button"
	variant="secondary"
	size="sm"
	class="mt-2"
	onclick={() => (galleryOpen = true)}
>
	{t.entry.media.gallery.openLabel}
</Button>

<MediaGallery bind:open={galleryOpen} data={galleryData} {locale} />
