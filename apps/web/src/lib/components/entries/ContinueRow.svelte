<script lang="ts">
	/**
	 * O1 = C (#283), the world home's first section: "Continue as a row of cards with a cover
	 * thumbnail". The last few entries this world changed, newest first, each card a link
	 * straight into the entry.
	 *
	 * The thumbnail reads `entity.cover_asset_id` (O2, #284) and nothing else: an entry with
	 * no cover gets no picture and no dashed placeholder here, so a world with covers on two
	 * of six entries shows two pictures rather than four invitations. Round eleven P6 (#347)
	 * reversed that for the entry page's own band, and deliberately not for these cards: one
	 * empty slot where a writer is reading one entry is an affordance, six of them down a row
	 * of recent work is the noise O2 refused. The crop position comes from `cover-crop.ts`,
	 * shared with the band on the entry page, so a portrait keeps its face at both sizes.
	 *
	 * A row that scrolls sideways rather than a grid that reflows: the section is a short
	 * list of recent work, and its length is decided by the loader (`CONTINUE_LIMIT`), not by
	 * how wide the window happens to be.
	 */
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { COVER_POSITION } from '$lib/components/media/cover-crop';
	import type { EntityType } from '@canonry/db/schema';
	import type { Messages } from '$lib/i18n';
	import { relativeTime } from './relative-time';

	interface ContinueEntry {
		id: string;
		name: string;
		type: EntityType;
		slug: string;
		excerpt: string;
		updatedAt: Date;
		coverAssetId: string | null;
	}

	let {
		universeSlug,
		entries,
		t
	}: {
		universeSlug: string;
		entries: ContinueEntry[];
		t: Messages['universe']['index'];
	} = $props();
</script>

<ul class="flex snap-x gap-3 overflow-x-auto pb-1">
	{#each entries as entry (entry.id)}
		<li class="w-44 shrink-0 snap-start">
			<a
				href={resolve(`/w/${universeSlug}/e/${entry.slug}`)}
				class="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-panel transition-colors hover:border-line-2"
			>
				{#if entry.coverAssetId}
					<img
						src={resolve(`/w/${universeSlug}/e/${entry.slug}/media/${entry.coverAssetId}`)}
						alt=""
						class="h-20 w-full object-cover"
						style="object-position: {COVER_POSITION[entry.type]}"
					/>
				{/if}
				<div class="flex min-w-0 flex-col gap-1.5 p-3">
					<span class="truncate text-sm font-semibold text-ink">{entry.name}</span>
					<Badge variant="secondary" class="self-start font-mono uppercase">
						{t.filters.typeLabel(entry.type)}
					</Badge>
					{#if entry.excerpt}
						<p class="line-clamp-2 text-xs text-muted">{entry.excerpt}</p>
					{/if}
					<span class="text-[11px] text-muted">
						{t.changedAt(relativeTime(entry.updatedAt, t.relativeTime))}
					</span>
				</div>
			</a>
		</li>
	{/each}
</ul>
