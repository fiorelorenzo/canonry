<script lang="ts">
	/**
	 * Issue #145 (I7 = C, DECISIONS.md's "one page, two modes"): the collapsible strip
	 * pinned above the browser, carrying B's four rejected-dashboard signals - what
	 * changed, what's waiting for review, the quota, the current work - so a returning
	 * GM still gets the summary option A alone would have lost, without a second address.
	 *
	 * The collapsed/expanded state toggles instantly on the client (a GM should never
	 * watch a full page reload just to get their screen back) and is also written
	 * server side through a plain form action, the same "works with JavaScript off"
	 * shape `/settings/appearance`'s theme radios use - `use:enhance` here only cancels
	 * the default navigation/invalidation `enhance` would otherwise trigger, since the
	 * client state above already reflects the new value.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import type { Messages } from '$lib/i18n';
	import { relativeTime } from './relative-time';

	let {
		universeSlug,
		initialCollapsed,
		whatChanged,
		pendingReview,
		quota,
		currentWork,
		t
	}: {
		universeSlug: string;
		/** Only the value at mount matters (matches `DeclareContext.svelte`'s
		 * `initialPlaceId`/`initialSessionId` naming for the same reason): the toggle
		 * below owns the state from here on, and a later prop change (there isn't one -
		 * this route never re-runs its load without a full navigation) is not meant to
		 * override a GM's click. */
		initialCollapsed: boolean;
		whatChanged: { name: string; slug: string; updatedAt: Date } | null;
		pendingReview: number;
		quota: { used: number; total: number };
		currentWork: { workName: string; workSlug: string; nodeTitle: string } | null;
		t: Messages['universe']['index'];
	} = $props();

	let open = $state(!initialCollapsed);
</script>

{#if open}
	<div
		class="mb-5 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-line bg-panel-2 px-4 py-3"
	>
		<div class="flex flex-col gap-0.5">
			<span class="font-mono text-[10px] tracking-wide text-muted uppercase"
				>{t.strip.whatChangedHeading}</span
			>
			{#if whatChanged}
				<a
					href={resolve(`/w/${universeSlug}/e/${whatChanged.slug}`)}
					class="text-sm font-medium text-ink hover:text-accent"
				>
					{whatChanged.name}
					<span class="font-normal text-muted"
						>· {relativeTime(whatChanged.updatedAt, t.relativeTime)}</span
					>
				</a>
			{:else}
				<span class="text-sm text-ink-2">{t.strip.whatChangedEmpty}</span>
			{/if}
		</div>

		<div class="flex flex-col gap-0.5">
			<span class="font-mono text-[10px] tracking-wide text-muted uppercase"
				>{t.strip.waitingForReviewHeading}</span
			>
			{#if pendingReview > 0}
				<a
					href={resolve(`/w/${universeSlug}/proposals`)}
					class="text-sm font-semibold text-ink hover:text-accent"
				>
					{pendingReview}
				</a>
			{:else}
				<span class="text-sm text-ink-2">0</span>
			{/if}
		</div>

		<div class="flex flex-col gap-0.5">
			<span class="font-mono text-[10px] tracking-wide text-muted uppercase"
				>{t.strip.quotaHeading}</span
			>
			<span class="text-sm font-semibold text-ink"
				>{t.strip.quotaValue(quota.used, quota.total)}</span
			>
		</div>

		<div class="flex flex-col gap-0.5">
			<span class="font-mono text-[10px] tracking-wide text-muted uppercase"
				>{t.strip.currentWorkHeading}</span
			>
			{#if currentWork}
				<a
					href={resolve(`/w/${universeSlug}/works/${currentWork.workSlug}`)}
					class="text-sm font-medium text-ink hover:text-accent"
				>
					{t.strip.currentWorkValue(currentWork.workName, currentWork.nodeTitle)}
				</a>
			{:else}
				<span class="text-sm text-ink-2">{t.strip.currentWorkEmpty}</span>
			{/if}
		</div>

		<form
			method="POST"
			action="?/toggleStrip"
			class="ml-auto"
			use:enhance={() => {
				open = false;
				return async ({ update }) => update({ invalidateAll: false, reset: false });
			}}
		>
			<input type="hidden" name="collapsed" value="true" />
			<Button type="submit" variant="ghost" size="sm">{t.strip.collapseLabel}</Button>
		</form>
	</div>
{:else}
	<form
		method="POST"
		action="?/toggleStrip"
		class="mb-5"
		use:enhance={() => {
			open = true;
			return async ({ update }) => update({ invalidateAll: false, reset: false });
		}}
	>
		<input type="hidden" name="collapsed" value="false" />
		<Button type="submit" variant="ghost" size="sm">{t.strip.expandLabel}</Button>
	</form>
{/if}
