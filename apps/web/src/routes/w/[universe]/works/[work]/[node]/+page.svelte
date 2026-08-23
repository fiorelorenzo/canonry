<script lang="ts">
	/**
	 * Decision B5 = A: the scene editor next to its own tree (the layout's left pane) and
	 * its "Uses" aside. The uses list is read-only - a fresh dot and a link to the entry,
	 * "nothing more" (B5's own guardrail callout): accepting whatever changed happens on
	 * the entry itself, never here.
	 *
	 * Issue #286, decision O4 = B: the add-child form's `kind` is the same shipped
	 * vocabulary as the tree page's own, so it takes the same Select and the same
	 * `<noscript>` fallback. **Without JavaScript this form keeps working**: the
	 * `<details>` around it is native, and `ui/native-fallback` posts the value the
	 * popover cannot.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Page } from '$lib/components/ui/page';
	import { dateFormat, messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { NativeFallback } from '$lib/components/ui/native-fallback';
	import MarkdownEditor from '$lib/components/entry/MarkdownEditor.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let t = $derived(messages(data.locale));
	let moving = $state(false);
	let saving = $state(false);
	let addingChild = $state(false);

	// svelte-ignore state_referenced_locally
	let title = $state(data.node.title);
	// svelte-ignore state_referenced_locally
	let body = $state(data.node.body);

	const kindOptions = $derived(
		Object.entries(t.works.kinds).map(([value, label]) => ({ value, label }))
	);
	let childKind = $state('act');
	const childKindLabel = $derived(
		kindOptions.find((option) => option.value === childKind)?.label ?? childKind
	);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
</script>

<!-- X1 = A (#598): the width is declared once, here, and `bodyClass` carries the flex row
     this body is. It used to apply the `max-w-working` token to its own element rather
     than go through `PageBody`, because the "Uses" aside beside the article is a
     fixed-width secondary panel the same way `[work]/+layout.svelte`'s tree is, not body
     content the width system should cap. Same class set as before, one declaration fewer:
     the band above it now reads the width from the same place. -->
<Page width="working" title={data.node.title} bodyClass="flex min-w-0">
	<article class="min-w-0 flex-1 px-6 py-8">
		<p class="mb-3 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/w/${data.current.slug}/works/${data.work.slug}`)}
				>{data.work.name}</a
			>
			{#each data.ancestors as ancestor (ancestor.id)}
				/ {ancestor.title}
			{/each}
			/ <span class="text-ink-2">{data.node.title}</span>
		</p>

		<div class="mb-4 flex items-center gap-2">
			<Badge class="bg-accent-bg font-mono text-accent-ink uppercase">
				{t.works.kinds[data.node.kind] ?? data.node.kind}
			</Badge>
			<form
				method="POST"
				action="?/moveUp"
				use:enhance={() => {
					moving = true;
					return async ({ update }) => {
						await update();
						moving = false;
					};
				}}
			>
				<Button type="submit" variant="secondary" size="sm" disabled={moving}>
					{moving ? t.works.node.moving : t.works.node.moveUp}
				</Button>
			</form>
			<form
				method="POST"
				action="?/moveDown"
				use:enhance={() => {
					moving = true;
					return async ({ update }) => {
						await update();
						moving = false;
					};
				}}
			>
				<Button type="submit" variant="secondary" size="sm" disabled={moving}>
					{moving ? t.works.node.moving : t.works.node.moveDown}
				</Button>
			</form>
		</div>

		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
			}}
		>
			<!-- #147: the title stays a bare input on purpose - it reads as the scene's
				heading (text-page-title font-semibold, no border chrome but a focus underline),
				and shadcn's Input would flatten that into a form field. Its meaning lives
				in the styling a generic control can't carry. -->
			<label class="mb-3 block">
				<span class="sr-only">{t.works.node.titleSrLabel}</span>
				<input
					name="title"
					bind:value={title}
					required
					class="w-full border-0 border-b border-line-2 bg-transparent px-0 py-1 text-page-title font-semibold text-ink outline-none focus:border-accent"
				/>
			</label>
			<MarkdownEditor bind:value={body} targets={data.mentionTargets} locale={data.locale} />
			<input type="hidden" name="body" value={body} />
			{#if form?.message}
				<p class="mt-2 text-sm text-danger">{form.message}</p>
			{/if}
			<div class="mt-4 flex justify-end">
				<Button type="submit" disabled={saving}>
					{saving ? t.works.node.saving : t.works.node.save}
				</Button>
			</div>
		</form>

		<details class="mt-8 border-t border-line pt-4">
			<summary class="cursor-pointer text-xs font-semibold tracking-wide text-muted uppercase">
				{t.works.node.addChildSummary(data.node.title)}
			</summary>
			<form
				method="POST"
				action="?/addChild"
				class="mt-3 flex max-w-sm flex-col gap-3"
				use:enhance={() => {
					addingChild = true;
					return async ({ update }) => {
						await update();
						addingChild = false;
					};
				}}
			>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					{t.works.node.titleLabel}
					<Input name="title" required />
				</label>
				<div class="flex flex-col gap-1 text-sm text-ink-2">
					<label for="work-child-kind">{t.works.node.kindLabel}</label>
					<div data-js-only>
						<Select.Root type="single" bind:value={childKind}>
							<Select.Trigger id="work-child-kind" class="w-full">{childKindLabel}</Select.Trigger>
							<Select.Content>
								{#each kindOptions as option (option.value)}
									<Select.Item value={option.value} label={option.label}>
										{option.label}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<NativeFallback
						name="kind"
						value={childKind}
						options={kindOptions}
						label={t.works.node.kindLabel}
					/>
				</div>
				<Button type="submit" variant="secondary" size="sm" disabled={addingChild}>
					{addingChild ? t.works.node.addingNode : t.works.node.addNodeButton}
				</Button>
			</form>
		</details>
	</article>

	<aside class="w-60 flex-none border-l border-line bg-panel-2 p-4">
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
			{t.works.node.usesHeading}
		</h2>
		{#if data.uses.length === 0}
			<EmptyState
				kind="derived"
				message={t.works.node.noUses}
				explanation={t.works.node.usesHint}
			/>
		{:else}
			<ul class="mt-2 flex flex-col gap-2">
				{#each data.uses as use (use.entityId)}
					<li
						class="rounded-md border px-2.5 py-2 text-sm"
						class:border-accent={use.fresh}
						class:bg-accent-bg={use.fresh}
						class:border-line={!use.fresh}
						class:bg-panel={!use.fresh}
					>
						<div class="flex items-center gap-1.5">
							<span
								class="h-1.5 w-1.5 flex-none rounded-full"
								class:bg-accent={use.fresh}
								class:bg-line-2={!use.fresh}
							></span>
							<a
								href={resolve(`/w/${data.current.slug}/e/${use.slug}`)}
								class="truncate font-medium text-ink hover:text-accent"
							>
								{use.name}
							</a>
						</div>
						{#if use.fresh}
							<p class="mt-1 font-mono text-label text-accent-ink">
								{t.works.node.changedAt(formatWhen(use.changedAt))}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="mt-3 text-xs text-muted">
				{t.works.node.usesHint}
			</p>
		{/if}
	</aside>
</Page>
