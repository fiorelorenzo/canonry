<script lang="ts">
	/**
	 * Issue R11, round thirteen, reshaped by issue #530 (round eighteen, W2 = A): the GM's
	 * side of the players' wiki now reads by session, newest first, matching the shape the
	 * public wiki itself reads in (the campaign diary, W2). `data.log` is already grouped
	 * server-side (`+page.server.ts`'s `groupBySession`) - this component only renders the
	 * groups, newest session first, each session's own rows newest first inside it. No
	 * write action lives here - a reveal happens in Table mode (E5 = C), and an invitation
	 * does not exist anywhere in the product yet, so `invitationsNotice` says that in one
	 * sentence rather than the page growing a button that writes nothing.
	 *
	 * Issue #492: every name in the log is a link now. An entity row's whole label already
	 * is the entry's own name; a fact row's label is the statement `fact.entity_id` was
	 * extracted from (SPEC.md §4.2), so the whole statement links to that same entry
	 * rather than a guess at which words inside it are the name. A relation row names two
	 * entries ("Aldric Vane member of The Valdoria Watch"), so both link independently -
	 * the row does not pick a side. `nameLink` below is the one place that renders an
	 * entry name: the GM link plus, only where `revealed` says the party can see this
	 * specific entity too, a second small link to the player's own view of it - "what does
	 * the player see" being the question this page exists to answer (R11's own doc
	 * comment on `+page.server.ts`). Both links carry `data-entry-slug` (#442, T2), so
	 * `MentionPreview` below previews either one for free.
	 *
	 * Issue #530's second half: "still behind the screen" (`data.hidden`) is now ordered
	 * connected-first (`+page.server.ts`'s `connected` flag, from `pinnedNeighbors`), and
	 * says so with a small badge - reordering an alphabetical-looking list with no visible
	 * reason would read as broken, not curated.
	 */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { Button } from '$lib/components/ui/button';
	import { Page } from '$lib/components/ui/page';
	import WikiAddressRow from '$lib/components/players/WikiAddressRow.svelte';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import MentionPreview from '$lib/components/entry/MentionPreview.svelte';
	import { InlineLink } from '$lib/components/ui/link';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).universe.players);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}

	// The session heading needs only a date, not a time - the time each row carries below
	// it is what actually varies within one night at the table.
	function formatSessionDate(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium' }).format(date);
	}

	// Mention preview delegates off this element (#429/#442), one instance for the whole
	// revealed list rather than one per row.
	let revealedContainer = $state<HTMLElement | null>(null);
</script>

<svelte:head>
	<title>{t.headTitle(data.universe.name)}</title>
</svelte:head>

<Page width="working" eyebrow={data.universe.name} title={t.heading} description={t.description}>
	<div class="flex flex-col gap-8 px-6 py-8">
		<WikiAddressRow universeSlug={data.universe.slug} locale={data.locale} />

		<div bind:this={revealedContainer} class="relative">
			<h2 class="mb-3 text-label font-semibold tracking-wide text-muted uppercase">
				{t.revealedHeading}
			</h2>

			{#snippet nameLink(ref: { slug: string; name: string; revealed: boolean }, text: string)}
				<InlineLink
					href={resolve(`/w/${data.universe.slug}/e/${ref.slug}`)}
					data-entry-slug={ref.slug}>{text}</InlineLink
				>{#if ref.revealed}<Button
						href={resolve(`/p/${data.universe.slug}/${ref.slug}`)}
						data-entry-slug={ref.slug}
						target="_blank"
						rel="noopener"
						variant="ghost"
						size="icon"
						class="ml-0.5 size-5 shrink-0 align-middle text-ink-2 hover:text-ink"
						aria-label={t.openInWiki(ref.name)}
						><ExternalLinkIcon aria-hidden="true" class="size-3" /></Button
					>{/if}
			{/snippet}

			{#if data.log.length === 0}
				<EmptyState kind="cold" message={t.revealedEmpty}>
					{#snippet action()}
						<Button href={resolve(`/w/${data.universe.slug}/table`)}>{t.revealedEmptyAction}</Button
						>
					{/snippet}
				</EmptyState>
			{:else}
				<div class="flex flex-col gap-6">
					{#each data.log as group (group.key)}
						<section aria-labelledby="session-{group.key || 'untracked'}">
							<h3
								id="session-{group.key || 'untracked'}"
								class="mb-2 flex items-baseline justify-between gap-3 border-b border-line pb-1 text-title font-semibold text-ink"
							>
								<span>{group.sessionName ?? t.sessionUnknown}</span>
								<span class="text-meta font-normal text-muted"
									>{formatSessionDate(group.latestAt)}</span
								>
							</h3>
							<ul class="flex flex-col gap-2.5">
								{#each group.items as entry (entry.id)}
									<li class="flex flex-col gap-0.5 text-body">
										<span class="text-ink">
											{#if entry.kind === 'relation'}
												{@render nameLink(entry.from, entry.from.name)}
												{entry.relationLabel}
												{@render nameLink(entry.to, entry.to.name)}
											{:else}
												{@render nameLink(entry.entity, entry.label)}
											{/if}
										</span>
										<span class="text-meta text-muted">
											{t.kindLabel[entry.kind]} &middot; {formatWhen(entry.confirmedAt)}
										</span>
									</li>
								{/each}
							</ul>
						</section>
					{/each}
				</div>
				<MentionPreview
					container={revealedContainer}
					universeSlug={data.universe.slug}
					surface="gm"
					locale={data.locale}
				/>
			{/if}
		</div>

		<div>
			<h2 class="mb-1 text-label font-semibold tracking-wide text-muted uppercase">
				{t.hiddenHeading}
			</h2>
			<p class="mb-3 text-body text-muted">{t.hiddenDescription}</p>

			{#if data.hidden.length === 0}
				<EmptyState kind="settled" message={t.hiddenEmpty} />
			{:else}
				<ul class="flex flex-col divide-y divide-line">
					{#each data.hidden as entity (entity.id)}
						<li>
							<a
								href={resolve(`/w/${data.universe.slug}/e/${entity.slug}`)}
								class="flex items-center justify-between gap-3 py-2 text-body text-ink-2 transition-colors hover:text-ink"
							>
								<span class="flex items-center gap-2">
									{#if entity.connected}
										<span
											class="rounded-full bg-accent-bg px-2 py-0.5 text-label text-accent-ink"
											title={t.hiddenConnectedHint}
										>
											{t.hiddenConnectedBadge}
										</span>
									{/if}
									<span>{entity.name}</span>
								</span>
								<span class="text-label tracking-wide text-muted uppercase"
									>{t.entityTypeLabel(entity.type)}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</Page>
