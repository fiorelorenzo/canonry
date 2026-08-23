<script lang="ts">
	/**
	 * Issue #531, W3 = B: one conversation's own record, rendered through the same
	 * `AskConversationGroup`/`AskAnswerRow` the bare `/ask` route uses - no search box
	 * here, since a single conversation's own handful of turns needs none.
	 *
	 * G5's own side panel state lives here too, same reasoning as `ask/+page.svelte`'s
	 * own header comment: one panel shared by every row on this page through
	 * `onOpenEntry`, not one per row.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import AskConversationGroup from '$lib/components/ask/AskConversationGroup.svelte';
	import AskEntryPanel from '$lib/components/ask/AskEntryPanel.svelte';
	import { InlineLink } from '$lib/components/ui/link';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.ask);
	const th = $derived(t.history);

	const ownHref = $derived(
		resolve(`/w/${data.universeSlug}/ask/${data.conversation.conversationId}`)
	);

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
	<div class="flex flex-col md:flex-row">
		<div class="min-w-0 flex-1 px-4 py-8 md:px-8">
			<p class="mb-4">
				<InlineLink href={resolve(`/w/${data.universeSlug}/ask`)} class="text-label">
					&larr; {th.heading}
				</InlineLink>
			</p>

			{#if form?.message}
				<p
					class="mb-4 rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger"
				>
					{form.message}
				</p>
			{/if}

			<div class="flex flex-col">
				<AskConversationGroup
					locale={data.locale}
					conversation={data.conversation}
					baseHref={ownHref}
					confirmingId={data.confirmingId}
					confirmingTurnCount={data.confirmingTurnCount}
					highlightTurnId={data.highlightTurnId}
					onOpenEntry={openPanel}
				/>
			</div>
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
