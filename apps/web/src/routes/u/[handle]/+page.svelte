<script lang="ts">
	/**
	 * Issue #158: the profile. Three things, which is the whole decision recorded on that
	 * issue - the display name, the handle, and the worlds their owner has published. No
	 * avatar, because this product has none anywhere and inventing one here would be a new
	 * surface inside a new surface.
	 *
	 * Guardrail 6 was decided before this template ran: `publicProfileByHandle` lists a world
	 * because a stranger can read something on it, never because somebody owns it, and every
	 * world link goes to `/p/<slug>`, the players' wiki, never to `/w/<slug>`, which is the
	 * GM's own side of the same world. There is no filtering left to do here and none is done
	 * here, which is what `../leak.test.ts` checks against the payload rather than the pixels.
	 *
	 * The empty state is the one that matters, because at launch most profiles will be it: a
	 * heading over nothing is what got this issue deferred in August. It uses `derived` rather
	 * than `cold` deliberately - the reason it is empty is structural (a world becomes public
	 * only when its entries are revealed at the table, SPEC.md §10 and decision E5) rather
	 * than a matter of somebody not getting round to it, and `derived` is the variant that
	 * carries that second sentence.
	 */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale).profile);

	function formatWhen(value: Date | string): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'long' }).format(date);
	}
</script>

<svelte:head><title>{data.profile.name}: Canonry</title></svelte:head>

<PageHeader eyebrow={t.eyebrow} title={data.profile.name}>
	{#snippet titleAdornment()}
		<span class="font-mono text-meta text-muted">/u/{data.profile.handle}</span>
	{/snippet}
</PageHeader>
<PageBody width="reading">
	{#if data.profile.worlds.length === 0}
		<EmptyState kind="derived" message={t.emptyMessage} explanation={t.emptyExplanation} />
	{:else}
		<h2 class="text-label font-semibold tracking-wide text-muted uppercase">
			{t.worldsHeading}
		</h2>
		<ul class="mt-2 flex flex-col divide-y divide-line">
			{#each data.profile.worlds as world (world.slug)}
				<li class="py-6 first:pt-2">
					<h3 class="text-title font-semibold text-ink">
						<a href={resolve(`/p/${world.slug}`)} class="hover:text-accent">{world.name}</a>
					</h3>
					<p class="mt-1 text-meta text-muted">
						{t.worldMeta(world.readableEntries, formatWhen(world.lastPublishedAt))}
					</p>
				</li>
			{/each}
		</ul>
	{/if}
</PageBody>
