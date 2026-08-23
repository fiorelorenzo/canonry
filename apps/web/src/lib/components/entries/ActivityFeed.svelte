<script lang="ts">
	/**
	 * O1 = C (#283), the world home's third section: "a recent activity feed".
	 *
	 * Three kinds of line, from the three dated rows a world already leaves behind
	 * (`recentActivity`, `@canonry/db`): an entry was rewritten, two entries were connected, a
	 * scene or session was touched. Each one links where the event happened.
	 *
	 * A revision or a relation that came from an accepted proposal keeps saying so. Guardrail
	 * 2 makes `revision.author_kind` permanent rather than a marker that disappears on accept,
	 * and this is the surface where that has to survive being summarised: "changed 4m ago"
	 * with no author would be the one place in the product where a human edit and an accepted
	 * draft read identically. It is a plain word, not the copilot's hue: C1 spends that hue
	 * on unaccepted AI text, and everything in this feed has already been accepted.
	 */
	import { resolve } from '$app/paths';
	import type { ActivityItem } from '@canonry/db';
	import type { Messages } from '$lib/i18n';
	import { relativeTime } from './relative-time';

	let {
		universeSlug,
		items,
		t,
		relativeTimeT,
		relationTypeLabel
	}: {
		universeSlug: string;
		items: ActivityItem[];
		t: Messages['universe']['index']['home'];
		relativeTimeT: Messages['universe']['index']['relativeTime'];
		/** #196: a shipped relation type's word comes from the bundle, keyed off
		 * `relationKey`; a universe's own type falls back to the label the query resolved,
		 * which already accounts for #198's per-locale translation. */
		relationTypeLabel: Messages['relationTypeLabel'];
	} = $props();

	function href(item: ActivityItem): string {
		if (item.kind === 'revision') return resolve(`/w/${universeSlug}/e/${item.entitySlug}`);
		if (item.kind === 'relation') return resolve(`/w/${universeSlug}/e/${item.fromSlug}`);
		return resolve(`/w/${universeSlug}/works/${item.workSlug}`);
	}

	function line(item: ActivityItem): string {
		if (item.kind === 'revision') return t.activityRevision(item.entityName);
		if (item.kind === 'relation') {
			const label = relationTypeLabel(item.relationKey)?.label ?? item.label;
			return t.activityRelation(item.fromName, label, item.toName);
		}
		return t.activityWork(item.workName, item.nodeTitle);
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- `href()` above returns a
     resolve() result per activity kind, which the rule cannot see through. -->
<ul class="flex flex-col divide-y divide-line">
	{#each items as item (item.kind + item.id)}
		<li class="flex items-baseline gap-3 py-2 text-body">
			<a href={href(item)} class="min-w-0 flex-1 truncate text-ink-2 hover:text-accent">
				{line(item)}
			</a>
			{#if item.kind !== 'work' && item.authorKind === 'ai_accepted'}
				<span class="shrink-0 text-label text-muted">{t.authorAi}</span>
			{/if}
			<span class="shrink-0 font-mono text-label text-muted tabular-nums">
				{relativeTime(item.at, relativeTimeT)}
			</span>
		</li>
	{/each}
</ul>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
