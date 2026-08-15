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
	import GapNotice from '$lib/components/players/GapNotice.svelte';
	import PublicFactsList from '$lib/components/players/PublicFactsList.svelte';
	import PublicRelationsList from '$lib/components/players/PublicRelationsList.svelte';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale));
</script>

<svelte:head><title>{data.entity.name} &middot; {data.universe.name}</title></svelte:head>

<p class="mb-3 text-xs text-muted">
	<a class="hover:underline" href={resolve(`/p/${data.universe.slug}`)}>{data.universe.name}</a>
	<span aria-hidden="true">/</span>
	{data.entity.type} <span aria-hidden="true">/</span>
	<span class="text-ink-2">{data.entity.name}</span>
</p>

<div class="mb-6">
	<h1 class="mb-1 text-3xl font-semibold text-ink">{data.entity.name}</h1>
	<p class="flex flex-wrap items-center gap-2 text-sm text-muted">
		<span class="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-xs text-accent-ink">
			{data.entity.type}
		</span>
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
		/>
		<PublicFactsList facts={data.entity.facts} locale={data.locale} />
		<PublicRelationsList
			relations={data.entity.relations}
			universeSlug={data.universe.slug}
			locale={data.locale}
		/>
	</article>
{/if}
