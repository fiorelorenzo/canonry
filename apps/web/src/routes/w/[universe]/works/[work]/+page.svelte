<script lang="ts">
	import { messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { ActionData, LayoutData } from './$types';

	let { data, form }: { data: LayoutData; form: ActionData } = $props();
	let t = $derived(messages(data.locale));
</script>

<div class="mx-auto max-w-2xl px-8 py-10">
	{#if data.tree.length === 0}
		<h1 class="text-xl font-semibold text-ink">{t.works.tree.emptyHeading(data.work.name)}</h1>
		<EmptyState kind="cold" message={t.works.tree.emptyHint}>
			{#snippet action()}
				<Button href="#work-node-title">{t.works.tree.addNodeButton}</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<h1 class="text-xl font-semibold text-ink">{data.work.name}</h1>
		<p class="mt-2 max-w-measure text-sm text-ink-2">
			{t.works.tree.pickNodeHint}
		</p>
	{/if}

	<form method="POST" action="?/createNode" class="mt-6 flex max-w-sm flex-col gap-3">
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.works.tree.titleLabel}
			<Input id="work-node-title" name="title" required />
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.works.tree.kindLabel}
			<select
				name="kind"
				class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
			>
				{#each Object.entries(t.works.kinds) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</label>
		{#if form?.message}
			<p class="text-sm text-danger">{form.message}</p>
		{/if}
		<Button type="submit" class="mt-1 w-fit">
			{t.works.tree.addNodeButton}
		</Button>
	</form>
</div>
