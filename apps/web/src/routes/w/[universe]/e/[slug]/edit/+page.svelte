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
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import { Button } from '$lib/components/ui/button';
	import MarkdownEditor from '$lib/components/entry/MarkdownEditor.svelte';
	import LanguageControl from '$lib/components/entry/LanguageControl.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let t = $derived(messages(data.locale));
	let saving = $state(false);

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

<!-- X1 = A (#598): the width is declared once, here, and `bodyClass` carries what this
     route's body needs beyond it. `MarkdownEditor`'s `fill` needs an unbroken `h-full`
     chain from `main` down to itself, and an auto-height wrapper anywhere in that chain
     breaks it, which is why this route used to apply the `max-w-working` token to its own
     element instead of going through `PageBody`. It no longer spells a width at all, so
     the band it sits under cannot disagree with it. -->
<Page
	width="working"
	title={t.entry.editor.heading(data.entity.name)}
	bodyClass="flex h-full flex-col px-6 py-8"
>
	<p class="mb-1 shrink-0 text-xs text-muted">
		<a class="hover:underline" href={resolve(`/w/${data.universe.slug}/e/${data.entity.slug}`)}
			>{data.entity.name}</a
		>
		/ {t.entry.editor.breadcrumbEdit}
	</p>
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

	<form
		method="POST"
		action="?/save"
		class="shrink-0"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update();
				saving = false;
			};
		}}
	>
		<input type="hidden" name="body" value={body} />

		<div class="mt-4 flex justify-end">
			<Button type="submit" disabled={saving}>
				{saving ? t.entry.editor.saving : t.entry.editor.save}
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
</Page>
