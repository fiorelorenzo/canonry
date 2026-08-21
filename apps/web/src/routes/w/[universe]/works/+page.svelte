<script lang="ts">
	/**
	 * Issue #20's index, decision B5 = A. A short list of works, each one a door into its
	 * own tree-plus-editor page; the create form only asks for what the schema requires
	 * to start (`name`, `type`) since a summary, a status and the first act all belong to
	 * the work's own page, not to a wizard here.
	 *
	 * Issue #286 names this field as one of the two the segmented control takes (decision
	 * O4 = B). It is five fixed values rather than the two or three that phrasing leads
	 * with, and it still belongs here rather than in a Select: the five are the whole
	 * answer to "what kind of thing am I starting", short enough to read at once, and
	 * seeing all five is what tells a GM this product has a "novel" at all.
	 *
	 * **Without JavaScript this form keeps working.** The segmented control is a group of
	 * native radios, so `type` posts with no hidden input and no fallback behind it, the
	 * same as the `<select>` it replaces.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Segmented } from '$lib/components/ui/segmented';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let t = $derived(messages(data.locale));
	let creating = $state(false);

	// `t.works.types` is the product's own vocabulary, keyed by the column's enum values,
	// so the segments come from the catalogue rather than being restated here.
	const typeOptions = $derived(
		Object.entries(t.works.types).map(([value, label]) => ({ value, label }))
	);
	let workType = $state('oneshot');
</script>

<svelte:head><title>{t.works.index.title}: {data.current.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-8 py-10">
	<h1 class="text-2xl font-semibold text-ink">{t.works.index.title}</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		{t.works.index.description}
	</p>

	{#if data.works.length === 0}
		<EmptyState kind="cold" message={t.works.index.empty}>
			{#snippet action()}
				<Button href="#work-create-name">{t.works.index.emptyAction}</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ul class="mt-6 flex flex-col divide-y divide-line">
			{#each data.works as work (work.id)}
				<li class="py-3">
					<a
						href={resolve(`/w/${data.current.slug}/works/${work.slug}`)}
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
		use:enhance={() => {
			creating = true;
			return async ({ update }) => {
				await update();
				creating = false;
			};
		}}
	>
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
			{t.works.index.createHeading}
		</h2>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.works.index.nameLabel}
			<Input id="work-create-name" name="name" required />
		</label>
		<div class="flex flex-col gap-1 text-sm text-ink-2">
			<span id="work-create-type-label">{t.works.index.typeLabel}</span>
			<Segmented
				name="type"
				bind:value={workType}
				options={typeOptions}
				labelledby="work-create-type-label"
				class="w-fit"
			/>
		</div>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.works.index.summaryLabel} <span class="text-muted">{t.works.index.summaryOptional}</span>
			<Textarea name="summary" rows={2} />
		</label>
		{#if form?.message}
			<p class="text-sm text-danger">{form.message}</p>
		{/if}
		<Button type="submit" class="mt-1 w-fit" disabled={creating}>
			{creating ? t.works.index.creating : t.works.index.createButton}
		</Button>
	</form>
</div>
