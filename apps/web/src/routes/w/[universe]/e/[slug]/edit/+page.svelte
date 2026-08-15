<script lang="ts">
	/**
	 * The editor page, B2 = C and G4 = A. No autosave: saving is an explicit action,
	 * because propagation triggers on save (#5.1) and a debounced write would fire that
	 * loop on half a sentence.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import MarkdownEditor from '$lib/components/entry/MarkdownEditor.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let t = $derived(messages(data.locale));

	// `body` seeds once from the loaded entity and then owns its own edits; the route's
	// dynamic `[slug]` param means a different entry remounts this component rather than
	// re-running this initialiser with stale data underneath an in-progress edit.
	// svelte-ignore state_referenced_locally
	let body = $state(data.entity.body);
</script>

<svelte:head
	><title>{t.entry.editor.heading(data.entity.name)} &middot; {data.universe.name}</title
	></svelte:head
>

<div class="mx-auto max-w-3xl px-6 py-8">
	<p class="mb-3 text-xs text-muted">
		<a class="hover:underline" href={resolve(`/w/${data.universe.slug}/e/${data.entity.slug}`)}
			>{data.entity.name}</a
		>
		/ {t.entry.editor.breadcrumbEdit}
	</p>
	<h1 class="mb-6 text-2xl font-semibold text-ink">{t.entry.editor.heading(data.entity.name)}</h1>
	{#if form?.message}
		<p class="mb-4 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.message}</p>
	{/if}

	<form method="POST">
		<MarkdownEditor bind:value={body} targets={data.mentionTargets} locale={data.locale} />
		<input type="hidden" name="body" value={body} />

		<div class="mt-4 flex justify-end">
			<Button type="submit">
				{t.entry.editor.save}
			</Button>
		</div>
	</form>
</div>
