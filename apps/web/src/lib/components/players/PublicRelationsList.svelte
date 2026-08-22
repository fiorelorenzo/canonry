<!--
	Only ever fed `PublicRelationRow[]` from `publicEntityBySlug` - already filtered to
	confirmed, non-gm_only relations. A link to the other side always resolves, whether that
	entity is itself full or still a gap (decision E7): the destination decides which page
	renders, not this list.

	Issue #127: `locale` picks the "Known relations" heading and the "(not yet discovered)"
	annotation - both chrome. `rel.other.name` is canon (an entity's name), never touched by
	it. `rel.label`'s own status changed under decision L1 (#196): a universe's own relation
	type is still canon, never touched, but the shipped ten now repaint with `locale` exactly
	like every other chrome string, because their word is interface furniture, not a GM's own
	writing (SPEC.md §17 rule 3, guardrail 1).
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { InlineLink } from '$lib/components/ui/link';
	import type { PublicRelationRow } from '@canonry/db';
	import { messages, type Locale } from '$lib/i18n';

	let {
		relations,
		universeSlug,
		locale
	}: { relations: PublicRelationRow[]; universeSlug: string; locale: Locale } = $props();
	let t = $derived(messages(locale));
</script>

{#if relations.length > 0}
	<section class="mt-8">
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
			{t.players.relationsHeading}
		</h2>
		<ul class="mt-2 space-y-2">
			{#each relations as rel (rel.key + rel.other.id)}
				<li class="text-sm">
					<span class="text-muted">
						{t.relationTypeLabel(rel.key)?.[rel.direction === 'from' ? 'label' : 'inverseLabel'] ??
							rel.label}
					</span>
					<InlineLink href={resolve(`/p/${universeSlug}/${rel.other.slug}`)} class="ml-1">
						{rel.other.name}
					</InlineLink>
					{#if rel.other.status === 'gap'}
						<span class="ml-1 text-xs text-muted">({t.players.notDiscovered})</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
