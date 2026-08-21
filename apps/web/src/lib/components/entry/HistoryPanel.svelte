<script lang="ts">
	/**
	 * B4 = B: history, newest first, every revision's author kind on permanent display.
	 *
	 * Round sixteen U7 (#453) is the readability pass: the list used to be one flat `<li>`
	 * per revision with no hierarchy at all, a date and a badge in a row, which reads fine
	 * for three revisions and blurs into a column of identical lines for thirty. Two
	 * changes make it scannable rather than merely present:
	 *
	 * 1. **Grouped by calendar day.** `revisions` arrives newest-first already
	 *    (`historyFor`'s own `orderBy`), so grouping is a single linear pass: each row's
	 *    `createdAt` is compared against the running group's own day, and a new group
	 *    starts the moment it differs. The header is the formatted date alone - no new
	 *    translated string, since "when" is exactly what a date already says on its own.
	 * 2. **"By whom" names a person, not only a kind.** `RevisionBadge` still carries
	 *    guardrail 2's own distinction (never dropped: an accepted proposal's wording
	 *    stays flagged as such forever, badge and all), but for a `human` revision this
	 *    now also shows `authorName` - `historyFor`'s left join against `user` - because a
	 *    universe can have more than one writer and "human" alone does not say which one.
	 *
	 * The other half of U7: `proposalId` (set only on an `ai_accepted` revision) links to
	 * `/w/<universe>/review/<proposalId>`, the settled-proposal page issue #453 added
	 * alongside this file - guardrail 3's evidence, reachable again after the proposal
	 * that produced this revision was decided.
	 */
	import { resolve } from '$app/paths';
	import { dateFormat, messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import type { AuthorKind } from '@canonry/db/schema';
	import RevisionBadge from './RevisionBadge.svelte';

	export interface RevisionRow {
		id: string;
		authorKind: AuthorKind;
		/** Null for `ai_accepted` (no human author) and for a human revision whose
		 * `author_user_id` no longer resolves to a `user` row - `historyFor`'s left join,
		 * never assumed present. */
		authorName: string | null;
		/** Set only when this revision came from an accepted proposal (guardrail 2's other
		 * half) - the row links to it when present, and shows nothing extra when not. */
		proposalId: string | null;
		createdAt: string | Date;
	}

	interface RevisionGroup {
		key: string;
		label: string;
		revisions: RevisionRow[];
	}

	let {
		revisions,
		universeSlug,
		locale
	}: { revisions: RevisionRow[]; universeSlug: string; locale: Locale } = $props();
	let t = $derived(messages(locale));

	function asDate(value: string | Date): Date {
		return typeof value === 'string' ? new Date(value) : value;
	}

	function formatTime(value: string | Date): string {
		return dateFormat(locale, { timeStyle: 'short' }).format(asDate(value));
	}

	function dayKey(value: string | Date): string {
		// The reader's own local day, matching what `dateFormat` below prints for the
		// group header - a UTC-based key would occasionally split or merge a group at
		// the wrong boundary for whoever is reading it.
		return asDate(value).toDateString();
	}

	// One linear pass over an already newest-first list (see the header comment):
	// consecutive rows sharing a day join the running group, and a new day starts a new
	// one. `$derived.by` rather than a plain `$derived` expression - the loop needs a
	// local accumulator a single expression can't hold.
	let groups = $derived.by((): RevisionGroup[] => {
		const out: RevisionGroup[] = [];
		for (const revision of revisions) {
			const key = dayKey(revision.createdAt);
			const current = out.at(-1);
			if (current && current.key === key) {
				current.revisions.push(revision);
			} else {
				out.push({
					key,
					label: dateFormat(locale, { dateStyle: 'full' }).format(asDate(revision.createdAt)),
					revisions: [revision]
				});
			}
		}
		return out;
	});
</script>

{#if revisions.length === 0}
	<EmptyState
		kind="derived"
		message={t.entry.history.empty}
		explanation={t.entry.history.explanation}
	/>
{:else}
	<div class="space-y-4">
		{#each groups as group (group.key)}
			<div>
				<h4 class="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
					{group.label}
				</h4>
				<ul class="space-y-2 border-l border-line pl-3">
					{#each group.revisions as revision (revision.id)}
						<li class="text-sm">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-ink-2">{formatTime(revision.createdAt)}</span>
								{#if revision.authorKind === 'human' && revision.authorName}
									<span class="font-medium text-ink">{revision.authorName}</span>
								{/if}
								<RevisionBadge kind={revision.authorKind} {locale} />
							</div>
							{#if revision.proposalId}
								<a
									href={resolve(`/w/${universeSlug}/review/${revision.proposalId}`)}
									class="mt-0.5 inline-block text-xs text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg"
								>
									{t.entry.history.proposalLink}
								</a>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
{/if}
