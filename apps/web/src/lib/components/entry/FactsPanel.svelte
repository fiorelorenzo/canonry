<script lang="ts">
	/**
	 * B4 = B: closed by default. The panel itself is already "closed by default" in the
	 * sense that it lives behind a collapsed section in the aside (B1 = C, and #284 turned
	 * that column's tab strip into five sections); each individual fact is closed on top of
	 * that, and opening one is what tells `EntryProse` which span to highlight in the body.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { stripMentionSyntax } from '$lib/markdown';
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
				<!-- #147 put `whitespace-nowrap` in `buttonVariants.base` because a button holds a
					label, and 108 of the app's 111 `Button` call sites do. A fact row holds a whole
					statement, so the base laid it out on one line and the 256px aside scrolled
					sideways (#299). The base is right and stays: what is wrong here is reaching for
					`Button` at all, which is the call `ask/+page.svelte` already made for its own
					source chip on the same grounds, "Button's inline-flex, centred, whitespace-nowrap
					base would fight that layout rather than fit it". This row had already switched
					off everything `Button` contributes (its height, padding, centring, and both the
					ghost hover and expanded backgrounds), so what was left of the component was the
					focus ring and the press nudge, and those two are kept here by hand. It stays a
					`<button>` with `aria-expanded`: clicking it is what reveals the source excerpt
					under the statement and tells `EntryProse` which span to highlight in the body,
					so the affordance is a disclosure and not decoration. -->
				<button
					type="button"
					class="flex w-full items-start gap-2 rounded-md border border-transparent text-left text-body transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
					aria-expanded={activeFactId === fact.id}
					onclick={() => onToggle(fact)}
				>
					<span class="w-4 flex-none font-mono text-label text-muted">{i + 1}</span>
					<span class="min-w-0 break-words text-ink-2">{stripMentionSyntax(fact.statement)}</span>
				</button>
				{#if activeFactId === fact.id}
					<p class="mt-2 pl-6 text-label text-muted italic">
						&ldquo;{stripMentionSyntax(fact.sourceExcerpt)}&rdquo;
					</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
