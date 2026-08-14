<script lang="ts">
	/**
	 * D7 = A's screen 1+2 combined (signup already happened at /auth/sign-up): name the
	 * universe, then pick import (the default, continues at /onboarding/import) or the
	 * pre-indexed fallback for a GM with nothing to import yet. One field, two submit
	 * buttons routing to different form actions via `formaction`.
	 */
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(form?.name ?? '');
</script>

<svelte:head>
	<title>New universe &middot; Canonry</title>
</svelte:head>

<main id="main" class="mx-auto flex max-w-measure flex-col gap-6 px-8 py-16">
	<h1 class="text-2xl font-semibold text-ink">Name your universe</h1>
	<p class="text-sm text-ink-2">
		Everything in Canonry lives inside one. You can add more later from any universe's switcher.
	</p>

	{#if form?.error}
		<p class="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.error}</p>
	{/if}

	<form method="POST" class="flex flex-col gap-4">
		<div class="flex flex-col gap-1">
			<label for="name" class="text-sm font-medium text-ink">Universe name</label>
			<input
				id="name"
				name="name"
				type="text"
				bind:value={name}
				placeholder="Valdoria Reach"
				required
				class="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
			/>
		</div>

		<div class="mt-2 flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
			<p class="text-sm font-medium text-ink">Have notes, a wiki export, or a PDF already?</p>
			<p class="text-sm text-ink-2">
				Import it. You will confirm what Canonry detected before anything runs, see what it costs,
				and start reviewing proposals within a minute or two.
			</p>
			<button
				type="submit"
				formaction="?/import"
				class="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
			>
				Import my world
			</button>
		</div>

		<div class="flex flex-col gap-3 rounded-lg border border-line bg-panel-2 p-4">
			<p class="text-sm font-medium text-ink">Nothing to import yet?</p>
			{#if data.preIndexedBase}
				<p class="text-sm text-ink-2">
					Start from <strong>{data.preIndexedBase.name}</strong>, a pre-indexed universe. Your canon
					always wins over it, and you can diverge from it entry by entry.
				</p>
				<button
					type="submit"
					formaction="?/preindexed"
					class="self-start rounded-md border border-line-2 bg-panel px-4 py-2 text-sm font-medium text-ink hover:border-accent"
				>
					Start from {data.preIndexedBase.name}
				</button>
			{:else}
				<p class="text-sm text-muted">
					No pre-indexed universe is configured on this deployment yet.
				</p>
			{/if}
		</div>
	</form>
</main>
