<script lang="ts">
	/**
	 * Issue #471: the scoped error boundary that keeps a world's shell chrome for any
	 * failure nested under an already-resolved universe (entry, editor, table, works,
	 * proposals, players, import, settings) - `e/[slug]/+page.server.ts` throwing on
	 * an unknown entry slug is the issue's own repro. Because this file lives beside
	 * `+layout.svelte`, SvelteKit's ancestor chain for it still includes that layout's
	 * already-successful load, so `page.data.current`/`universeSlug` are on
	 * `page.data` here and `AppShell.svelte` keeps drawing universe mode - the same
	 * sidebar, switcher and nav as any other page in this world, with nothing
	 * special-cased in this file or in the shell. See `ErrorPage.svelte`'s own doc
	 * comment for the sibling-layout case this file deliberately does not catch (an
	 * unresolvable universe slug bubbles past it to the root boundary instead).
	 */
	import ErrorPage from '$lib/components/shell/ErrorPage.svelte';
</script>

<ErrorPage />
