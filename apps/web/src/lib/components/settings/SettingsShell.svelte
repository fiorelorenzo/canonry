<script lang="ts">
	/**
	 * Issue #406 (S1, DECISIONS.md "Round fourteen"): the two-pane settings frame -
	 * a rail on the left, one content pane on the right - extracted from
	 * `routes/settings/+layout.svelte` (issue #143, I6 = B) once the universe's own
	 * settings page (`routes/w/[universe]/settings/+page.svelte`) needed the same
	 * shape rather than a second copy of this div. Issue #794 (DECISIONS.md "Round
	 * twenty-one") took the universe settings page back out again: three groups on
	 * one page never earned a same-page-anchor rail of their own, so that page
	 * stopped being a caller. The account's six panes at `/settings/*` are this
	 * component's only caller now, with a real-route rail (`SettingsNav.svelte`) -
	 * this component still only owns the two-column layout itself, not what either
	 * pane holds, so a future second caller costs nothing to add back.
	 */
	import type { Snippet } from 'svelte';

	let { rail, children }: { rail: Snippet; children: Snippet } = $props();
</script>

<div class="flex flex-col gap-8 lg:flex-row lg:gap-10">
	{@render rail()}
	<div class="min-w-0 flex-1">
		{@render children()}
	</div>
</div>
