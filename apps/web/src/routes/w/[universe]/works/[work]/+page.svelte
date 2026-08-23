<script lang="ts">
	/**
	 * Issue #286, decision O4 = B: `kind` is a vocabulary the product itself ships (act,
	 * chapter, scene, encounter, `works.kinds` in the catalogue), so it is the Select,
	 * not the segmented control and not the combobox.
	 *
	 * **Without JavaScript this form keeps working.** The Select is a popover, which
	 * cannot open without it, so `ui/native-fallback` renders a real `<select>` inside
	 * `<noscript>` and the trigger is marked `data-js-only` so only one of the two is
	 * ever present. The alternative, letting the Select's own hidden input post its
	 * default, would have silently created every node as an act for a reader with
	 * scripting off.
	 */
	import { enhance } from '$app/forms';
	import { Page } from '$lib/components/ui/page';
	import { messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { NativeFallback } from '$lib/components/ui/native-fallback';
	import type { ActionData, LayoutData } from './$types';

	let { data, form }: { data: LayoutData; form: ActionData } = $props();
	let t = $derived(messages(data.locale));
	let addingNode = $state(false);

	const kindOptions = $derived(
		Object.entries(t.works.kinds).map(([value, label]) => ({ value, label }))
	);
	let kind = $state('act');
	const kindLabel = $derived(kindOptions.find((option) => option.value === kind)?.label ?? kind);
</script>

<Page
	width="working"
	title={data.tree.length === 0 ? t.works.tree.emptyHeading(data.work.name) : data.work.name}
>
	<div class="px-8 py-10">
		{#if data.tree.length === 0}
			<EmptyState kind="cold" message={t.works.tree.emptyHint}>
				{#snippet action()}
					<Button href="#work-node-title">{t.works.tree.addNodeButton}</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<p class="mt-2 max-w-measure text-sm text-ink-2">
				{t.works.tree.pickNodeHint}
			</p>
		{/if}

		<form
			method="POST"
			action="?/createNode"
			class="mt-6 flex max-w-sm flex-col gap-3"
			use:enhance={() => {
				addingNode = true;
				return async ({ update }) => {
					await update();
					addingNode = false;
				};
			}}
		>
			<label class="flex flex-col gap-1 text-sm text-ink-2">
				{t.works.tree.titleLabel}
				<Input id="work-node-title" name="title" required />
			</label>
			<div class="flex flex-col gap-1 text-sm text-ink-2">
				<label for="work-node-kind">{t.works.tree.kindLabel}</label>
				<div data-js-only>
					<Select.Root type="single" bind:value={kind}>
						<Select.Trigger id="work-node-kind" class="w-full">{kindLabel}</Select.Trigger>
						<Select.Content>
							{#each kindOptions as option (option.value)}
								<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<NativeFallback
					name="kind"
					value={kind}
					options={kindOptions}
					label={t.works.tree.kindLabel}
				/>
			</div>
			{#if form?.message}
				<p class="text-sm text-danger">{form.message}</p>
			{/if}
			<Button type="submit" class="mt-1 w-fit" disabled={addingNode}>
				{addingNode ? t.works.tree.addingNode : t.works.tree.addNodeButton}
			</Button>
		</form>
	</div>
</Page>
