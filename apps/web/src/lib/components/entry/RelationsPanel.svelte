<script lang="ts">
	/**
	 * B1 = C's Relations tab, B3 = A's placement (relations live in the margin). What this
	 * wave does *not* build: B3's one-click confirm over an inferred relation, because a
	 * relation only arrives "inferred" through propagation (#47), which does not exist yet.
	 * Every row here is already a confirmed `relation` row (`relationsFor`, #16); once
	 * propagation lands, a pending row belongs in this same panel, not a new one.
	 */
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import type { RelationView } from '@canonry/db';

	let {
		relations,
		universeSlug,
		locale
	}: { relations: RelationView[]; universeSlug: string; locale: Locale } = $props();
	let t = $derived(messages(locale));
</script>

{#if relations.length === 0}
	<EmptyState
		kind="derived"
		message={t.entry.relations.empty}
		explanation={t.entry.relations.explanation}
	/>
{:else}
	<ul class="space-y-2.5">
		{#each relations as relation (relation.key + relation.other.id)}
			<li class="text-sm">
				<span class="text-muted">
					{t.relationTypeLabel(relation.key)?.[
						relation.direction === 'from' ? 'label' : 'inverseLabel'
					] ?? relation.label}
				</span>
				<a
					href={resolve(`/w/${universeSlug}/e/${relation.other.slug}`)}
					data-entry-slug={relation.other.slug}
					class="ml-1 text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg"
				>
					{relation.other.name}
				</a>
			</li>
		{/each}
	</ul>
{/if}
