<script lang="ts">
	/**
	 * Issue #127: two independent languages meet on this page, and they must never touch
	 * each other. `t` (chrome - breadcrumb glue, the revealed/not-yet-discovered badge) is
	 * the visitor's negotiated `data.locale`, resolved from `Accept-Language` alone for
	 * every path under `/p/` (see the layout's own doc comment). `data.entity.language`,
	 * carried on the `<article>` below as a plain `lang` attribute, is the entry's *own*
	 * language instead - detected fresh from the exact player-visible body
	 * (`$lib/server/players.ts`'s `loadPublicEntity`, never from the `entity.language`
	 * column, which may reflect a secret fence a player never sees) - and it is `null`,
	 * meaning no attribute at all, whenever that detector is not confident, exactly the
	 * same conservative call the GM-facing detector makes at save time (`@canonry/lang`).
	 * A `gap` entity carries no `language` at all: nothing about undiscovered content,
	 * including what language it might be in, is ever exposed (guardrail 6).
	 */
	import { resolve } from '$app/paths';
	import EntryProse from '$lib/components/entry/EntryProse.svelte';
	import EntryCover from '$lib/components/media/EntryCover.svelte';
	import GapNotice from '$lib/components/players/GapNotice.svelte';
	import PublicFactsList from '$lib/components/players/PublicFactsList.svelte';
	import PublicImages from '$lib/components/players/PublicImages.svelte';
	import PublicRelationsList from '$lib/components/players/PublicRelationsList.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale));

	// O2 (#284): guardrail 6 has no exception for images, and none is made here.
	// `coverImageId` is already the entity's cover narrowed to the published pictures this
	// page may show (`publicEntityBySlug`), so a cover the GM set but never published is
	// null and this page draws no band at all - the same nothing an entry with no cover
	// draws. A `gap` entity carries no images at all, so nothing about an undiscovered
	// entry leaks through a picture either.
	let coverImageId = $derived(data.entity.status === 'full' ? data.entity.coverImageId : null);
	let coverUrl = $derived(
		coverImageId ? resolve(`/p/${data.universe.slug}/media/${coverImageId}`) : null
	);

	// The cover is one of `images`, so without this it would be drawn twice on one page:
	// once as the band and again in the gallery below. On the GM's own page it does appear
	// in both, because there the grid is where a cover is chosen and it carries a "cover"
	// badge saying which one is which; here the gallery is only a gallery, and the same
	// picture twice with nothing explaining why reads as a bug. Filtered here rather than
	// inside `PublicImages`, which deliberately holds no logic of its own about what it is
	// shown.
	let galleryImages = $derived(
		data.entity.status === 'full'
			? data.entity.images.filter((image) => image.id !== coverImageId)
			: []
	);
</script>

<svelte:head><title>{data.entity.name} &middot; {data.universe.name}</title></svelte:head>

<p class="mb-3 text-xs text-muted">
	<a class="hover:underline" href={resolve(`/p/${data.universe.slug}`)}>{data.universe.name}</a>
	<span aria-hidden="true">/</span>
	{data.entity.type} <span aria-hidden="true">/</span>
	<span class="text-ink-2">{data.entity.name}</span>
</p>

{#if coverUrl}
	<EntryCover src={coverUrl} alt={data.entity.name} entityType={data.entity.type} />
{/if}

<div class="mb-6">
	<h1 class="mb-1 text-3xl font-semibold text-ink">{data.entity.name}</h1>
	<p class="flex flex-wrap items-center gap-2 text-sm text-muted">
		<Badge variant="accent" class="font-mono">{data.entity.type}</Badge>
		{#if data.entity.status === 'full'}
			<span>
				{t.players.revealed}{data.entity.revealedInSession
					? ` \u00b7 ${data.entity.revealedInSession}`
					: ''}
			</span>
		{:else}
			<span>{t.players.notDiscovered}</span>
		{/if}
	</p>
</div>

{#if data.entity.status === 'gap'}
	<GapNotice name={data.entity.name} type={data.entity.type} locale={data.locale} />
{:else}
	<article lang={data.entity.language ?? undefined}>
		<EntryProse
			body={data.entity.body}
			universeSlug={data.universe.slug}
			mentionTargets={data.mentionTargets}
			surface="public"
		/>
		<PublicFactsList facts={data.entity.facts} locale={data.locale} />
		<PublicRelationsList
			relations={data.entity.relations}
			universeSlug={data.universe.slug}
			locale={data.locale}
		/>
		<PublicImages
			images={galleryImages}
			universeSlug={data.universe.slug}
			entityName={data.entity.name}
			locale={data.locale}
		/>
	</article>
{/if}
