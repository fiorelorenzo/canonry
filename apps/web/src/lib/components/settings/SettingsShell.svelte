<script lang="ts">
	/**
	 * Issue #406 (S1, DECISIONS.md "Round fourteen"): the two-pane settings frame -
	 * a rail on the left, one content pane on the right - extracted from
	 * `routes/settings/+layout.svelte` (issue #143, I6 = B) once the universe's own
	 * settings page (`routes/w/[universe]/settings/+page.svelte`) needed the same
	 * shape rather than a second copy of this div. What goes in either pane is a
	 * caller concern: the account's rail is real route links (`SettingsNav.svelte`),
	 * a universe's rail is same-page anchors with a checklist mark on the rows that
	 * need one - this component only owns the two-column layout itself.
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
