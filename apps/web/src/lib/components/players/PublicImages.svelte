<!--
	#254: the published-image gallery on a revealed entity's page. Only ever fed
	`PublicImageRow[]` from `publicEntityBySlug`'s own `images` field - already filtered
	to published, gm_only-excluded, revelation-confirmed images, so this component carries
	no visibility logic of its own and cannot second-guess it. `kind === 'image'` is the
	only local filter: an audio media asset (media_kind's other value) has no business
	inside an `<img>` tag, and nothing publishes ambient layers to players yet.

	Bytes come from `/p/[universe]/media/[id]`, the public sibling of the GM's own
	`/w/[universe]/e/[slug]/media/[id]` route, gated by `publicMediaAssetById`'s double
	check rather than anything this component decides.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PublicImageRow } from '@canonry/db';
	import { messages, type Locale } from '$lib/i18n';

	let {
		images,
		universeSlug,
		entityName,
		locale
	}: { images: PublicImageRow[]; universeSlug: string; entityName: string; locale: Locale } =
		$props();
	let t = $derived(messages(locale));
	let photos = $derived(images.filter((image) => image.kind === 'image'));
</script>

{#if photos.length > 0}
	<section class="mt-8">
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
			{t.players.media.heading}
		</h2>
		<div class="mt-2 grid grid-cols-2 gap-2">
			{#each photos as image (image.id)}
				<div class="overflow-hidden rounded-md border border-line">
					<img
						src={resolve(`/p/${universeSlug}/media/${image.id}`)}
						alt={entityName}
						class="block h-auto w-full"
					/>
				</div>
			{/each}
		</div>
	</section>
{/if}
