<script lang="ts">
	/**
	 * Issue #531, W3 = B (DECISIONS.md "Round eighteen"): the record. Search lives in
	 * `Page`'s own `filters` row, the same slot and the same debounced-`goto`-over-
	 * a-real-`<form method="GET">` shape `entries/+page.svelte` built for U12 - a lone
	 * text field with no submit button still submits on Enter with no JS at all, and
	 * with JS the field debounces into a replacing, focus-keeping navigation instead.
	 *
	 * The search matches a substring of the question OR the answer (`kept_answer` holds
	 * both as text - `listKeptConversations`'s own `query` param does the ILIKE); it does
	 * not rank, stem, or match a source's own text.
	 *
	 * G5 is unamended by the reversal ("G5's source panel stays what a source click
	 * opens", round eighteen): `panelEntry`/`panelLoading` are this route's own copy of
	 * the side panel `AskConversation.svelte` used to own, now shared by every
	 * `AskConversationGroup` row through `onOpenEntry` rather than duplicated per row.
	 * The layout below is the entry page's own two-column shape (`e/[slug]/+page.svelte`
	 * B1's "document plus a switching right column"): a flex row inside `working`'s
	 * 62rem, the record flexing, the panel a fixed-width sibling that only mounts while
	 * something is open.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import * as InputGroup from '$lib/components/ui/input-group';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import XIcon from '@lucide/svelte/icons/x';
	import AskConversationGroup from '$lib/components/ask/AskConversationGroup.svelte';
	import AskEntryPanel from '$lib/components/ask/AskEntryPanel.svelte';
	import { InlineLink } from '$lib/components/ui/link';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.ask);
	const th = $derived(t.history);

	const base = $derived(resolve(`/w/${data.current.slug}/ask`));

	function searchHref(query: string): string {
		return query ? `${base}?q=${encodeURIComponent(query)}` : base;
	}

	let queryValue = $state(data.query);
	let appliedQuery = data.query;
	let debounceHandle: ReturnType<typeof setTimeout> | undefined;

	function applySearch(query: string) {
		appliedQuery = query;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(searchHref(query), { replaceState: true, keepFocus: true, noScroll: true });
	}

	$effect(() => {
		const value = queryValue;
		if (value === appliedQuery) return;
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(() => applySearch(value), 120);
	});

	$effect(() => {
		if (data.query === appliedQuery) return;
		clearTimeout(debounceHandle);
		appliedQuery = data.query;
		queryValue = data.query;
	});

	function onSearchSubmit(event: SubmitEvent) {
		event.preventDefault();
		clearTimeout(debounceHandle);
		applySearch(queryValue);
	}

	const clearSearchHref = $derived(searchHref(''));

	function onClearSearch(event: MouseEvent) {
		event.preventDefault();
		clearTimeout(debounceHandle);
		queryValue = '';
		applySearch('');
	}

	// G5's side panel state - see this file's own header comment.
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
</script>

<svelte:head>
	<title>{th.headTitle(data.current.name)}</title>
</svelte:head>

<Page width="working" eyebrow={th.crumb(data.current.name)} title={th.heading}>
	{#snippet filters()}
		<form method="GET" class="flex items-center gap-2" onsubmit={onSearchSubmit}>
			<InputGroup.Root class="w-full sm:w-80">
				<InputGroup.Input
					type="text"
					name="q"
					placeholder={th.searchPlaceholder}
					aria-label={th.searchPlaceholder}
					bind:value={queryValue}
				/>
				{#if queryValue}
					<InputGroup.Addon align="inline-end">
						<Tooltip.Provider delayDuration={400}>
							<Tooltip.Root>
								<Tooltip.Trigger onclick={onClearSearch}>
									{#snippet child({ props })}
										<!-- eslint-disable svelte/no-navigation-without-resolve -- `clearSearchHref`
										     is a `resolve()` result plus a hand-built query string, which the rule
										     cannot see through. A real `href` stays underneath so this keeps
										     working with no JS: without JS this is a plain link back to `/ask`
										     with `q` dropped; with JS the trigger's `onclick` above intercepts it
										     for an instant, in-place clear instead of a full navigation. -->
										<Button
											{...props}
											href={clearSearchHref}
											variant="ghost"
											size="icon"
											class="size-6 shrink-0 rounded-[calc(var(--radius)-5px)] p-0"
											aria-label={th.searchClear}
										>
											<XIcon aria-hidden="true" class="size-3.5" />
										</Button>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>{th.searchClear}</Tooltip.Content>
							</Tooltip.Root>
						</Tooltip.Provider>
					</InputGroup.Addon>
				{/if}
			</InputGroup.Root>
		</form>
	{/snippet}

	<div class="flex flex-col md:flex-row">
		<div class="min-w-0 flex-1 px-4 py-8 md:px-8">
			<!-- Guardrail 5's disclosure, read once here, as a single standing line rather than
			     the boxed two-paragraph card this page used to carry. -->
			<p class="max-w-measure text-label text-ink-2">
				{th.note}
				{t.keep.noteLinkBefore}<InlineLink href={resolve('/privacy')}>{t.keep.noteLink}</InlineLink
				>.
			</p>

			{#if form?.message}
				<p
					class="mt-4 rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger"
				>
					{form.message}
				</p>
			{/if}

			{#if data.query}
				<p class="mt-4 text-sm text-muted">
					{th.searchResultCount(data.query, data.matchedCount)}
				</p>
			{/if}

			{#if data.conversations.length === 0}
				<div class="mt-8">
					{#if data.query}
						<EmptyState kind="settled" message={th.emptySearchMessage(data.query)} />
					{:else}
						<EmptyState kind="cold" message={th.emptyColdMessage} />
					{/if}
				</div>
			{:else}
				<div class="mt-6 flex flex-col">
					{#each data.conversations as conversation (conversation.conversationId)}
						<AskConversationGroup
							locale={data.locale}
							{conversation}
							baseHref={searchHref(data.query)}
							confirmingId={data.confirmingId}
							confirmingTurnCount={data.confirmingTurnCount}
							onOpenEntry={openPanel}
						/>
					{/each}
				</div>
			{/if}
		</div>

		{#if panelLoading || panelEntry}
			<AskEntryPanel
				loading={panelLoading}
				entry={panelEntry}
				closeLabel={t.close}
				loadingLabel={t.loading}
				onClose={closePanel}
			/>
		{/if}
	</div>
</Page>
