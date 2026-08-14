<!--
	Only ever fed `PublicRelationRow[]` from `publicEntityBySlug` - already filtered to
	confirmed, non-gm_only relations. A link to the other side always resolves, whether that
	entity is itself full or still a gap (decision E7): the destination decides which page
	renders, not this list.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PublicRelationRow } from '@canonry/db';

	let { relations, universeSlug }: { relations: PublicRelationRow[]; universeSlug: string } =
		$props();
</script>

{#if relations.length > 0}
	<section class="mt-8">
		<h2 class="text-xs font-semibold tracking-wide text-muted uppercase">Known relations</h2>
		<ul class="mt-2 space-y-2">
			{#each relations as rel (rel.label + rel.other.id)}
				<li class="text-sm">
					<span class="text-muted">{rel.label}</span>
					<a
						href={resolve(`/p/${universeSlug}/${rel.other.slug}`)}
						class="ml-1 text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg"
					>
						{rel.other.name}
					</a>
					{#if rel.other.status === 'gap'}
						<span class="ml-1 text-xs text-muted">(not yet discovered)</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
