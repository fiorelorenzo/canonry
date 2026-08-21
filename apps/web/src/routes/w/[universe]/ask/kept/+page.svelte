<script lang="ts">
	/**
	 * Issue #290, decision O3, repealed by issue #437 (T10) and reshaped again by issue
	 * #455 (U11): this page used to render every conversation's every turn inline once
	 * T10 landed - "a second list of the same thing" the issue names, now that `/w/
	 * [universe]/ask/[conversationId]` renders a conversation for real. So this goes back
	 * to being an index: one card per conversation, its first question as the heading and
	 * a turn count as the only other line, linking into the conversation itself rather
	 * than repeating its answer and sources here.
	 *
	 * The guardrail 5 sentence sits at the top as a standing statement, F3 = C: contextual,
	 * where the content actually goes, linking to the page that names every provider. The
	 * moment-of-asking disclosure lives in the panel and in the Ask page itself now
	 * (`shell.quickAsk.disclosure`, `universe.ask.disclosure`), read before anything is
	 * asked rather than after every turn - this page is the record, not the place the
	 * disclosure is first read.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import { Button } from '$lib/components/ui/button';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.ask);
	const tk = $derived(t.kept);

	function keptAtLabel(iso: string): string {
		return new Date(iso).toLocaleString(data.locale === 'it' ? 'it-IT' : 'en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}
</script>

<svelte:head>
	<title>{tk.headTitle(data.current.name)}</title>
</svelte:head>

<PageHeader eyebrow={tk.crumb(data.current.name)} title={tk.heading} />
<PageBody width="working">
	<div class="px-8 py-8">
		<!-- Guardrail 5 in its F3 = C shape, standing on the surface that holds the content:
	     what this is, that it never becomes canon on its own, that players never see it,
	     that only the GM removes it, and a link to the page naming every provider. -->
		<div
			class="mt-4 max-w-measure rounded-lg border border-line-2 bg-panel-2 p-4 text-sm text-ink-2"
		>
			<p class="mt-0 mb-0">{tk.note}</p>
			<p class="mt-2 mb-0">
				{t.keep.noteLinkBefore}<a href={resolve('/privacy')} class="text-accent hover:underline"
					>{t.keep.noteLink}</a
				>.
			</p>
		</div>

		<p class="mt-4">
			<a href={resolve(`/w/${data.universeSlug}/ask`)} class="text-sm text-accent hover:underline"
				>{tk.askLink}</a
			>
		</p>

		{#if form?.message}
			<p class="mt-4 rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger">
				{form.message}
			</p>
		{/if}

		{#if data.conversations.length === 0}
			<p class="mt-8 max-w-measure text-sm text-ink-2">{tk.empty}</p>
		{:else}
			<div class="mt-8 flex flex-col gap-3">
				{#each data.conversations as conversation (conversation.conversationId)}
					<article
						class="flex items-start justify-between gap-4 rounded-lg border border-line bg-panel p-4"
					>
						<div class="min-w-0 flex-1">
							<a
								href={resolve(`/w/${data.universeSlug}/ask/${conversation.conversationId}`)}
								class="text-base text-ink hover:underline"
							>
								{conversation.firstQuestion}
							</a>
							<p class="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
								<span>{tk.turnCount(conversation.turnCount)}</span>
								<span>· {keptAtLabel(conversation.keptAt)}</span>
							</p>
						</div>

						<div class="shrink-0">
							{#if data.confirmingId === conversation.conversationId}
								<form
									method="POST"
									action="?/deleteConversation"
									use:enhance
									class="flex items-center gap-2"
								>
									<input type="hidden" name="conversationId" value={conversation.conversationId} />
									<span class="text-xs text-ink-2">{tk.deleteConfirmPrompt}</span>
									<Button type="submit" variant="destructive" size="sm">{tk.delete}</Button>
									<a
										href={resolve(`/w/${data.universeSlug}/ask/kept`)}
										class="text-xs text-ink-2 hover:underline">{tk.deleteConfirmCancel}</a
									>
								</form>
							{:else}
								<!-- A link, not a button, so deleting still works with scripting off: this
							     step only reveals the confirm pair, it changes nothing. -->
								<a
									href="{resolve(
										`/w/${data.universeSlug}/ask/kept`
									)}?confirm={conversation.conversationId}"
									class="text-xs text-danger hover:underline">{tk.delete}</a
								>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</div>
</PageBody>
