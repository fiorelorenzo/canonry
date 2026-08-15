<script lang="ts">
	import { resolve } from '$app/paths';
	import Mark from '$lib/components/brand/Mark.svelte';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale));
</script>

<svelte:head>
	<title>Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-2xl px-8 py-12">
	<h1 class="flex items-center gap-2 text-2xl font-semibold text-ink">
		<span class="text-accent"><Mark size={28} /></span>
		Canonry
	</h1>

	{#if !data.user}
		<p class="mt-2 max-w-measure text-sm text-ink-2">
			<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">{t.shell.signIn}</a>
			{t.universe.list.signInPrompt}
		</p>
	{:else if data.universes.length === 0}
		<p class="mt-2 max-w-measure text-sm text-ink-2">
			{t.universe.list.empty}
		</p>
	{:else}
		<ul class="mt-8 flex flex-col gap-3">
			{#each data.universes as universe (universe.id)}
				<li>
					<a
						href={resolve(`/u/${universe.slug}`)}
						class="block rounded-lg border border-line bg-panel px-4 py-3 hover:border-accent"
					>
						<div class="flex items-center gap-2">
							<span class="font-semibold text-ink">{universe.name}</span>
							<span
								class="rounded-full border border-line-2 px-2 py-0.5 text-xs tracking-wide text-muted uppercase"
							>
								{universe.kind}
							</span>
						</div>
						<p class="mt-1 text-sm text-ink-2">
							{#if universe.baseUniverseName}
								{t.universe.switcher.derivedFrom(universe.baseUniverseName)} &middot;
							{/if}
							{t.universe.switcher.entryCount(universe.entityCount)}
						</p>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<a
		href={resolve('/settings/appearance')}
		class="mt-10 inline-block text-sm text-accent hover:underline"
	>
		{t.universe.list.appearanceSettingsLink}
	</a>
</main>
