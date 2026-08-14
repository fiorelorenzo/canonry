<script lang="ts">
	/**
	 * Issue #20's index, decision B5 = A. A short list of works, each one a door into its
	 * own tree-plus-editor page; the create form only asks for what the schema requires
	 * to start (`name`, `type`) since a summary, a status and the first act all belong to
	 * the work's own page, not to a wizard here.
	 */
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const WORK_TYPE_LABELS: Record<string, string> = {
		oneshot: 'Oneshot',
		module: 'Module',
		campaign: 'Campaign',
		story: 'Story',
		novel: 'Novel'
	};
</script>

<svelte:head><title>Works — {data.current.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-8 py-10">
	<h1 class="text-2xl font-semibold text-ink">Works</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		A oneshot, a module, a campaign, a story or a novel: an ordered tree of acts, chapters, scenes
		and encounters, separate from the universe's canon. What happens while writing or playing one
		flows back as proposals, never as a direct write (SPEC.md §4.3).
	</p>

	{#if data.works.length === 0}
		<p class="mt-6 text-sm text-muted">No works yet.</p>
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
						{WORK_TYPE_LABELS[work.type] ?? work.type} · {work.status}
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
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">Start a new work</h2>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			Name
			<input
				name="name"
				required
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			Type
			<select
				name="type"
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
			>
				{#each Object.entries(WORK_TYPE_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			Summary <span class="text-muted">(optional)</span>
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
			Create work
		</button>
	</form>
</div>
