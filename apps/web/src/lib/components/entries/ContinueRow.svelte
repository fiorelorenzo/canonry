<script lang="ts">
	/**
	 * O1 = C (#283), the world home's first section: "Continue as a row of cards with a cover
	 * thumbnail". The last few entries this world changed, newest first, each card a link
	 * straight into the entry.
	 *
	 * The thumbnail reads `entity.cover_asset_id` (O2, #284) and nothing else: an entry with
	 * no cover gets no picture. #486 found the cost of that: three covers on six cards put
	 * three titles under an 80px image and three flush at the top, and an entry's excerpt
	 * being present or not did the same to the line below it, so six cards landed at four
	 * different heights. Every card now reserves both slots - the thumbnail's height and the
	 * excerpt's two lines - whether or not it has content for them, so a card without a cover
	 * leaves that height blank rather than closing the gap. Blank is not a placeholder: it
	 * carries no border, no icon and no "add a cover" invitation, which is the noise O2
	 * refused and round eleven P6 (#347) deliberately kept off this row when it gave the
	 * entry page's own band a placeholder instead. The row's height is therefore the same
	 * with zero covers, three or six: adding one to a fourth entry cannot move anything else
	 * on the page. The crop position comes from `cover-crop.ts`, shared with the band on the
	 * entry page, so a portrait keeps its face at both sizes.
	 *
	 * A row that scrolls sideways rather than a grid that reflows: the section is a short
	 * list of recent work, and its length is decided by the loader (`CONTINUE_LIMIT`), not by
	 * how wide the window happens to be. At 390 that used to show two of six cards with
	 * nothing on screen implying the other four existed: the cards are narrower below `sm`
	 * so a sliver of the next one always peeks past the edge, and a line above the row states
	 * the total and that scrolling reaches the rest, in the reader's language.
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

<p class="mb-2 text-label text-muted sm:hidden">{t.continueOverflowHint(entries.length)}</p>
<ul class="flex snap-x gap-3 overflow-x-auto pb-1">
	{#each entries as entry (entry.id)}
		<li class="w-36 shrink-0 snap-start sm:w-44">
			<a
				href={resolve(`/w/${universeSlug}/e/${entry.slug}`)}
				class="flex h-full flex-col overflow-hidden rounded-lg transition-colors hover:bg-panel-2"
			>
				<div class="h-20 w-full shrink-0 overflow-hidden">
					{#if entry.coverAssetId}
						<img
							src={resolve(`/w/${universeSlug}/e/${entry.slug}/media/${entry.coverAssetId}`)}
							alt=""
							class="h-full w-full object-cover"
							style="object-position: {COVER_POSITION[entry.type]}"
						/>
					{/if}
				</div>
				<div class="flex min-w-0 flex-col gap-1.5 border-t border-line p-3">
					<span class="truncate text-sm font-semibold text-ink">{entry.name}</span>
					<Badge variant="secondary" class="self-start font-mono uppercase">
						{t.filters.typeLabel(entry.type)}
					</Badge>
					<p class="line-clamp-2 min-h-9 text-xs text-muted">{entry.excerpt}</p>
					<span class="text-label text-muted">
						{t.changedAt(relativeTime(entry.updatedAt, t.relativeTime))}
					</span>
				</div>
			</a>
		</li>
	{/each}
</ul>
