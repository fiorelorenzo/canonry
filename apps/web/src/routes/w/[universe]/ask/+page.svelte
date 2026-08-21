<script lang="ts">
	/**
	 * Issue #455, decision U11: the Ask page is a conversation now, not a question box with
	 * one answer - `AskConversation.svelte` holds the actual UI and behaviour, shared with
	 * `[conversationId]/+page.svelte`, because a fresh conversation and one reopened by id
	 * render and continue identically. This route is the fresh-conversation half: empty
	 * until the first question, at which point `AskConversation` mints a conversation id
	 * and renames the URL to name it - see that component's own header comment for why a
	 * URL replaces the old `askHandoff` one-shot carrier entirely.
	 */
	import type { PageData } from './$types';
	import AskConversation from '$lib/components/ask/AskConversation.svelte';

	let { data }: { data: PageData } = $props();
</script>

<AskConversation
	universeSlug={data.universeSlug}
	universeName={data.current.name}
	locale={data.locale}
	conversationId={null}
/>
