<script lang="ts">
	/**
	 * Issue #455, decision U11: a loaded conversation, rendered by the same
	 * `AskConversation.svelte` the fresh-conversation route uses. `{#key data.conversationId}`
	 * forces a remount when the id changes - clicking from one conversation to another in
	 * `ask/kept`'s index navigates within this same route, and SvelteKit reuses a
	 * `+page.svelte` instance across a param change by default, which would otherwise leave
	 * the previous conversation's turns sitting in `AskConversation`'s own `$state`.
	 */
	import type { PageData } from './$types';
	import AskConversation from '$lib/components/ask/AskConversation.svelte';

	let { data }: { data: PageData } = $props();
</script>

{#key data.conversationId}
	<AskConversation
		universeSlug={data.universeSlug}
		universeName={data.current.name}
		locale={data.locale}
		conversationId={data.conversationId}
		initialTurns={data.turns}
	/>
{/key}
