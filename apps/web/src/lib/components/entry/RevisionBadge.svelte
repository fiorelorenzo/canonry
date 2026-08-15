<script lang="ts">
	/**
	 * B4 = B: a permanent, non-violet badge distinguishing `human` from `ai_accepted`.
	 * Deliberately not C1's violet - that hue means "not yet accepted", and an accepted
	 * revision from a month ago is exactly the thing this badge must never say that about.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Badge } from '$lib/components/ui/badge';
	import type { AuthorKind } from '@canonry/db/schema';

	let { kind, locale }: { kind: AuthorKind; locale: Locale } = $props();
	let t = $derived(messages(locale));
</script>

{#if kind === 'human'}
	<Badge variant="secondary" class="font-mono text-ink-2">{t.entry.history.revisionHuman}</Badge>
{:else}
	<Badge class="bg-ok-bg font-mono text-ok">{t.entry.history.revisionAiAccepted}</Badge>
{/if}
