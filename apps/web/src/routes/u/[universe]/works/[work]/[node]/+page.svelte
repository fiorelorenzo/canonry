<script lang="ts">
	/**
	 * Decision B5 = A: the scene editor next to its own tree (the layout's left pane) and
	 * its "Uses" aside. The uses list is read-only - a fresh dot and a link to the entry,
	 * "nothing more" (B5's own guardrail callout): accepting whatever changed happens on
	 * the entry itself, never here.
	 */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import MarkdownEditor from '$lib/components/entry/MarkdownEditor.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let t = $derived(messages(data.locale));

	// svelte-ignore state_referenced_locally
	let title = $state(data.node.title);
	// svelte-ignore state_referenced_locally
	let body = $state(data.node.body);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
</script>

<div class="flex min-w-0">
	<article class="min-w-0 flex-1 px-6 py-8">
		<p class="mb-3 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/u/${data.current.slug}/works/${data.work.slug}`)}
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
			<form method="POST" action="?/moveUp">
				<Button type="submit" variant="secondary" size="sm">
					{t.works.node.moveUp}
				</Button>
			</form>
			<form method="POST" action="?/moveDown">
				<Button type="submit" variant="secondary" size="sm">
					{t.works.node.moveDown}
				</Button>
			</form>
		</div>

		<form method="POST" action="?/save">
			<!-- #147: the title stays a bare input on purpose - it reads as the scene's
				heading (text-2xl font-semibold, no border chrome but a focus underline),
				and shadcn's Input would flatten that into a form field. Its meaning lives
				in the styling a generic control can't carry. -->
			<label class="mb-3 block">
				<span class="sr-only">{t.works.node.titleSrLabel}</span>
				<input
					name="title"
					bind:value={title}
					required
					class="w-full border-0 border-b border-line-2 bg-transparent px-0 py-1 text-2xl font-semibold text-ink outline-none focus:border-accent"
				/>
			</label>
			<MarkdownEditor bind:value={body} targets={data.mentionTargets} locale={data.locale} />
			<input type="hidden" name="body" value={body} />
			{#if form?.message}
				<p class="mt-2 text-sm text-danger">{form.message}</p>
			{/if}
			<div class="mt-4 flex justify-end">
				<Button type="submit">
					{t.works.node.save}
				</Button>
			</div>
		</form>

		<details class="mt-8 border-t border-line pt-4">
			<summary class="cursor-pointer text-xs font-semibold tracking-wide text-muted uppercase">
				{t.works.node.addChildSummary(data.node.title)}
			</summary>
			<form method="POST" action="?/addChild" class="mt-3 flex max-w-sm flex-col gap-3">
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					{t.works.node.titleLabel}
					<Input name="title" required />
				</label>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					{t.works.node.kindLabel}
					<select
						name="kind"
						class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
					>
						{#each Object.entries(t.works.kinds) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</label>
				<Button type="submit" variant="secondary" size="sm">
					{t.works.node.addNodeButton}
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
						class:border-ai-line={use.fresh}
						class:bg-ai-bg={use.fresh}
						class:border-line={!use.fresh}
						class:bg-panel={!use.fresh}
					>
						<div class="flex items-center gap-1.5">
							<span
								class="h-1.5 w-1.5 flex-none rounded-full"
								class:bg-ai={use.fresh}
								class:bg-line-2={!use.fresh}
							></span>
							<a
								href={resolve(`/u/${data.current.slug}/e/${use.slug}`)}
								class="truncate font-medium text-ink hover:text-accent"
							>
								{use.name}
							</a>
						</div>
						{#if use.fresh}
							<p class="mt-1 font-mono text-[11px] text-ai">
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
</div>
