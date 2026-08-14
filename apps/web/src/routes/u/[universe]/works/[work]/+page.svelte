<script lang="ts">
	import type { ActionData, LayoutData } from './$types';

	let { data, form }: { data: LayoutData; form: ActionData } = $props();

	const KIND_LABELS: Record<string, string> = {
		act: 'Act',
		chapter: 'Chapter',
		scene: 'Scene',
		encounter: 'Encounter'
	};
</script>

<div class="mx-auto max-w-2xl px-8 py-10">
	{#if data.tree.length === 0}
		<h1 class="text-xl font-semibold text-ink">Nothing in {data.work.name} yet</h1>
		<p class="mt-2 max-w-measure text-sm text-ink-2">
			Add the first node - usually an act, but a short oneshot can start straight at a scene.
		</p>
	{:else}
		<h1 class="text-xl font-semibold text-ink">{data.work.name}</h1>
		<p class="mt-2 max-w-measure text-sm text-ink-2">
			Pick a node from the tree on the left, or add another one at the root here.
		</p>
	{/if}

	<form method="POST" action="?/createNode" class="mt-6 flex max-w-sm flex-col gap-3">
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			Title
			<input
				name="title"
				required
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			Kind
			<select
				name="kind"
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
			>
				{#each Object.entries(KIND_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</label>
		{#if form?.message}
			<p class="text-sm text-danger">{form.message}</p>
		{/if}
		<button
			type="submit"
			class="mt-1 w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
		>
			Add node
		</button>
	</form>
</div>
