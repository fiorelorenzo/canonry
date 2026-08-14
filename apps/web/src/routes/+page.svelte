<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-2xl px-8 py-12">
	<h1 class="text-2xl font-semibold text-ink">Canonry</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		Every universe on this server, not just yours: sign-in is not built yet (#86), so there is no
		owner check here.
	</p>

	{#if data.universes.length === 0}
		<p class="mt-8 text-sm text-ink-2">No universes yet.</p>
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
								Derived from {universe.baseUniverseName} &middot;
							{/if}
							{universe.entityCount}
							{universe.entityCount === 1 ? 'entry' : 'entries'}
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
		Appearance settings
	</a>
</main>
