<script lang="ts">
	/** B4 = B: history, newest first, every revision's author kind on permanent display. */
	import type { AuthorKind } from '@canonry/db/schema';
	import RevisionBadge from './RevisionBadge.svelte';

	export interface RevisionRow {
		id: string;
		authorKind: AuthorKind;
		createdAt: string | Date;
	}

	let { revisions }: { revisions: RevisionRow[] } = $props();

	function formatWhen(value: string | Date): string {
		// `dateStyle`/`timeStyle` are the two Intl.DateTimeFormat options that read like a
		// history log entry rather than a full ISO timestamp; worth naming once here rather
		// than repeating the option object at every call site this list re-renders.
		const date = typeof value === 'string' ? new Date(value) : value;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

{#if revisions.length === 0}
	<p class="text-sm text-muted">No revisions yet.</p>
{:else}
	<ul class="space-y-2.5">
		{#each revisions as revision (revision.id)}
			<li class="flex items-center justify-between gap-3 text-sm">
				<span class="text-ink-2">{formatWhen(revision.createdAt)}</span>
				<RevisionBadge kind={revision.authorKind} />
			</li>
		{/each}
	</ul>
{/if}
