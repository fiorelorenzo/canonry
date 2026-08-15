<script lang="ts">
	/** Standalone universe creation - see +page.server.ts's doc comment. */
	import { messages } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const t = $derived(messages(data.locale).universe.new);
</script>

<svelte:head>
	<title>{t.headTitle} &middot; Canonry</title>
</svelte:head>

<main id="main" class="mx-auto flex max-w-measure flex-col gap-6 px-8 py-16">
	<h1 class="text-2xl font-semibold text-ink">{t.heading}</h1>

	{#if form?.error}
		<p class="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.error}</p>
	{/if}

	<form method="POST" class="flex flex-col gap-3">
		<label for="name" class="text-sm font-medium text-ink">{t.nameLabel}</label>
		<input
			id="name"
			name="name"
			type="text"
			value={form?.name ?? ''}
			required
			class="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
		/>
		<button
			type="submit"
			class="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
		>
			{t.create}
		</button>
	</form>
</main>
