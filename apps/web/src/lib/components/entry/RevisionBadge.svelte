<script lang="ts">
	/**
	 * B4 = B: a permanent, non-violet badge distinguishing `human` from `ai_accepted`.
	 * Deliberately not C1's violet - that hue means "not yet accepted", and an accepted
	 * revision from a month ago is exactly the thing this badge must never say that about.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import type { AuthorKind } from '@canonry/db/schema';

	let { kind, locale }: { kind: AuthorKind; locale: Locale } = $props();
	let t = $derived(messages(locale));
</script>

{#if kind === 'human'}
	<span class="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-xs text-ink-2"
		>{t.entry.history.revisionHuman}</span
	>
{:else}
	<span class="rounded-full bg-ok-bg px-2 py-0.5 font-mono text-xs text-ok"
		>{t.entry.history.revisionAiAccepted}</span
	>
{/if}
