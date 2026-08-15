<!--
	Only ever fed `PublicFactRow[]` from `publicEntityBySlug` - each already carries its own
	confirmed revelation. A fact finer than the entry itself is the point of E5's kind='fact'
	granularity: the party can know Aldric was dismissed without the rest of his entry.

	Issue #127: `locale` picks the "What's known" heading; every `fact.statement` is canon,
	extracted from the entry's own body, so it is never touched by `locale`.
-->
<script lang="ts">
	import type { PublicFactRow } from '@canonry/db';
	import { messages, type Locale } from '$lib/i18n';

	let { facts, locale }: { facts: PublicFactRow[]; locale: Locale } = $props();
	let t = $derived(messages(locale));
</script>

{#if facts.length > 0}
	<section class="mt-8">
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
			{t.players.factsHeading}
		</h2>
		<ul class="mt-2 space-y-1.5">
			{#each facts as fact (fact.id)}
				<li class="text-sm text-ink-2">{fact.statement}</li>
			{/each}
		</ul>
	</section>
{/if}
