<script lang="ts">
	/**
	 * B4 = B: a permanent badge distinguishing `human` from `ai_accepted`, and never in the
	 * copilot's own hue - that hue means "not yet accepted", and an accepted
	 * revision from a month ago is exactly the thing this badge must never say that about.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Badge } from '$lib/components/ui/badge';
	import type { AuthorKind } from '@canonry/db/schema';

	let { kind, locale }: { kind: AuthorKind; locale: Locale } = $props();
	let t = $derived(messages(locale));
</script>

{#if kind === 'human'}
	<Badge variant="secondary" class="font-mono">{t.entry.history.revisionHuman}</Badge>
{:else}
	<Badge variant="ok" class="font-mono">{t.entry.history.revisionAiAccepted}</Badge>
{/if}
