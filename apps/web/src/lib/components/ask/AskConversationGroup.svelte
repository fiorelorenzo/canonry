<script lang="ts">
	/**
	 * Issue #531, W3 = B: one conversation on the record page - a single row when it
	 * only ever had one turn, or a group of rows under a shared header when it grew a
	 * follow-up, because "a follow-up is not a separate memory". The delete control
	 * lives at this level either way: it always discards the whole conversation, never
	 * one cherry-picked turn, so it is never nested inside a row's own `<summary>`
	 * (nesting a link/button inside another interactive element is invalid HTML and
	 * would fight the row's own click target).
	 *
	 * Deletion asks first and says what goes: `confirmingTurnCount` is the
	 * conversation's own true turn count, read unfiltered by the caller
	 * (`+page.server.ts`) even when a live search only has some of those turns on
	 * screen right now - the prompt never undercounts what a confirm actually removes.
	 *
	 * `baseHref` is the fully resolved URL the cancel link and the confirm link are
	 * both built from - the caller's own view of itself (`/ask` with its live `?q=`
	 * for the record index, `/ask/[conversationId]` bare for one conversation's own
	 * page), rather than this component hard-coding the index route: two different
	 * routes render this component and a delete confirmed on one must return to that
	 * same one, not always to the index.
	 */
	import { enhance } from '$app/forms';
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import AskAnswerRow from '$lib/components/ask/AskAnswerRow.svelte';
	import type { AskConversationView } from '$lib/ask/history';

	let {
		locale,
		conversation,
		baseHref,
		confirmingId,
		confirmingTurnCount,
		highlightTurnId = null,
		onOpenEntry
	}: {
		locale: Locale;
		conversation: AskConversationView;
		baseHref: string;
		confirmingId: string | null;
		confirmingTurnCount: number | null;
		highlightTurnId?: string | null;
		onOpenEntry: (slug: string) => void;
	} = $props();

	const th = $derived(messages(locale).universe.ask.history);

	function askedAtLabel(iso: string): string {
		return new Date(iso).toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	const confirmHref = $derived(
		`${baseHref}${baseHref.includes('?') ? '&' : '?'}confirm=${conversation.conversationId}`
	);
	const isConfirming = $derived(confirmingId === conversation.conversationId);
	const isGrouped = $derived(conversation.turns.length > 1);
</script>

<section class="border-b border-line py-4 last:border-b-0">
	{#if isGrouped}
		<header class="mb-2 flex flex-wrap items-center justify-between gap-3">
			<p class="m-0 text-label text-muted">
				{askedAtLabel(conversation.keptAt)} · {th.turnCount(conversation.turns.length)}
			</p>
			{#if isConfirming}
				<form
					method="POST"
					action="?/deleteConversation"
					use:enhance
					class="flex items-center gap-2"
				>
					<input type="hidden" name="conversationId" value={conversation.conversationId} />
					<span class="text-label text-ink-2">
						{th.deleteConfirmPrompt(confirmingTurnCount ?? conversation.turns.length)}
					</span>
					<Button type="submit" variant="destructive" size="sm">{th.delete}</Button>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- `baseHref` is the
					     caller's own `resolve()` result plus a hand-built query string, which the
					     rule cannot see through. -->
					<a href={baseHref} class="text-label text-ink-2 hover:underline"
						>{th.deleteConfirmCancel}</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</form>
			{:else}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- `confirmHref` is a
				     hand-built query string over `baseHref`, same reason as above. -->
				<a href={confirmHref} class="text-label text-danger hover:underline">{th.delete}</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</header>
		<div class="flex flex-col divide-y divide-line-2 border-t border-line-2 pl-4">
			{#each conversation.turns as turn (turn.id)}
				<AskAnswerRow {turn} {locale} highlighted={turn.id === highlightTurnId} {onOpenEntry} />
			{/each}
		</div>
	{:else}
		{@const turn = conversation.turns[0]!}
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<AskAnswerRow {turn} {locale} highlighted={turn.id === highlightTurnId} {onOpenEntry} />
			</div>
			<div class="shrink-0 pt-3">
				{#if isConfirming}
					<form
						method="POST"
						action="?/deleteConversation"
						use:enhance
						class="flex flex-col items-end gap-1.5"
					>
						<input type="hidden" name="conversationId" value={conversation.conversationId} />
						<span class="max-w-40 text-right text-label text-ink-2">
							{th.deleteConfirmPrompt(confirmingTurnCount ?? conversation.turns.length)}
						</span>
						<span class="flex items-center gap-2">
							<Button type="submit" variant="destructive" size="sm">{th.delete}</Button>
							<!-- eslint-disable svelte/no-navigation-without-resolve -- see the grouped
							     branch above: `baseHref` is the caller's own `resolve()` result plus a
							     hand-built query string. -->
							<a href={baseHref} class="text-label text-ink-2 hover:underline"
								>{th.deleteConfirmCancel}</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</span>
					</form>
				{:else}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- see above: `confirmHref`
					     is a hand-built query string over `baseHref`. -->
					<a href={confirmHref} class="text-label text-danger hover:underline">{th.delete}</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</div>
		</div>
	{/if}
</section>
