<script lang="ts">
	/**
	 * Issue #20's index, decision B5 = A. A short list of works, each one a door into its
	 * own tree-plus-editor page; the create form only asks for what the schema requires
	 * to start (`name`, `type`) since a summary, a status and the first act all belong to
	 * the work's own page, not to a wizard here.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let t = $derived(messages(data.locale));
</script>

<svelte:head><title>{t.works.index.title}: {data.current.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-8 py-10">
	<h1 class="text-2xl font-semibold text-ink">{t.works.index.title}</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		{t.works.index.description}
	</p>

	{#if data.works.length === 0}
		<p class="mt-6 text-sm text-muted">{t.works.index.empty}</p>
	{:else}
		<ul class="mt-6 flex flex-col divide-y divide-line">
			{#each data.works as work (work.id)}
				<li class="py-3">
					<a
						href={resolve(`/u/${data.current.slug}/works/${work.slug}`)}
						class="text-base font-medium text-ink hover:text-accent"
					>
						{work.name}
					</a>
					<span class="ml-2 text-xs tracking-wide text-muted uppercase">
						{t.works.types[work.type] ?? work.type} · {t.works.statuses[work.status] ?? work.status}
					</span>
					{#if work.summary}
						<p class="mt-1 max-w-measure text-sm text-ink-2">{work.summary}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<form
		method="POST"
		action="?/create"
		class="mt-8 flex max-w-sm flex-col gap-3 border-t border-line pt-6"
	>
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
			{t.works.index.createHeading}
		</h2>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.works.index.nameLabel}
			<input
				name="name"
				required
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.works.index.typeLabel}
			<select
				name="type"
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
			>
				{#each Object.entries(t.works.types) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.works.index.summaryLabel} <span class="text-muted">{t.works.index.summaryOptional}</span>
			<textarea
				name="summary"
				rows="2"
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"></textarea>
		</label>
		{#if form?.message}
			<p class="text-sm text-danger">{form.message}</p>
		{/if}
		<button
			type="submit"
			class="mt-1 w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
		>
			{t.works.index.createButton}
		</button>
	</form>
</div>
