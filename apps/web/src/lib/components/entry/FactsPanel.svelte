<script lang="ts">
	/**
	 * B4 = B: closed by default. The panel itself is already "closed by default" in the
	 * sense that it lives behind a tab (B1 = C); each individual fact is closed on top of
	 * that, and opening one is what tells `EntryProse` which span to highlight in the body.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import type { AuthorKind } from '@canonry/db/schema';

	export interface FactRow {
		id: string;
		statement: string;
		spanStart: number;
		spanEnd: number;
		sourceExcerpt: string;
		authorKind: AuthorKind;
	}

	let {
		facts,
		activeFactId,
		onToggle,
		locale
	}: {
		facts: FactRow[];
		activeFactId: string | null;
		onToggle: (fact: FactRow) => void;
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));
</script>

{#if facts.length === 0}
	<EmptyState
		kind="derived"
		message={t.entry.facts.empty}
		explanation={t.entry.facts.explanation}
	/>
{:else}
	<ul class="divide-y divide-line">
		{#each facts as fact, i (fact.id)}
			<li class="py-2">
				<Button
					type="button"
					variant="ghost"
					class="h-auto w-full items-start justify-start gap-2 px-0 py-0 text-left text-sm font-normal hover:bg-transparent aria-expanded:bg-transparent"
					aria-expanded={activeFactId === fact.id}
					onclick={() => onToggle(fact)}
				>
					<span class="w-4 flex-none font-mono text-xs text-muted">{i + 1}</span>
					<span class="text-ink-2">{fact.statement}</span>
				</Button>
				{#if activeFactId === fact.id}
					<p class="mt-2 pl-6 text-xs text-muted italic">&ldquo;{fact.sourceExcerpt}&rdquo;</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
