<script lang="ts">
	/**
	 * The editor page, B2 = C and G4 = A. No autosave: saving is an explicit action,
	 * because propagation triggers on save (#5.1) and a debounced write would fire that
	 * loop on half a sentence.
	 *
	 * #347: the entry's own language control lives here now, not under the title on the
	 * read view. It governs `entity.language`, a per-entry claim about the prose that
	 * cross-lingual retrieval and every proposal written into this entry read, and the GM
	 * only ever touches it when detection got a mixed or too-short entry wrong. That is a
	 * rare correction to the text, so it belongs beside the text rather than in the primary
	 * reading position of every entry, and I5's language switch (the interface's own, in the
	 * account menu) stays the only one in the reading chrome.
	 *
	 * It sits outside the body `<form>` on purpose: it is its own form posting to its own
	 * action, so changing the language never submits an unsaved body, and saving the body
	 * never re-posts a language.
	 *
	 * Round twelve, Q4: the editor itself moved outside that form for the same reason. Its
	 * controls are not the entry's data, and the write/preview switch is a group of native
	 * radios, so inside the form Enter on it would submit the entry rather than change the
	 * view. Nothing is lost by moving it: the body has always been posted by the hidden
	 * input below, which reads the same `body` state the editor binds, never by the
	 * textarea itself.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import MarkdownEditor from '$lib/components/entry/MarkdownEditor.svelte';
	import LanguageControl from '$lib/components/entry/LanguageControl.svelte';
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

<div class="mx-auto flex h-full max-w-3xl flex-col px-6 py-8">
	<p class="mb-1 shrink-0 text-xs text-muted">
		<a class="hover:underline" href={resolve(`/w/${data.universe.slug}/e/${data.entity.slug}`)}
			>{data.entity.name}</a
		>
		/ {t.entry.editor.breadcrumbEdit}
	</p>
	<!-- S7, round fourteen (#412): shrunk to the breadcrumb's own scale, since the
	     breadcrumb one line up already says the entry's name - this stays a real `h1`
	     for the page's outline, it just no longer spends `text-2xl` and `mb-6` telling
	     you something you were told a line ago. That reclaims the vertical space the
	     writing area gets below. -->
	<h1 class="mb-4 shrink-0 text-xs font-medium text-ink">
		{t.entry.editor.heading(data.entity.name)}
	</h1>
	{#if form?.message}
		<p class="mb-4 shrink-0 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
			{form.message}
		</p>
	{/if}

	<MarkdownEditor
		fill
		bind:value={body}
		targets={data.mentionTargets}
		locale={data.locale}
		imageInsert={{
			universeSlug: data.universe.slug,
			entitySlug: data.entity.slug,
			entityName: data.entity.name,
			entityType: data.entity.type,
			canWrite: data.canWrite,
			assets: data.media.assets,
			aiEnabled: data.universe.aiEnabled,
			hasImageStyle: data.universe.hasImageStyle,
			scene: data.media.scene
		}}
		preview={{
			universeSlug: data.universe.slug,
			publicMentionTargets: data.publicMentionTargets
		}}
	/>

	<form method="POST" action="?/save" class="shrink-0">
		<input type="hidden" name="body" value={body} />

		<div class="mt-4 flex justify-end">
			<Button type="submit">
				{t.entry.editor.save}
			</Button>
		</div>
	</form>

	<div class="mt-8 shrink-0 border-t border-line pt-4">
		<LanguageControl
			language={data.entity.language}
			languageSource={data.entity.languageSource}
			canWrite={data.canWrite}
			locale={data.locale}
		/>
	</div>
</div>
