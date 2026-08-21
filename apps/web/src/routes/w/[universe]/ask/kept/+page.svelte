<script lang="ts">
	/**
	 * Issue #290, decision O3, repealed by issue #437, decision T10 (round fifteen): every
	 * row here used to exist because somebody pressed keep. Now every question the
	 * Loremaster answered lands here automatically, grouped by conversation - one card per
	 * conversation, its first question as the card's own heading, and every turn inside it
	 * in the order it was actually asked.
	 *
	 * A source is rendered from its live reference, never from a name frozen when the turn
	 * was kept, so a renamed entry reads under its new name and the click still opens G5's
	 * side panel beside the answer. An entry deleted since says so instead of vanishing from
	 * the citation list, because a citation that disappears makes an old answer look less
	 * grounded than it was.
	 *
	 * The guardrail 5 sentence sits at the top as a standing statement, F3 = C: contextual,
	 * where the content actually goes, linking to the page that names every provider. The
	 * moment-of-asking disclosure lives in the panel itself now (`shell.quickAsk.disclosure`
	 * in `QuickAsk.svelte`), read before anything is asked rather than after every turn -
	 * this page is the record, not the place the disclosure is first read.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { providerLabel } from '$lib/providers';
	import { Button } from '$lib/components/ui/button';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.ask);
	const tk = $derived(t.kept);

	interface PanelEntry {
		name: string;
		type: string;
		body: string;
	}
	let panelEntry = $state<PanelEntry | null>(null);
	let panelLoading = $state(false);

	async function openPanel(slug: string) {
		panelLoading = true;
		panelEntry = null;
		try {
			const res = await fetch(`/w/${data.universeSlug}/ask/entry/${slug}`);
			if (res.ok) panelEntry = (await res.json()) as PanelEntry;
		} finally {
			panelLoading = false;
		}
	}

	function closePanel() {
		panelEntry = null;
	}

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

<div class="flex h-screen">
	<div
		class="flex-1 overflow-y-auto px-8 py-8"
		class:max-w-2xl={panelEntry !== null || panelLoading}
	>
		<p class="crumb text-xs tracking-wide text-muted uppercase">{tk.crumb(data.current.name)}</p>
		<h1 class="mt-1 text-2xl text-ink">{tk.heading}</h1>

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
			<div class="mt-8 flex flex-col gap-6">
				{#each data.conversations as conversation (conversation.conversationId)}
					<article class="rounded-lg border border-line bg-panel p-4">
						<div class="flex items-start justify-between gap-2">
							<h2 class="text-base text-ink">{conversation.turns[0]!.question}</h2>
							<span class="mt-1 shrink-0 text-xs text-muted"
								>{keptAtLabel(conversation.keptAt)}</span
							>
						</div>

						{#each conversation.turns as turn, turnIndex (turn.id)}
							<div
								class:mt-4={turnIndex > 0}
								class:border-t={turnIndex > 0}
								class:border-line={turnIndex > 0}
								class:pt-4={turnIndex > 0}
							>
								{#if turnIndex > 0}
									<h3 class="text-sm font-semibold text-ink">{turn.question}</h3>
								{/if}
								<p class="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
									<span>{keptAtLabel(turn.keptAt)}</span>
									<span>· {t.levels[turn.detailLevel]}</span>
									<span>· {tk.askedFrom} {turn.askedFromPath}</span>
									<span
										>· {turn.provider
											? tk.writtenBy(providerLabel(turn.provider))
											: tk.writtenWithoutModel}</span
									>
								</p>

								<p class="mt-3 max-w-measure text-sm leading-relaxed text-ink">{turn.answer}</p>

								{#if turn.sources.length > 0}
									<h4 class="mt-4 text-xs tracking-wide text-muted uppercase">{tk.sourcesLabel}</h4>
									<div class="mt-1.5 flex flex-col gap-1.5">
										{#each turn.sources as source (source.id)}
											{#if source.kind === 'own_canon'}
												{#if source.entity}
													<button
														type="button"
														class="src clickable rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-left text-xs"
														onclick={() => openPanel(source.entity!.slug)}
													>
														<b class="text-ink underline decoration-dotted underline-offset-2"
															>{source.entity.name}</b
														>
														<span class="text-muted"> · {t.ownCanonLabel}</span>
														<span class="mt-0.5 block text-ink-2">"{source.statement}"</span>
													</button>
												{:else}
													<div
														class="src rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs"
													>
														<span class="text-muted">{tk.deletedEntry}</span>
														<span class="mt-0.5 block text-ink-2">"{source.statement}"</span>
													</div>
												{/if}
											{:else}
												<div
													class="src derived rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs"
												>
													<!-- Round eleven P2 (#344): same treatment as the Ask page's own
														indexed chip. Retrieved writing from somebody else's site is not
														a word a model wrote. -->
													<span
														class="badge rounded-full border border-line-2 bg-panel px-1.5 py-0.5 text-[10px] text-ink-2"
														>{t.indexedBadge}</span
													>
													<b class="text-ink">{source.pageTitle}</b>
													{#if source.url}
														<!-- eslint-disable svelte/no-navigation-without-resolve -- an indexed
														     corpus page on somebody else's site, which resolve() neither can nor
														     should rewrite (SPEC.md §7 requires the link beside the licence) -->
														<a
															href={source.url}
															target="_blank"
															rel="noreferrer"
															class="text-ink-2 underline">↗</a
														>
														<!-- eslint-enable svelte/no-navigation-without-resolve -->
													{/if}
													{#if source.dataSource}
														<span class="lic mt-0.5 block font-mono text-[11px] text-muted">
															{source.dataSource.attribution}{#if source.dataSource.licence}
																· {source.dataSource.licence}{/if}
														</span>
													{/if}
													<span class="mt-0.5 block text-ink-2">"{source.statement}"</span>
												</div>
											{/if}
										{/each}
									</div>
								{/if}
							</div>
						{/each}

						<div class="mt-4">
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

	{#if panelLoading || panelEntry}
		<div class="w-96 flex-none overflow-y-auto border-l border-line bg-panel p-6">
			{#if panelLoading}
				<p class="text-sm text-muted">{t.loading}</p>
			{:else if panelEntry}
				<div class="flex items-start justify-between gap-2">
					<div>
						<p class="text-xs tracking-wide text-muted uppercase">{panelEntry.type}</p>
						<h2 class="mt-0.5 text-lg text-ink">{panelEntry.name}</h2>
					</div>
					<Button type="button" variant="ghost" size="sm" onclick={closePanel}>{t.close}</Button>
				</div>
				<p class="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{panelEntry.body}</p>
			{/if}
		</div>
	{/if}
</div>
