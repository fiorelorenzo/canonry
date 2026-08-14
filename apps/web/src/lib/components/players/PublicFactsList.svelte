<!--
	Only ever fed `PublicFactRow[]` from `publicEntityBySlug` - each already carries its own
	confirmed revelation. A fact finer than the entry itself is the point of E5's kind='fact'
	granularity: the party can know Aldric was dismissed without the rest of his entry.
-->
<script lang="ts">
	import type { PublicFactRow } from '@canonry/db';

	let { facts }: { facts: PublicFactRow[] } = $props();
</script>

{#if facts.length > 0}
	<section class="mt-8">
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">What's known</h2>
		<ul class="mt-2 space-y-1.5">
			{#each facts as fact (fact.id)}
				<li class="text-sm text-ink-2">{fact.statement}</li>
			{/each}
		</ul>
	</section>
{/if}
