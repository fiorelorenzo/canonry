<script lang="ts">
	/** B4 = B: history, newest first, every revision's author kind on permanent display. */
	import { dateFormat, messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import type { AuthorKind } from '@canonry/db/schema';
	import RevisionBadge from './RevisionBadge.svelte';

	export interface RevisionRow {
		id: string;
		authorKind: AuthorKind;
		createdAt: string | Date;
	}

	let { revisions, locale }: { revisions: RevisionRow[]; locale: Locale } = $props();
	let t = $derived(messages(locale));

	function formatWhen(value: string | Date): string {
		// `dateStyle`/`timeStyle` are the two Intl.DateTimeFormat options that read like a
		// history log entry rather than a full ISO timestamp; worth naming once here rather
		// than repeating the option object at every call site this list re-renders.
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
</script>

{#if revisions.length === 0}
	<EmptyState
		kind="derived"
		message={t.entry.history.empty}
		explanation={t.entry.history.explanation}
	/>
{:else}
	<ul class="space-y-2.5">
		{#each revisions as revision (revision.id)}
			<li class="flex items-center justify-between gap-3 text-sm">
				<span class="text-ink-2">{formatWhen(revision.createdAt)}</span>
				<RevisionBadge kind={revision.authorKind} {locale} />
			</li>
		{/each}
	</ul>
{/if}
