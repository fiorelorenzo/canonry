<script lang="ts">
	/**
	 * #530, decision "W2 = A the campaign diary" (round eighteen): the players' wiki index
	 * is the sessions the party has met, newest first, each carrying the GM's own prose and
	 * what the table learned that night - not an alphabetical name list (V7, round
	 * seventeen, superseded here as the whole surface's shape). `data.sessions` is already
	 * `loadPlayerDiary`'s player-safe shape: guardrail 6 decided *which* sessions and *which*
	 * revelations inside them appear before this template ever runs, same as every other
	 * `/p/**` page in this directory.
	 *
	 * A session's own body is canon prose (guardrail 6's own note for this round): it goes
	 * through `EntryProse` exactly like an entry's, `:::secret`/`:::gmnote` already stripped
	 * by the server load, no second filter drawn here. E7's rule still governs an
	 * unrevealed session - it simply is not in `data.sessions` at all - and a revelation
	 * naming an entry the party has not read yet links straight to that entry's own gap
	 * page (E7), the same link `PublicRelationsList` already draws.
	 *
	 * Issue #127: `t` is chrome, in the visitor's negotiated `data.locale`. Every session
	 * `name`, every revealed entry `name`/`label`, and the session's own prose are canon -
	 * never touched by it (SPEC.md §17's third rule).
	 */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import EntryProse from '$lib/components/entry/EntryProse.svelte';
	import EntryCover from '$lib/components/media/EntryCover.svelte';
	import { InlineLink } from '$lib/components/ui/link';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale));

	function formatWhen(value: Date | string): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'long' }).format(date);
	}
</script>

<svelte:head><title>{t.players.indexTitle} &middot; {data.universe.name}</title></svelte:head>

<PageHeader title={t.players.indexTitle} description={t.players.indexSubtitle} />
<PageBody width="reading">
	{#if data.sessions.length === 0}
		<EmptyState kind="cold" message={t.players.emptyState} />
	{:else}
		<ul class="flex flex-col divide-y divide-line">
			{#each data.sessions as session (session.id)}
				<li class="py-8 first:pt-0">
					<p class="text-meta text-muted">{formatWhen(session.revealedAt)}</p>
					<h2 class="mt-1 text-title font-semibold text-ink">{session.name}</h2>

					{#if session.coverImageId}
						<div class="mt-3">
							<EntryCover
								src={resolve(`/p/${data.universe.slug}/media/${session.coverImageId}`)}
								alt={session.name}
								entityType="session"
							/>
						</div>
					{/if}

					<article lang={session.language ?? undefined} class="mt-3">
						<EntryProse
							body={session.body}
							universeSlug={data.universe.slug}
							mentionTargets={data.mentionTargets}
							surface="public"
							locale={data.locale}
						/>
					</article>

					<section class="mt-4">
						<h3 class="text-label font-semibold tracking-wide text-muted uppercase">
							{t.players.learnedHeading}
						</h3>
						{#if session.revelations.length === 0}
							<EmptyState kind="settled" message={t.players.learnedEmpty} />
						{:else}
							<ul class="mt-2 flex flex-col gap-2">
								{#each session.revelations as rev (rev.id)}
									<li class="text-body text-ink-2">
										{#if rev.kind === 'relation'}
											<InlineLink href={resolve(`/p/${data.universe.slug}/${rev.from.slug}`)}
												>{rev.from.name}</InlineLink
											>
											{#if rev.from.status === 'gap'}
												<span class="text-meta text-muted">({t.players.notDiscovered})</span>
											{/if}
											{rev.relationLabel}
											<InlineLink href={resolve(`/p/${data.universe.slug}/${rev.to.slug}`)}
												>{rev.to.name}</InlineLink
											>
											{#if rev.to.status === 'gap'}
												<span class="text-meta text-muted">({t.players.notDiscovered})</span>
											{/if}
										{:else}
											<InlineLink href={resolve(`/p/${data.universe.slug}/${rev.entity.slug}`)}
												>{rev.label}</InlineLink
											>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				</li>
			{/each}
		</ul>
	{/if}
</PageBody>
